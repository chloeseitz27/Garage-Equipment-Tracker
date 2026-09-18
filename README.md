# Garage Inventory

Inventory organization and tracking tool for the Microsoft Garage in Reston.

Hackathon project.

**This is a findability tool first.** Everything else is secondary to answering
one question quickly: *"Do we have X, and where exactly is it?"*

## Status

The app has search, room-map browsing, item detail, anonymous flagging, the
Project Assistant, and staff editing. The initial location catalog now reflects
the supplied Common and Advanced Makerspace plans; items start empty for real
inventory entry.

See [`docs/specs/`](docs/specs/):

- [`product-spec.md`](docs/specs/product-spec.md) — problem, users, data model, scope
- [`chatbot-spec.md`](docs/specs/chatbot-spec.md) — Project Assistant feature
- [`technical-spec.md`](docs/specs/technical-spec.md) — stack, storage, API, grounding architecture

## Getting started

Requires Node 22+.

```bash
npm install
cp .env.example .env   # optional for a local run, required before demoing
npm run seed           # copy data/seed -> data/runtime
npm run dev            # api on :3001, web on :5173
```

Open http://localhost:5173. The assistant defaults to the **stub provider**, so
the app is fully demoable with no API key and no network. Point
`ASSISTANT_PROVIDER` at `azure-openai` or `github-models` in `.env` to use a
hosted model.

### Search and ask

The home page has one shared input. **Search** (or Enter) finds inventory;
results also update as you type while searching. Category chips remain available
for browsing. **Ask** sends the same text to the Project Assistant for tools and
materials suited to a project. Edit the text and ask again to refine, or choose
Search to return to inventory results. Both result types open the same item
details; no example prompts are shown.

Clearing the box (including whitespace-only text) leaves Ask mode, clears the
category filter and selected item, and shows the entire active inventory without
the 60-result search limit. Category chips can then narrow that list. Search or
Enter with an empty box shows all active items again; retired items stay hidden.

Ask is disabled for blank input and while a request is running. Search remains
available and cancels a pending ask. Opening a bookmark never sends an assistant
request automatically.

### Scripts

| Command | Does |
|---|---|
| `npm run dev` | API and web dev servers together |
| `npm run seed` | Copy `data/seed` to `data/runtime` if runtime is empty |
| `npm run seed:cosmos` | Import `data/seed` into Cosmos (validates first, upserts by id) |
| `npm run reset` | Overwrite `data/runtime` from seed — the "put the demo back" button |
| `npm test` | Grounding, safety, and location-path tests, plus seed validation |
| `npm run validate:seed` | Schema + referential integrity check on `data/seed` |
| `npm run typecheck` | Typecheck every workspace |
| `npm run build` | Build all workspaces |

## Repo layout

```
apps/
  web/            React kiosk UI (Vite)
  api/            Express server
packages/
  shared/         Types, zod schemas, location path derivation, integrity checks
data/
  seed/           Seed catalog, committed
  runtime/        Live working copy, gitignored
docs/
  specs/          Product and technical specifications
scripts/          Seed and validation scripts
```

The data model is defined once in `packages/shared` as zod schemas, with
TypeScript types inferred from them, so the client, the server, and the seed
validator can't drift apart.

## Demo data

`data/seed` holds two rooms and 26 storage/station locations from the supplied
floor plans (28 location nodes total), plus 10 starter categories. The previous
fictional inventory and room structure have been replaced; `items.json` and
`flags.json` are empty. Tables and named stations are locations, not assertions
that any particular tool or material is available.

## Room maps

- **Common Makerspace:** 13 lettered tables/desks/workbenches, **A–M**, starting
  at the upper-left desk and going down the left wall, across the bottom, up the
  right wall, then along the top. The six center work tables stay visible but
  have no individual labels or storage locations: keep them clear.
- **Advanced Makerspace:** seven lettered tables/workbenches, **Z–T**, starting
  at the lower-left table and going up the left wall, across the top, down the
  right wall, then along the bottom. The Toolbox remains in the former coat-rack
  area.

