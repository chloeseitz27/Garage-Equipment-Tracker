# GET IT — Product Specification

Garage Equipment Tracker & Inventory Tool

**Status:** Draft
**Last updated:** 2026-09-15
**Context:** Hackathon project for the Microsoft Garage, Reston

---

## 1. Problem

The Reston Garage holds a large, growing collection of maker equipment and
consumable supplies. People cannot reliably find what they need. They either
don't know an item exists, or they know it exists but not where it lives. Time
that should go into building goes into hunting through bins and cabinets, and
duplicate purchases happen because nobody could find the thing that was already
on a shelf.

**This tool is a findability tool first.** Every other capability is secondary
to answering one question quickly: *"Do we have X, and where exactly is it?"*

A second, related problem sits just upstream of that one: people often can't
name what they need. They don't know the Garage owns a particular tool, so they
never search for it. The Project Assistant (§6.6) addresses that by turning a
project description into a list of real Garage items — but it is in service of
the same goal. Both paths end at *"here is the thing, and here is where it is."*

### Explicit non-goals

The following are deliberately out of scope. Attempting them produces data
nobody maintains, which erodes trust in the data that matters.

- **Accurate consumable quantity tracking.** We will not count filament grams,
  resistors, or screws. Nobody will keep it current.
- **Checkout / return workflows and tool accountability.** Not solving "who took
  the multimeter" in v1.
- **Purchasing, budgeting, or asset depreciation.**
- **Reservations or scheduling of equipment.**

---

## 2. Users

| User | Need | Frequency |
|---|---|---|
| **Visitor / maker** | Standing in the Garage mid-project, needs to find a specific tool or material | Many times per visit |
| **Garage staff** | Keeps the catalog accurate; adds new items, corrects locations, retires broken gear | Weekly |
| **New visitor** | Browsing to discover what the space offers | Once or twice |

Staff are the only people who write data. Everyone else reads.

---

## 3. Primary surface

A **desktop web app running on a dedicated kiosk station inside the Garage.**

Design implications:

- Optimized for a single large screen, keyboard, and mouse. Not mobile-first.
- Search field is focused on page load and after every idle timeout.
- The session resets to a clean home/search state after a period of inactivity
  so the next person doesn't inherit someone else's search.
- Text and touch targets sized for someone reading from a step or two back.
- Assume the kiosk is inside a badge-access space; treat the local network as
  trusted for read access.

The app should remain usable in a regular desktop browser so staff can maintain
the catalog from their own machines.

---

## 4. Access model

| Action | Who |
|---|---|
| Browse, search, view item detail | Anyone, no sign-in |
| Create, edit, move, retire items | Staff only, authenticated |
| Manage locations | Staff only, authenticated |
| Manage the staff list | Staff only, authenticated |

Anonymous read access is the default because the kiosk must be instantly usable
with zero friction. Staff authenticate to unlock edit controls; when
unauthenticated, edit affordances are hidden rather than shown-and-disabled.

Authentication mechanism is a technical decision, deferred to the technical
spec. Requirement: a staff member can sign in and out at the kiosk in seconds,
and an abandoned staff session expires automatically.

---

## 5. Core concepts

### 5.1 Item

The thing a person is looking for. Two kinds, sharing one catalog and one search
index.

**Equipment** — durable, individually meaningful, has a specific home location.
A 3D printer, a soldering station, a specific oscilloscope.

**Consumable** — stock material, fungible, tracked by *availability* rather than
count. PLA filament, solder, sandpaper, jumper wires.

Shared fields:

| Field | Required | Notes |
|---|---|---|
| Name | Yes | Common name people would actually search for |
| Kind | Yes | `equipment` or `consumable` |
| Categories | Yes | One or more, e.g. Electronics and Hand Tools; no duplicate assignments |
| Location | Yes | Reference to a location node (§5.2) |
| Description | No | What it is, what it's for |
| Photo | No | Strongly recommended — a picture disambiguates faster than words |
| Tags / aliases | No | Alternate names people search for ("hot glue" → "glue gun") |
| Good for | No | Project types this item suits; improves Project Assistant matching |
| Notes | No | Quirks, "the left one is broken", safety warnings |

Equipment-only fields:

| Field | Required | Notes |
|---|---|---|
| Status | Yes | `available`, `in use`, `out for repair`, `retired` |
| Quantity | Yes | Usually 1; small integer for identical units |
| Training required | Yes | `none`, `orientation`, `supervised`, `certified` |
| Safety notes | No | Verbatim text; shown wherever the item appears |

Consumable-only fields:

| Field | Required | Notes |
|---|---|---|
| Stock level | Yes | `in stock`, `low`, `out` — a coarse manual flag, never a count |

Stock level is set by hand by staff or flagged by any user (§6.4). It is an
honest, low-effort signal. It is explicitly not derived from usage.

Consumables may also carry safety notes (solvents, resins, adhesives).

### 5.2 Location

Locations form a hierarchy so the app can render a full walkable path:

```
Room  →  Zone / Area  →  Shelf / Cabinet  →  Bin
```

Example: `Main Shop → Electronics Bench → Cabinet B → Bin 4`

Rules:

- An item attaches to a node at **any** depth. A 3D printer sits at a Zone; a
  bag of M3 screws sits in a Bin.
- Every item detail view shows the **full breadcrumb path** from Room down, so
  a person can navigate physically without prior knowledge of the space.
- Levels below Room are optional. A location tree that is only two deep is
  valid.
- Locations are browsable in their own right: "show me everything in Cabinet B."

