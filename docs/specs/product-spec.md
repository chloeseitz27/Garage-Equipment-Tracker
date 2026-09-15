# Garage Inventory — Product Specification

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
| Category | Yes | e.g. 3D Printing, Electronics, Woodworking, Hand Tools |
| Location | Yes | Reference to a location node (§5.2) |
| Description | No | What it is, what it's for |
| Photo | No | Strongly recommended — a picture disambiguates faster than words |
| Tags / aliases | No | Alternate names people search for ("hot glue" → "glue gun") |
| Notes | No | Quirks, "the left one is broken", safety warnings |

Equipment-only fields:

| Field | Required | Notes |
|---|---|---|
| Status | Yes | `available`, `in use`, `out for repair`, `retired` |
| Quantity | Yes | Usually 1; small integer for identical units |

Consumable-only fields:

| Field | Required | Notes |
|---|---|---|
| Stock level | Yes | `in stock`, `low`, `out` — a coarse manual flag, never a count |

Stock level is set by hand by staff or flagged by any user (§6.4). It is an
honest, low-effort signal. It is explicitly not derived from usage.

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

### 5.3 Category

A flat, staff-managed list used for browsing and filtering. Categories are for
discovery ("what woodworking tools are here?"); tags are for search recall.

---

## 6. Functional requirements

### 6.1 Search — the primary path

- Single search box, focused on load, matching across name, aliases/tags,
  category, description, and location name.
- Results appear as the user types; no submit button required.
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

- Photo, name, category, kind, status or stock level, description, notes.
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
- Work the flag queue: confirm, correct, or dismiss reports.
- Bulk entry matters — cataloging a whole shelf one modal at a time is the
  fastest way to abandon this project.

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

Nice to have, if time allows:

- Photos on items
- Flag / report flow
- Bulk entry
- Kiosk idle reset

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
- Where will the kiosk physically live, and what hardware is it?
- Where does this get hosted, and who owns it after the hackathon?
