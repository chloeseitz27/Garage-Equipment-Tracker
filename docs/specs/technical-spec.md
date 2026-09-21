# Technical Specification

**Status:** Draft
**Last updated:** 2026-09-18
**Parent specs:** [`product-spec.md`](product-spec.md), [`chatbot-spec.md`](chatbot-spec.md)

---

## 1. Scope of this document

How we build the hackathon demo described in product spec §8. Decisions here are
optimized for **speed to a working demo**, with deliberate seams where a
post-hackathon version would need something sturdier. Those seams are called out
explicitly so they're chosen rather than discovered later.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Language | TypeScript, end to end |
| Frontend | React + Vite |
| Backend | Node + Express |
| Storage | Cosmos DB for deployment; JSON files for local development (§4) |
| Assistant | Hosted LLM behind a provider interface (§6) |
| Runtime | Local only — runs on the kiosk machine (§9) |

One language across the stack means the item model is defined once, in
`packages/shared`, and imported by both sides. Given the assistant's grounding
requirements depend on item IDs and location paths being exactly right, a shared
type definition is worth more here than usual.

### Repository layout

```
apps/
  web/            React kiosk UI
  api/            Express server
packages/
  shared/         Types, schema, shared validation
data/
  seed/           Seed catalog, committed to git
  runtime/        Live working copy, gitignored (§4.2)
docs/
  specs/
```

---

## 3. Data model

Defined in `packages/shared`. Field semantics come from product spec §5.1 and
chatbot spec §8; this is the encoding.

```ts
type ItemKind = 'equipment' | 'consumable';
type EquipmentStatus = 'available' | 'in-use' | 'out-for-repair' | 'retired';
type StockLevel = 'in-stock' | 'low' | 'out';
type TrainingLevel = 'none' | 'orientation' | 'supervised' | 'certified';

interface ItemBase {
  id: string;              // stable, never reused — the assistant grounds on this
  name: string;
  kind: ItemKind;
  categoryIds: string[];   // at least one distinct, nonblank category id
  locationId: string;      // node at any depth in the location tree
  description?: string;
  photoUrl?: string;
  tags: string[];          // aliases for search recall
  goodFor: string[];       // project types, for assistant matching
  notes?: string;
  safetyNotes?: string;    // verbatim only — never model-generated
}

interface Equipment extends ItemBase {
  kind: 'equipment';
  status: EquipmentStatus;
  quantity: number;
  trainingRequired: TrainingLevel;
}

interface Consumable extends ItemBase {
  kind: 'consumable';
  stockLevel: StockLevel;
}

type Item = Equipment | Consumable;

interface Location {
  id: string;
  name: string;
  parentId: string | null;  // null = Room (root)
  kind: 'room' | 'zone' | 'table' | 'workbench' | 'cabinet' | 'shelf' | 'bin';
  staffOnly?: boolean; // inherited by every descendant
  mapId?: 'common' | 'advanced'; // top-level rooms only
  mapPosition?: {
    roomId: string;
    mapId: 'common' | 'advanced';
    x: number; // 0..1 from the left edge of the image
    y: number; // 0..1 from the top edge of the image
  };
}

interface Category {
  id: string;
  name: string;
}

interface Flag {              // product spec §6.4
  id: string;
  itemId: string;
  type: 'not-here' | 'low' | 'out';
  createdAt: string;
  resolved: boolean;
}
```

### 3.1 Location paths are derived, never stored

An item stores only `locationId`. The full breadcrumb (`Main Shop → Electronics
Bench → Cabinet B → Bin 4`) is computed by walking `parentId` to the root.

This matters more than it looks. Location paths appear in search results, item
detail, and every assistant recommendation. Storing a denormalized path string
would create three places for it to drift. Derive it once, in `packages/shared`,
and use that function everywhere.

### 3.2 IDs are stable and permanent

Item IDs are the anchor for assistant grounding (chatbot spec §6.1). A reused or
regenerated ID means a recommendation can resolve to the wrong physical object —
which is exactly the failure mode the grounding rules exist to prevent. IDs are
assigned once and never reused, including after retirement.

Retirement is a state, not a delete. Retired items leave search and assistant
results but keep their record.