Room maps use the supplied Common Makerspace and Advanced Makerspace plans.
Locations can carry map markers; items inherit them through their location path.
Selecting a map marker lists active items at or beneath that location. Item
details highlight the closest mapped location, stating when it is a parent
rather than the exact bin. Staff can position or remove markers with an explicit
save. Floor plans do not imply any tool availability or unverified item placement.

Table/bench letters are unique across rooms. Common runs A-M clockwise from the
top-right table. Advanced runs S-Z clockwise from the top-left workbench,
continuing left to right across the top, down the right side, and back around
the lower and left portions of the room. The six central Common tables are shared work surfaces,
not storage destinations; draw them without individual labels or map markers.
Drawers use numbers appended to the surface letter, such as D2.

### 5.3 Category

A flat, staff-managed list used for browsing and filtering. Categories are for
discovery ("what woodworking tools are here?"); tags are for search recall.
An item can belong to multiple categories and appears under each of them. Search
and project matching use every assigned category. Category deletion is blocked
while any active or retired item references it.

---

## 6. Functional requirements

### 6.1 Search — the primary path

- Single search box, focused on load, matching across name, aliases/tags,
  category, description, and location name.
- Search and the Project Assistant share this input, with **Search** and **Ask**
  actions. Enter searches; only Ask sends an assistant
  request. Results appear as the user types while viewing inventory results.
- Clearing the input, including whitespace-only text, leaves Ask mode, clears
  category filters and item selection, and shows the whole active inventory
  without a result cap. Submitting a blank Search also clears category filters;
  users can still explicitly browse a category while the input is empty.
- Tolerant of imprecision: partial words, plurals, and minor misspellings should
  still surface the right item. Someone typing "solder" must find both the
  soldering iron and the solder wire.
- Each result row shows, at a glance: photo thumbnail, name, kind, and the
  location path. **A result that doesn't show where the thing is has failed.**
- Empty state for zero results must be useful — suggest categories to browse and
  make it obvious the Garage may simply not have the item.

### 6.2 Browse

- Browse by category, and browse by location (walk the hierarchy).
- Location browse doubles as a shelf-audit view for staff.

### 6.3 Item detail

- Photo, name, all categories, kind, status or stock level, description, notes.
- Full location breadcrumb, prominent and legible from a step back.
- Related items from the same location and the same category.

### 6.4 Reporting a problem (anonymous, one click)

Any user, without signing in, can flag an item:

- **"Not here"** — it wasn't in the stated location
- **"Running low" / "Out"** — for consumables

These create a lightweight staff queue rather than mutating the record. This is
the pressure valve that keeps the catalog honest without requiring accounts,
and it is the only write path available to anonymous users.

### 6.5 Staff management

- Add, edit, retire items. Retired items leave search but are not destroyed.
- Move an item to a different location in a couple of clicks.
- Manage the location tree and category list.
- Select one or more categories in the item editor and bulk-entry defaults.
  Bulk recategorization explicitly replaces the complete category set; leaving
  the bulk category selection blank keeps existing assignments unchanged.
- Work the flag queue: confirm, correct, or dismiss reports.
- Bulk entry matters — cataloging a whole shelf one modal at a time is the
  fastest way to abandon this project.

### 6.6 Project Assistant

The **Ask** action on the main search box takes a project description and returns
a grounded list of Garage items to use, each with its location — plus a clearly
separated note of useful things the Garage does not have. There is no separate
assistant input or navigation tab; Search returns to inventory results using the
same text. Both actions open the same item detail surface.

Specified in full in [`chatbot-spec.md`](chatbot-spec.md). Key constraints that
bind the rest of this spec:

- Recommendations must resolve to real catalog records; nothing may be presented
  as in the Garage unless it is
- Training and safety text comes verbatim from catalog fields (§5.1)
- The assistant deliberately does not assert availability, because our
  availability data isn't trustworthy enough to act on

---

## 7. Quality requirements

| Requirement | Target |
|---|---|
| Time to find a known item | Under 10 seconds from kiosk home screen |
| Search responsiveness | Results update within ~200ms of a keystroke |
| Cold load on kiosk | Under 2 seconds |
| Accessibility | Keyboard navigable; legible at a distance; sufficient contrast |
| Data durability | Catalog survives restarts; backup/export is possible |

---

## 8. Hackathon scope

**Deliverable: a working demo, running on seeded sample data.**

Must have:

- Seeded data set representative of the real Garage — enough categories, a
  realistic multi-level location tree, and a believable mix of equipment and
  consumables
- Search with live results and location paths
- Browse by category and by location
- Item detail with breadcrumb
- Staff sign-in gating visible edit controls
- Create and edit an item
- Project Assistant answering seeded-data project prompts, with locations and
  safety surfaced (see `chatbot-spec.md` §10)

Nice to have, if time allows:

- Photos on items
- Flag / report flow
- Bulk entry
- Kiosk idle reset
- Assistant refine-by-re-asking

Post-hackathon:

- Entering the real Garage inventory
- QR codes on bins linking to location pages
- Mobile-friendly layout
- Checkout / accountability, if it ever proves necessary

---

## 9. Open questions

- Who are the named Garage staff for the initial staff list?
- Is there an existing spreadsheet or list of Garage inventory we can seed from?
- Does the Garage have an existing location/zone naming convention we should
  adopt rather than invent?
- What are the real training tiers, and who owns safety text? (See
  `chatbot-spec.md` §11 — safety is the one field where a wrong value has
  physical consequences.)
- Where will the kiosk physically live, and what hardware is it?
- Where does this get hosted, and who owns it after the hackathon?