Letters are unique across rooms. **N–S** are unused, leaving room to expand.
Cabinets, the Toolbox, and named stations retain descriptive names outside the
table/bench sequence. Storage-location IDs are not renamed, so existing links
and item assignments follow the new display names. The center work tables are
not in location pickers or map markers and cannot receive item assignments.
Drawer labels use the table letter followed by the drawer number (for example,
**C2** means Table C, Drawer 2); drawers are not pre-populated without their
actual counts and positions.

The app uses clean SVG schematics in `apps/web/public/maps`, with horizontal,
high-contrast labels and no dimension clutter. The original PNGs remain there
as source references. Both redraws retain the original coordinate system so
existing markers still align; these are schematics, not scale drawings.
Equipment areas are labeled **Roland** and **Laser**. The **Work Tables** label
sits within the central table formation, and the fire cabinet is drawn with its
back against Advanced's left wall and its doors facing into the room. The area
directly below the upper-left wall projection is open floor, not a recess.
Structural projections are shown as solid wall sections without separate post callouts.
Compact **− / percentage / +** controls float at the map's bottom-left. Click
the percentage to reset. Maps fit their container without an internal scrollbar;
when zoomed, drag to pan, or focus the map and use arrow keys (Home resets).
Initial markers were placed approximately on labeled surfaces, not inferred item placements.
The Toolbox retains its original location ID after moving to Advanced Makerspace,
so linked items and sub-locations follow it.
Open **Room maps** to switch rooms and click a marker to
see its active items (including sub-locations). Item details highlight their
location on the same map, falling back to the nearest mapped ancestor, explicitly
labeled as an approximate location.

In **Manage catalog → Locations**, select a location in the map editor, click
its spot or enter X/Y percentages, then **Save marker**. **Remove marker** is
also staged until saved. Unsaved marker moves warn before navigation.
Renaming a location retains its marker. A cross-room move, or changing a room's
floor plan, makes old coordinates inactive until the location is remapped.
Existing item and location IDs remain stable during normal edits.

`seed:cosmos` upserts seed records; it does **not** delete existing data or migrate
an old demo automatically. Back up an existing catalog before replacing a demo.

## Staff editing

Sign in with the staff passphrase and a **Manage catalog** tab appears.
Its sections share one navigation bar with slim separators:

| Section | Does |
|---|---|
| Items | Filter, create, and edit items; expand Bulk entry to add a whole shelf at once |
| Locations | View room maps, position markers, and manage the location tree |
| Categories | Rename, add, and delete the flat category list |
| Flag queue | Work anonymous reports: jump to the item, fix it, resolve |
| Recycle bin | Retired items, restorable — nothing is ever destroyed |

Each item belongs to **one or more categories**. In the item editor, open
**Categories** and toggle every applicable category; all selected names remain
visible. An item appears under each assigned category, while search and the
Project Assistant match every category name. Item details and the staff grid
display all assignments. A category cannot be deleted while any item uses it,
including an item in the recycle bin.

Existing single-category records remain readable: legacy `categoryId` values
are converted to a one-entry `categoryIds` array when loaded. Normal saves write
the new format; no inventory reset or reseeding is needed.

Items and the recycle bin share one multi-select table. Tick any number of rows
and the action bar offers **Move to**, **Replace categories**, **Save**, and **Delete**
(or **Restore** in the bin). Location and category
choices are drafts until **Save** applies them together in one transactional
write. **Replace categories** replaces the entire category set on every selected
item; leaving it blank keeps existing categories unchanged. Use the row
checkboxes or select-all checkbox to change the selection;
changing the selection clears its draft. If a save fails, the choices and selection
remain available to correct or retry. **Delete** sends items to the recycle bin;
it does not apply any unsaved location or category changes.
**Edit** uses a paintbrush icon in item rows and details, **New item** uses a
plus, and the bulk **Save** control uses a save icon. Each active item row also has a
delete icon beside **Edit**, which moves only that item to the recycle bin,
regardless of other checked rows. Icon buttons include tooltips and accessible
labels. Category **Rename**, **Delete**, **Save**, and **Cancel** use the same
paintbrush, trash, save, and X icon style.