Items belong to one or more categories. Every entry in `categoryIds` must
reference an existing category; empty lists, blank IDs, and duplicates are
invalid. This includes retired items, and a category cannot be deleted while
any active or retired item references it in any position.

Legacy stored records and write payloads with only `categoryId` are normalized
to `categoryIds: [categoryId]` before validation. When both fields are present,
the legacy ID must occur in the canonical list or the record is rejected.
The canonical list is never overwritten by the legacy field; responses and
subsequent item writes contain only `categoryIds`. JSON loading normalizes in
memory without rewriting files until an ordinary item write; Cosmos list and
single-item reads strip system fields, normalize, and validate through the
same item schema.

Bulk edits supplying `categoryIds` replace the entire assignment list on every
selected item. Omitting it preserves existing assignments. All category and
location references are validated for the whole batch before any write.
Assistant retrieval matches names from all assigned categories while retaining
one candidate per item.

### 3.3 Room maps

The Common Makerspace (larger plan) and Advanced Makerspace (smaller plan) use
clean SVG redraws of the supplied images, versioned in `apps/web/public/maps`.
The redraws preserve the source coordinate systems; original PNGs remain as
references. `parseSvgMap` extracts selectable geometry from groups carrying
`data-location-id`, including nested SVG transforms. The browser displays the
original SVG as an inert image and renders only allowlisted geometry as a React
SVG overlay; it never injects source scripts, event handlers, styles, or HTML
into the document. A selected location highlights its entire SVG surface.
Unknown, excluded, or out-of-room location IDs do not become interactive.

`resolveMapTarget` walks from the selected location to its ancestors, preferring
an SVG shape to a point at the same node. Point-only locations keep their
normalized coordinates. `resolveLocationMap` still derives the containing room.
`roomId` and `mapId` in point coordinates
must both match the current room; stale positions from cross-room moves or plan
changes are ignored, never shown on the wrong floor plan.

SVG geometry changes apply on the next map fetch without database writes. SVG
requests use `cache: 'no-store'`, coalesce by map, and refresh on window focus
and reconnection; background and overlay use the same source snapshot. Original
map coordinates remain backward-compatible fallback data, not the source of
truth for a currently linked SVG shape. Label changes and new catalog records
remain explicit operations. Supported regions use rect/path/polygon/circle/
ellipse geometry; explicit `data-location-shape="true"` pieces override the
usual surface/station/cabinet classes. Duplicate IDs, malformed XML, DTDs,
clones, clips/masks, and CSS transforms fail explicitly.

The API reads the source SVGs when validating shape-linked edits. Shared builds
copy the SVG assets into `@garage/shared/dist/maps` as a deployment fallback, so
the same shape IDs remain available when source folders are not shipped.
Development reads the current source files, not a stale generated list.

Staff stage point-marker positions by clicking the map, without numeric coordinate fields, and save via
the authenticated `POST /api/locations/markers` API. The editor keeps one draft
per location across pin URL changes within the same room, with a single
**Save all markers** action. Room changes, including Back/Forward, are blocked
until the user saves or explicitly discards the draft batch. Discarding before
a room switch clears in-memory drafts even though the editor remains mounted;
leaving the location editor also retains unsaved-change protection.
The batch accepts up to 100 distinct `{ id, roomId, mapId, position }` records,
where `position` is normalized `{ x, y }` or `null` to remove a marker.
All references and room/plan identities are validated before writing, and only
marker data is merged into existing records. SVG-linked locations reject point
batch edits with an instruction to edit the SVG instead. The repository saves the batch in
one JSON file replacement (updating memory only after persistence succeeds) or
one Cosmos transaction of replacements in the `location` partition. Successful
saves invalidate the catalog cache; failed saves retain the client drafts.

Location creation starts from a row's **+** (fixed parent) or the bottom **+**
(top-level room). One inline `LocationEditor` holds metadata and a temporary
placement preview without issuing a create request. Top-level room edits omit
the parent picker; other edits retain it and exclude self/descendants.
`locationPlacementProblem` gates the form and authenticated location
create/update routes: a child in a mapped room needs its own `mapPosition`
matching that room and map version, or its own linked SVG shape. Ancestor
markers/shapes do not satisfy this rule. Shape-linked metadata edits need no
point, and their geometry cannot be repositioned through the location form.
Root locations and children of unmapped rooms are exempt. Cross-room edits
require remapping; failed saves retain the form. Location forms and standalone
marker batches are mutually exclusive editing modes and share one navigation
guard. Marker-removal batches remain supported separately.

