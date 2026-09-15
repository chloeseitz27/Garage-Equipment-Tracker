# Garage Inventory

Inventory organization and tracking tool for the Microsoft Garage in Reston.

Hackathon project.

**This is a findability tool first.** Everything else is secondary to answering
one question quickly: *"Do we have X, and where exactly is it?"*

## Status

Specifications are drafted and the workspace is scaffolded with seeded demo
data. Search, browse, item detail, anonymous flagging, staff sign-in, and the
Project Assistant pipeline all run end to end against `data/seed`.

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

## Not built yet

- Staff UI for creating and editing items — the API routes exist, but there is
  no form
- Bulk entry (product spec §6.5)
- Photos, kiosk idle reset, browse-by-location walking UI
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