The table keeps names, kinds, categories, location paths, and status/stock levels
in left-aligned columns. Kind and status/stock cells and filters use readable
labels such as **Equipment**, **In use**, and **Out of stock**, while stored values
and filter URLs stay unchanged. Click a column header to toggle ascending/descending
sorting, and combine the filters beneath the headers to narrow the list.
Kind, category, location, and status/stock filters accept multiple choices using
searchable option lists. Click an option to toggle its lighter selected
background; keyboard users can focus an option and press Enter or Space.
Choices within a column match **any** selected value;
different columns combine with **AND**. Selecting a location includes its
sub-locations. No choices means no restriction for that column. Name stays a text
search; **Clear filter** clears one column without resetting the others.
**Reset filters** shows all rows again. Select-all applies only to the filtered
rows; filtered-out items are unchecked, while sorting preserves the selection.
The recycle bin also has a sortable deletion-date column (newest first by default).
Headers stay visible while scrolling through the grid.

Location editing fields use the same single-choice searchable picker: **Move to**, the item
editor, bulk-entry defaults, and the parent fields for new or existing locations.
It matches on the full breadcrumb, so
`electronics` reaches every bin under that bench, and every token must match the
start of a word — `bin b3` and `b3 bin` find the same node, while `bin` doesn't
drag in every Cabinet. Arrows move the highlight, Enter picks, Escape closes.
Forms retain the chosen location until another result is selected; typing alone
does not change it, and Escape or leaving the field restores its displayed path.
Parent pickers include **Top level (no parent)** and exclude the location being
edited and its descendants. All matching locations are reachable by scrolling.

**Delete never permanently destroys an item.** It sets a `retiredAt` timestamp;
the record and its id survive, because the assistant grounds recommendations on
ids and a reused id would resolve to the wrong physical object. There is
deliberately no route that destroys an item.

Retirement is a shared field rather than an equipment status, so consumables
retire the same way. `isRetired` in `packages/shared` is the one predicate used
by search, assistant candidates, and the bin.

**New item** and **Bulk entry** sit in the Items view header beside the title and
item count. **Bulk entry** expands inline below the header and above the grid,
rather than opening a separate page. Collapsing it keeps any unsubmitted rows
while you stay on Items.
It takes one item per line — `name, kind, status/stock, training, tags`
— where only the name is required and everything else falls back to defaults
picked in the form. A live preview shows exactly what will be created, and the
batch is committed in a single write or not at all.
**Default categories** accepts multiple selections and applies the complete set
to every new row.

### Navigation and bookmarks

Navigation uses real URLs and browser history:

| URL | View |
|---|---|
| `/` | Shared Search & ask interface, with category browsing |
| `/?q=solder&item=itm-solder` | A search with an item detail open |
| `/?mode=ask&q=Build+a+planter` | Shared input ready to Ask about a project |
| `/assistant` | Legacy link; redirects to the shared interface in Ask mode, preserving query parameters |
| `/maps?room=loc-common-makerspace` | Common Makerspace floor plan |
| `/maps?room=loc-advanced-makerspace&location=loc-advanced-table-3` | Advanced Makerspace with Table V selected (stable location ID) |
| `/manage/items` | Items grid |
| `/manage/items/new` | New item form |
| `/manage/items/<id>/edit` | Edit an item |
| `/manage/locations?room=loc-common-makerspace&pin=loc-common-table-8` | Location tree and marker editor for Table C |
| `/manage/categories` | Categories |
| `/manage/flags` | Flag queue |
| `/manage/recycle-bin` | Recycle bin |

Grid filters are query parameters (`q`, repeated `kind`, `category`, `location`,
and `state`); sorting uses `sort` and `order=asc|desc`. `bulk=1` expands inline
Bulk entry, and `resolved=1` includes resolved flags. Back, Forward, and reload
restore these views. Typing in search replaces the current history entry rather
than adding one per character.