Visitor map URLs preserve the
selected room and location. Seed data contains two mapped rooms, their labeled
locations, two staff-only storage rooms, starter categories, and empty item/report arrays.

Storage surfaces are lettered uniquely across rooms: Common A-M clockwise from
the top-right table, and Advanced S-Z clockwise from the top-left workbench.
Advanced has Workbench S and Tables T/U across the top, V on the right, W in the
center, X/Y along the bottom-left, and Z at left-center.
Existing IDs are retained when display labels change; the added surface now
called Table X retains `loc-table-u`.
The six central Common work tables are drawing-only features, not catalog
locations, so they have no markers and are absent from storage pickers. The
current seed contains 31 locations: four rooms (two staff-only), 21 lettered surfaces, and six
named stations/cabinets. SVG tests parse XML and apply transforms rather than
depending on Inkscape's attribute ordering or whitespace. Drawer numbering (for example D2) is separate from
table lettering; no drawer records are invented from the plans.

`npm run sync:maps:cosmos` previews name/position synchronization from the seed
for only the locations drawn in the SVGs. Applying requires an absolute backup
path and saves all changes in one Cosmos transaction: ETag-guarded patches for
existing records and creates for missing drawn surfaces. Only lettered surface
names and mapped positions change; station/cabinet names, other fields, stable
IDs, and item assignments are preserved and checked against a fresh read.
Unmapped records are excluded. This is an explicit remapping operation, unlike
the additive `update:locations` migration, which preserves saved coordinates.

### 3.4 Staff-only locations

`staffOnly` defaults to public when omitted and is inherited through the location
tree. `Storage Closet` and `Basement Storage` start as restricted, unmapped rooms.
For anonymous requests, `publicCatalog` removes the entire restricted subtree,
adds one synthetic `public-ask-staff` room named **Ask Staff**, and rewrites the
affected items' response-only `locationId` to that room. Stored assignments never
change. The same projection is used for individual item details and assistant
candidate/response assembly. Public items stay discoverable, while restricted
names, IDs, coordinates, and breadcrumbs are not sent to visitors.

`GET /api/catalog` returns `access: "public" | "staff"` based on the signed
session cookie. Audience-dependent reads use `Cache-Control: private, no-store`
and `Vary: Cookie`. The server repository cache remains canonical; redaction is
per response, never a mutation of cached data. Existing catalogs can be upgraded
explicitly using `npm run update:locations -- --apply` after deploying the code.

---

## 4. Storage

**Cosmos DB or local JSON files, behind the same repository interface.**
`STORAGE=cosmos` selects the implemented Cosmos backend; `STORAGE=json` remains
the local-development default. `apps/api/src/repository/index.ts` selects and
initializes one shared repository for the server.

```ts
interface CatalogRepository {
  getItems(): Promise<Item[]>;
  getItem(id: string): Promise<Item | null>;
  saveItem(item: Item): Promise<void>;
  saveLocations(locations: Location[]): Promise<void>;
  getLocations(): Promise<Location[]>;
  getCategories(): Promise<Category[]>;
  addFlag(flag: Flag): Promise<void>;
  // ...
}
```

Everything above the interface — API routes, search, the assistant's grounding
layer — must go through it. The complete interface also covers bulk writes,
location/category creation and deletion, and flag resolution. JSON keeps local
development usable without Azure; Cosmos is the deployed source of truth.

### 4.1 Honest limitations

These limitations apply to the JSON backend, not to Cosmos transactional batches:

- **No concurrency control.** Two simultaneous writes can lose one. With one
  kiosk and one or two staff, this is a real but tolerable risk.
- **Full-file rewrites.** Every save rewrites the file. Fine at hundreds of
  items; not fine at scale.
- **No transactions.** A crash mid-write can truncate a file. Mitigated by
  write-temp-then-rename (§4.3).

### 4.2 Seed and runtime are separate

A subtle trap: if the app writes to the same JSON file that's committed to git,
every demo edit produces a working-tree diff, and a careless `git checkout`
silently discards data.

