# Garage Inventory

Inventory organization and tracking tool for the Microsoft Garage in Reston.

Hackathon project.

**This is a findability tool first.** Everything else is secondary to answering
one question quickly: *"Do we have X, and where exactly is it?"*

## Status

Specifications are drafted and the app runs end to end against seeded demo
data: search, browse, item detail, anonymous flagging, the Project Assistant,
and a full staff editing surface for every data source.

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

`data/seed` holds 79 items (47 equipment, 32 consumable) across 10 categories
and a 27-node location tree, including a retired item and one piece of equipment
out for repair so those paths get exercised. It is plausible fiction, not the
real Garage inventory — see the open questions in the product spec.

## Staff editing

Sign in with the staff passphrase and a **Manage catalog** tab appears, with one
surface per data source:

| Tab | Does |
|---|---|
| Items | Filter, create, and edit any item — every field, including safety notes |
| Bulk entry | Paste or type one row per item to catalog a whole shelf at once |
| Locations | Walk the tree; rename, re-parent, add, and delete nodes |
| Categories | Rename, add, and delete the flat category list |
| Flag queue | Work anonymous reports: jump to the item, fix it, resolve |
| Recycle bin | Retired items, restorable — nothing is ever destroyed |

Items and the recycle bin share one multi-select table. Tick any number of rows
and the action bar offers **Move to** a location, **Category**, and **Retire**
(or **Restore** in the bin). Each action is a single transactional write, so a
shelf move lands completely or not at all.

**Nothing in this app deletes an item.** Retiring sets a `retiredAt` timestamp;
the record and its id survive, because the assistant grounds recommendations on
ids and a reused id would resolve to the wrong physical object. There is
deliberately no route that destroys an item.

Retirement is a shared field rather than an equipment status, so consumables
retire the same way. `isRetired` in `packages/shared` is the one predicate used
by search, assistant candidates, and the bin.

Bulk entry takes one item per line — `name, kind, status/stock, training, tags`
— where only the name is required and everything else falls back to defaults
picked in the form. A live preview shows exactly what will be created, and the
batch is committed in a single write or not at all.

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

# deploy (idempotent — safe to re-run)
.\scripts\deploy-infra.ps1 -SubscriptionId <your-sub-id> -CosmosLocation eastus2

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

Notes on the template:

- **Free tier can only be set at creation.** An existing account can't be converted, and there's one per subscription. Pass `enableFreeTier=false` if the slot is already used.
- **Account name is derived from the subscription and group**, not random, so re-running reconciles instead of orphaning the account and burning the free slot.
- **`disableLocalAuth: true`** — keys are off, so Entra ID is the only way in and there's no secret to leak or rotate.
- **`totalThroughputLimit: 1000`** caps the account as a hard stop against surprise charges.
- **`cosmosLocation` is separate from `location`.** Cosmos capacity varies by region — East US returned `ServiceUnavailable` for a new account while East US 2 worked — and a resource group's location can't be changed after creation.

Auth uses `DefaultAzureCredential` when `COSMOS_KEY` is empty — managed identity in Azure, your `az login` locally. Leave it empty.

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