Staff bookmarks retain their destination while waiting for sign-in. A URL never
grants staff access. Passwords, assistant prompts/responses, checkbox selections,
and unsaved form drafts are not stored in URLs.

Leaving an edited item or a new-item draft opens an **Unsaved changes** dialog.
**Stay on page** keeps the draft; **Discard changes** continues to the requested
page without saving. This covers navigation links, Cancel, and Back/Forward.
Reloading or closing the tab uses the browser's standard warning, and sign-out
also asks before discarding a draft. Unchanged or successfully saved forms do not
warn; failed saves keep the draft protected.

Vite's dev and preview servers support direct links. A production frontend host
must serve `index.html` for client-side routes (without rewriting `/api` calls or
asset requests); the API remains under `/api`.

Writes are guarded so the catalog can't be left in a state that won't load:

- An item can't reference a category or location that doesn't exist
- A location can't be moved inside its own subtree
- A location holding items or sub-locations can't be deleted
- A category still in use can't be deleted
- Kind-specific fields can't be bulk-applied to the wrong kind
- Retiring is a status, never a delete — the record and its ID survive

Every guard is enforced server-side; the UI only mirrors it.

## Storage

Two backends behind one `CatalogRepository` interface, selected by `STORAGE`:

| `STORAGE` | Backend | Use |
|---|---|---|
| `json` (default) | Files under `data/runtime` | Local dev, no Azure needed |
| `cosmos` | Azure Cosmos DB | Deployed |

Cosmos uses a **single container partitioned on `/type`** (`item`/`location`/`category`/`flag`). One container at 400 RU/s fits the free tier's 1000 RU/s; four containers would need a 400 RU/s minimum each and blow past it.

Records are stored as-is. `Item` is a discriminated union whose arms carry different required fields, so documents avoid the nullable-column-plus-CHECK dance a relational store would need. Referential integrity stays where it already was — `findCatalogProblems` plus the route guards — since Cosmos has no foreign keys.

To provision and load it:

```powershell
# validate without changing anything
.\scripts\deploy-infra.ps1 -SubscriptionId <your-sub-id> -WhatIf

# first deployment: choose a region with Cosmos capacity
.\scripts\deploy-infra.ps1 -SubscriptionId <your-sub-id> -CosmosLocation eastus2

# subsequent deployments reuse the existing account's region
.\scripts\deploy-infra.ps1 -SubscriptionId <your-sub-id>

# add the printed COSMOS_* values to .env, then
npm run seed:cosmos
```

Infrastructure lives in [`infra/`](infra/) as Bicep, deployed at subscription scope so it owns the resource group too:

```
infra/
  main.bicep            Resource group + module wiring
  modules/cosmos.bicep  Account, database, container, data-plane role
```

The deploy script refuses to run against the Microsoft corporate tenant, registers the resource providers a new subscription lacks, and passes your object id in for the Cosmos data-plane role assignment. That role is not optional: **Cosmos data-plane RBAC is separate from Azure RBAC**, so subscription Owner grants no data access at all.

On retries (including `-WhatIf`), the script looks up the account named in the
resource group's `cosmos` module deployment and preserves its actual location,
even if the earlier deployment failed after account creation. An explicit
`-CosmosLocation` that conflicts with that account is rejected before deployment;
the script does not move, delete, rename, or replace the account. If there is no
existing account recorded by that deployment, Cosmos defaults to `-Location`
(`eastus`) unless `-CosmosLocation` is supplied.

For `InvalidResourceLocation` reporting an existing account in `eastus2`, rerun
with `-CosmosLocation eastus2`, keeping `-Location` at the resource group's
original region. Also supply the existing account's region when using Bicep
directly or if deployment history has been removed. Upgrading Bicep does not
resolve a resource location conflict.

Notes on the template:

- **Free tier can only be set at creation.** An existing account can't be converted, and there's one per subscription. Pass `enableFreeTier=false` if the slot is already used.
- **Account name is derived from the subscription and group**, not random, so re-running reconciles instead of orphaning the account and burning the free slot.
- **`disableLocalAuth: true`** — keys are off, so Entra ID is the only way in and there's no secret to leak or rotate.
- **`totalThroughputLimit: 1000`** caps the account as a hard stop against surprise charges.
- **`cosmosLocation` is separate from `location`.** Cosmos capacity varies by region — East US returned `ServiceUnavailable` for a new account while East US 2 worked — and a resource group's location can't be changed after creation.

Auth uses `DefaultAzureCredential` when `COSMOS_KEY` is empty — managed identity in Azure, your `az login` locally. Leave it empty.

## Local caching

The app uses two complementary catalog caches without changing the configured
storage backend:

| Layer | Behavior |
|---|---|
| Cosmos API repository | One process-wide snapshot of items, locations, and categories; **1-hour TTL** by default |
| Browser | Versioned `localStorage` snapshot for fast repeat loads and cached browsing; marks data stale after **5 minutes** |
| JSON local-development repository | Already holds its files in memory; no additional server cache |

`CATALOG_CACHE_TTL_MS` configures the Cosmos cache in milliseconds. Zero disables
reuse after a request completes; invalid or negative values fail explicitly.
Concurrent reads share one fetch of each collection. Item create/edit,
bulk operations (including retire/restore), and location/category
create/edit/delete immediately invalidate the complete server snapshot.
Failed writes also invalidate because storage may have committed before a
response was lost. Flags are not cached. All routes and assistant retrieval use
the same repository wrapper.

The one-hour TTL assumes **one API server and catalog writes through it**.
Changes made directly in Cosmos (including `seed:cosmos`) require a server
restart or expiry before they become visible; browser **Refresh catalog** does
not bypass the server cache. The cache does not add database transactions or
cross-process invalidation. For JSON resets or direct file edits, restart the
API to reload its in-memory data.

The browser shows saved data immediately, then revalidates on page load, window
focus, reconnect, and **Refresh catalog**. Successful staff catalog mutations
invalidate the saved snapshot and refetch. Another tab's saved catalog is
adopted without an echoing network request; cross-tab invalidation triggers a
refresh. Incoming updates wait while staff have unsaved catalog forms, bulk
drafts, or map edits.

Failed refreshes keep the current view and display a warning and retry button
instead of replacing the app with an error screen. Cached locations, status,
and safety/training data are explicitly labelled as potentially outdated.
Writes still require the API: there is no offline write queue or simulated
success. The displayed timestamp is when the browser fetched the catalog,
**not** when the database was last changed; a server response may already be up
to the server TTL old.

Both caches use `@garage/shared` validation and preserve `retiredAt`, all
location kinds, map metadata, and verbatim safety text. The browser key is
`garage-inventory:catalog:v2`; incompatible earlier drafts are not reused.
Malformed saved data is reported and removed; blocked storage or quota failures
are reported while network-backed use can continue in memory. Only public
catalog data is persisted, not staff sessions, searches, flags, or assistant
inputs/responses. Clearing this site's local storage clears its saved catalog.
Clear it when switching the backend behind the same origin.

This is data caching, not offline app installation: loading the HTML/JS still
requires the web server, and there is no service worker. Kiosk idle reset remains
unimplemented; when added, it should refresh the catalog while clearing visitor
input, not the saved public catalog.

## Not built yet

- Photos are URLs only — no upload
- Kiosk idle reset, browse-by-location walking UI for visitors
- The hosted assistant provider is implemented but has not been run against real
  credentials

## Conventions worth knowing

- **Never write to `data/seed` from the app.** The app reads and writes
  `data/runtime` only, so demo edits never show up as a working-tree diff.
- **Location paths are derived, never stored.** `getLocationPath` in
  `packages/shared` is the only place that walks the tree.
- **Item IDs are permanent and never reused**, including after retirement —
  the assistant grounds recommendations on them.
- **The assistant may choose items; it may never author facts about them.**
  Names, locations, training, and safety text are read from the catalog record
  after the model responds. IDs that don't resolve are dropped and logged.
- **The LLM API key never reaches the browser.** No `VITE_`-prefixed secrets,
  ever — Vite inlines those at build time.