So:

- `data/seed/` — committed. The canonical demo data set.
- `data/runtime/` — gitignored. What the app actually reads and writes.
- On first run, if `data/runtime/` is empty, copy from `data/seed/`.
- A `reset` script restores runtime from seed. This is also the "put the demo
  back to a known state" button, which matters immediately before presenting.
  Restart the JSON-backed API after a reset: that repository loads files into
  memory on startup rather than rereading them on every request.

### 4.3 Write safety

Write to a temp file in the same directory, then atomically rename over the
target. Cheap, and it removes the truncation failure mode.

### 4.4 Cosmos storage and server caching

Cosmos uses one container partitioned by `/type` (`item`, `location`, `category`,
`flag`). Authentication uses `DefaultAzureCredential` unless a key is explicitly
configured; see the README for provisioning and data-plane access. Bulk item
writes use transactional batches within the `item` partition.

`CachedCatalogRepository` wraps the Cosmos repository once at startup, shared
by public routes, staff routes, and assistant retrieval. Items, locations, and
categories share one validated snapshot with a default **1-hour TTL**.
`CATALOG_CACHE_TTL_MS` overrides it; zero disables reuse across completed
requests. Concurrent cache misses share one fetch per collection. Read errors
propagate rather than silently serving an expired server snapshot.

Every catalog create, update, bulk write, or delete invalidates the entire
snapshot, including when the write fails. Older in-flight reads cannot
repopulate it after invalidation. Flags bypass caching. Validation reuses
`catalogSchema` and `findCatalogProblems` from `@garage/shared`, retaining
retirement, floor-plan metadata, and the current location kinds.

This assumes a single API server. Out-of-band Cosmos edits and imports become
visible at the next read after TTL expiry, or after an API restart. Browser
refreshes do not force a database read while the server snapshot is valid.
There is no cross-process invalidation or extra write serialization. The JSON
repository already holds its files in memory, so it is not additionally wrapped.

---

## 5. API

REST, JSON, served by Express under `/api`.

| Method | Route | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/catalog` | none | Items, locations, categories in one payload (§7) |
| `GET` | `/api/items/:id` | none | Single item with resolved location path |
| `POST` | `/api/flags` | none | Anonymous flag (product spec §6.4) |
| `POST` | `/api/assistant/recommend` | none | Project Assistant (§6) |
| `POST` | `/api/items` | staff | Create |
| `PUT` | `/api/items/:id` | staff | Update |
| `POST` | `/api/locations` | staff | Create metadata and required map placement together |
| `PUT` | `/api/locations/:id` | staff | Update metadata; mapped children require a valid direct marker |
| `POST` | `/api/locations/markers` | staff | Atomically update/remove up to 100 location markers |
| `POST` | `/api/auth/login` | none | Staff sign-in (§8) |
| `POST` | `/api/auth/logout` | staff | |
| `GET` | `/api/flags` | staff | Flag queue |

All input validated at the boundary with a schema validator (Zod), using schemas
exported from `packages/shared` so client and server agree.

---

## 6. Project Assistant

The architecture exists to satisfy one requirement: **the model may choose items,
but it may never author facts about them** (chatbot spec §6).

### 6.1 Pipeline

```
project description
      │
      ▼
[1] Candidate retrieval   ← deterministic, server-side, from catalog
      │
      ▼
[2] Model call            ← candidates in, selected IDs + reasons out
      │
      ▼
[3] Re-resolution         ← every returned ID looked up in catalog; unknown IDs dropped
      │
      ▼
[4] Response assembly     ← name/location/safety read from record, not from model
```

**[1] Candidate retrieval.** Filter out retired items, then select candidates by
matching the project text against name, tags, `goodFor`, category, and
description. At demo scale the whole catalog may fit in one prompt — but keep
this step even so, because it's the seam where relevance ranking goes later.

**[2] Model call.** The model receives candidates as structured records with IDs
and is instructed to return:
- `garageItems`: array of `{ id, reason }` — IDs **must** come from candidates
- `notInGarage`: array of `{ name, reason }` — free-form, explicitly not claimed
  to be in the catalog

Use structured output / function calling so the response is parsed, not scraped.

**[3] Re-resolution is the load-bearing step.** Every ID in `garageItems` is
looked up in the catalog. Unknown or hallucinated IDs are **dropped silently
from the response and logged**. This is what makes chatbot spec §6.1 true by
construction rather than by hoping the prompt held.

**[4] Response assembly.** Name, location path, training level, and safety notes
are read from the catalog record. The model's contribution to an in-Garage entry
is *only* the one-line `reason` and the selection itself. Safety text in
particular is never in the model's output path (chatbot spec §5).

### 6.2 Availability

Per chatbot spec §4, availability is not a filter and not surfaced. Retired
items are excluded at step [1] — they aren't unavailable, they're gone. Status
and stock level are deliberately omitted from the assistant response entirely;
users reach them via item detail.

### 6.3 Provider abstraction

Azure OpenAI and GitHub Models are both in play. Define:

```ts
interface AssistantProvider {
  recommend(input: {
    projectDescription: string;
    candidates: Item[];
  }): Promise<{
    garageItems: Array<{ id: string; reason: string }>;
    notInGarage: Array<{ name: string; reason: string }>;
  }>;
}
```

Both are OpenAI-compatible chat-completions APIs, so a single implementation
with different base URL, auth, and model name covers both. Selected by env var.
Start on whichever is faster to get credentials for; the interface means that
choice isn't load-bearing.

Also implement a **stub provider** returning fixed results from `goodFor`
matching. It keeps the app demoable with no network and no key, makes the
grounding layer testable deterministically, and saves the demo if the API is
unreachable at the worst moment.

### 6.4 Prompting

System prompt must state: recommend only from provided candidates, reference
items by ID, never invent IDs, never produce safety or location information,
keep reasons to one line. Return an empty list rather than padding a thin
answer (chatbot spec §6.4).

Prompt text lives in a versioned file under `apps/api`, not inline in a handler,
so changes are reviewable in a diff.

---

## 7. Search

Search runs **client-side over the full catalog**, loaded from the browser cache
and revalidated against `GET /api/catalog`.

At Garage scale — hundreds to low thousands of items — the entire catalog is a
small payload. Loading it once buys keystroke-latency search with no network
round trip, which is how the under-200ms target in product spec §7 gets met
without a search service. A kiosk on local hardware makes this even safer.

Use a small fuzzy matching library (Fuse.js or similar) over name, tags,
category, description, and location name, with name and tags weighted highest.
Fuzzy matching covers the misspelling and plural tolerance required by product
spec §6.1.

Refetch the catalog on page load, window focus, and reconnect. The manual header
refresh icon is development-only, gated by Vite's `import.meta.env.DEV`.
Initial-load failure recovery remains available in production.
Successful staff catalog changes invalidate the browser snapshot and refetch.
Kiosk idle reset is still deferred; when implemented, it should also refresh.

### 7.1 Browser persistence and refresh

`BrowserCatalogCache` persists one validated, versioned catalog under
`garage-inventory:catalog:v3`. Only `publicCatalog` projections are persisted,
even during staff sessions, and v2 snapshots are removed. Staff catalog data
stays in memory, scoped to the current sign-in state. Staff editors wait for a
network response with `access: "staff"` rather than editing synthetic assignments.
Sign-out redacts the current view and clears assistant results; cross-tab
sign-out and access revocation also hide private data. The React `useCatalog` hook renders saved data
while the network request runs. A snapshot is marked stale after **5 minutes**,
not deleted, and remains available during API failures. The timestamp denotes
browser retrieval, not the database's last modification (§4.4).

Refresh failures show an explicit notice without discarding the current catalog
or unsaved drafts. Initial failures with no saved catalog also offer a retry action. Saved safety/training, location, and
availability information is never presented as verified current after a failed
refresh. Staff writes continue to require the API; there is no offline queue.

Updates to the rendered catalog wait while an item, location, category, bulk,
or map draft is dirty, unless access has been revoked.
Relevant cross-tab storage changes reload the snapshot; invalidation refetches,
whereas visitors adopt another tab's saved public snapshot without refetching.
Staff refetch their private view without persisting another snapshot, preventing
a cross-tab fetch/write loop.
Unknown fields outside the public catalog contract are not persisted. Corrupt,
incompatible, or future-dated saved data is reported and removed; storage access
or quota failures are surfaced while in-memory/network operation can continue.

Network catalog requests have a **10-second timeout**, use `cache: 'no-store'`,
and receive `Cache-Control: private, no-store` and `Vary: Cookie`, so the application owns freshness.
Authentication, flags, searches, and assistant inputs/responses are not cached.
This does not cache HTML, JavaScript, or images and does not enable offline
cold startup.

---

## 8. Authentication

Product spec §4: anonymous read, staff write.

**For the hackathon:** a shared staff passphrase, checked server-side, issuing a
signed httpOnly session cookie with a short idle expiry. Staff list and
passphrase come from environment config, never committed.

This is deliberately minimal and is **not** a production answer — it has no
individual accountability and no per-user audit trail. It's acceptable because
the demo runs locally on a trusted machine with seeded data. Post-hackathon this
should become Entra ID, which is why auth sits behind a single middleware rather
than being checked inline in each route.

Requirements that carry over regardless of mechanism:

- Edit affordances are **hidden** when unauthenticated, not shown-and-disabled
  (product spec §4)
- Every mutating staff route is enforced server-side; hiding UI is not access
  control
- Sessions expire on idle so an abandoned kiosk doesn't stay unlocked

---

## 9. Running locally

```
npm install
npm run seed     # copy data/seed → data/runtime
npm run dev      # api + web concurrently
```

Kiosk mode is the browser in fullscreen against `localhost`. No container is required. With `STORAGE=json`, the assistant API is the only
optional cloud dependency; `STORAGE=cosmos` also requires database connectivity.

### 9.1 Secrets

The LLM API key lives in `.env` on the server, read only by the Express process.

**It must never reach the browser.** The frontend calls
`/api/assistant/recommend`; the server calls the provider. A key in frontend
code or a `VITE_`-prefixed variable is shipped to every client, and Vite inlines
those at build time.

`.env` is gitignored (already covered by the committed `.gitignore`). Commit a
`.env.example` with names and no values.

### 9.2 Rate limiting

`/api/assistant/recommend` is unauthenticated by design and costs money per
call. Even locally, apply a simple per-IP rate limit and cap input length. This
is a five-minute change that prevents an accidental loop from burning a quota
mid-hackathon.

---

## 10. Testing

Not comprehensive coverage — targeted at the parts where being wrong is
expensive:

- **Grounding (§6.1 step 3).** Given a model response containing a hallucinated
  ID, the assembled response must not contain it. This is the single most
  important test in the project.
- **Safety text passthrough.** Assistant output safety text equals the catalog
  record's, byte for byte.
- **Location path derivation.** Nested trees, items at every depth, root items.
- **Seed data validity.** Schema-validate `data/seed/` in CI: every
  `locationId` and every entry in `categoryIds` resolves, no orphans, no duplicate IDs. Broken
  seed data breaks the demo, and it breaks it silently.
- **Catalog caching.** Exact TTL boundaries, concurrent misses, every catalog
  mutation and in-flight invalidation, preservation of retirement/map metadata,
  failed refresh recovery, cross-tab storage, and unsaved UI drafts. Cache unit
  tests, HTTP route tests, and React regressions run with `npm test`.

Plus a small fixed set of project prompts with expected items, per chatbot spec
§11, to sanity-check recommendation quality when prompts change.

---

## 11. Deliberate deferrals

Chosen for hackathon speed; each needs revisiting before real use.

| Deferred | Consequence | Successor |
|---|---|---|
| JSON local-development storage | No concurrency, no transactions | Use the implemented Cosmos backend for deployment |
| Shared passphrase auth | No individual accountability | Entra ID behind the same middleware |
| Client-side search | Whole catalog to every client | Server-side search endpoint |
| Local-only run | Single machine, manual start | Container + App Service |
| No photo upload | Photos are URLs only | Blob storage |

---

## 12. Open questions

- Azure OpenAI or GitHub Models for the demo — which credentials land first?
  The provider interface (§6.3) means this can stay open until build time.
- Is there a Garage kiosk machine already, and what can it run?
- Does seed data need to resemble the real Garage closely enough that someone
  should review it, or is plausible fiction fine for the demo?
