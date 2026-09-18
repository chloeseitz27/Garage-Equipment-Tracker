# Feature Specification — Project Assistant (Chatbot)

**Status:** Draft
**Last updated:** 2026-09-15
**Parent spec:** [`product-spec.md`](product-spec.md)

---

## 1. Purpose

Search solves *"where is the thing I already named."* This feature solves the
harder question that comes first:

> *"I want to build a weather station that logs to a laptop. What do I need, and
> is any of it here?"*

A visitor with a project in mind often cannot name the tools they need. They
don't know the Garage owns a reflow oven, so they will never search for one.
The Project Assistant turns a **project description** into a **concrete list of
Garage items**, each with a location, so the next step is walking to a shelf
rather than browsing categories hoping for inspiration.

This is a discovery feature. It complements search; it does not replace it.

---

## 2. Interaction model

**One-shot, with refinement by re-asking.**

1. User describes their project in the main search box and chooses **Ask**.
   **Search** (or Enter) uses the same text to find inventory instead.
2. Assistant returns a structured recommendation below the shared input.
3. User can ask again with more detail to refine. Each ask is treated as a fresh
   request — there is no requirement to maintain long conversational memory.

Search, category browsing, and the assistant share the home page; there is no
separate assistant tab, text area, or example prompts. Ask is disabled for blank
input and while waiting for a response;
Search remains available and cancels a pending request. Errors are shown inline
without clearing the input so the user can retry. The legacy `/assistant` URL
redirects to the shared page, preserving the query and selected item. Bookmarks
and browser history never automatically send assistant requests.

Rationale: this runs on a shared kiosk. A long conversational thread is the
wrong shape for a walk-up surface where the next person arrives two minutes
later. One good answer, refinable, beats a chat log.

Kiosk implications:

- The assistant's input and output are cleared by the same idle reset that
  clears search (product spec §3). No one inherits the previous person's
  project.
- Keep the empty state focused on the shared input and its Search and Ask
  actions, without example prompts.

---

## 3. What it recommends

### 3.1 Both equipment and consumables

Recommendations cover the durable tools needed **and** the consumable materials
the project will burn through. A user told to use the 3D printer but not told
they'll need filament has been given half an answer.

### 3.2 Two clearly separated tiers

| Tier | Meaning | Presentation |
|---|---|---|
| **In the Garage** | Item exists in the catalog | Primary. Name, kind, and full location path. Links to item detail. |
| **Not in the Garage** | Genuinely useful for this project, but not in the catalog | Clearly separated secondary section, visually distinct, labelled as *not available here* |

The second tier exists because a recommendation limited to what's on the shelf
can silently mislead — if the project needs a part the Garage doesn't stock, the
user needs to know that *before* they start, not after.

**Hard requirement:** the two tiers must never blur. An item shown in the
"In the Garage" tier must resolve to a real catalog record with a real location.
No generated item may be presented as though the Garage owns it. See §6.

---

## 4. Availability is deliberately ignored

The assistant **does not filter or flag on availability.** It recommends items
regardless of equipment status or consumable stock level.

This follows directly from an honest read of our own data. Per the product spec,
consumable stock is a coarse, manually maintained flag that we expect to be
stale. Equipment status is better but still not reliably current. Surfacing
either as an authoritative "this is out" signal would make the assistant
confidently wrong — worse than saying nothing.

The important asymmetry:

- **Catalog membership is reliable.** Whether the Garage owns a band saw is a
  slow-changing fact we can trust. The assistant leans on it fully.
- **Current availability is not reliable.** Whether the band saw is working
  today, or whether there's PLA left, is fast-changing and under-maintained.
  The assistant stays silent on it.

Users still reach the live (if imperfect) status by clicking through to item
detail, where the flag lives alongside the caveats. Status is one click away and
in context — just not asserted by the assistant.

> **Revisit trigger:** if the flag queue (product spec §6.4) proves that stock
> flags are kept current in practice, reconsider this. The decision is about
> data quality, not principle.

---

## 5. Safety and training

When a recommended item requires training, certification, or supervision, the
assistant **must** surface that alongside the recommendation.

Recommending a table saw to someone who has never used one, with no indication
that it's a supervised tool, is the one way this feature can cause actual harm
rather than mild annoyance.

Requirements:

- Items carry structured safety metadata in the catalog (see §8 — this adds a
  field to the item model).
- Safety and training text shown by the assistant is rendered **verbatim from
  catalog data**. It is never generated, paraphrased, or summarized.
- Safety information is a property of the item, so it appears identically on the
  item detail page and in assistant output. One source of truth.
- Items requiring supervision are visibly marked in recommendation results, not
  only in a detail view the user may never open.

An item in the "Not in the Garage" tier carries no catalog record and therefore
no verified safety data. The assistant must not invent safety guidance for it.
Those entries stay brief — what it is and why it's useful — and nothing more.

---

## 6. Grounding and honesty requirements

These are correctness requirements, not polish.

1. **No invented inventory.** Every "In the Garage" recommendation maps to an
   existing catalog record by ID. If it cannot be resolved, it is not shown in
   that tier.
2. **No invented locations.** Location paths are read from the catalog record,
   never produced by the model.
3. **No invented safety guidance.** Per §5, verbatim from catalog or absent.
4. **Graceful empty result.** If the Garage has little or nothing relevant, say
   so plainly. Padding a thin answer with loosely related items to look helpful
   trains people to distrust the whole tool.
5. **Out-of-scope requests.** If the input isn't a project description, the
   assistant should redirect to search rather than improvising.

Requirement 1 is the one that matters most. A user who walks to a shelf for an
item the Garage never owned will not use this feature again — and the harm is
larger than that, because it undermines confidence in the catalog itself, which
is the actual product.

---

## 7. Output shape

A recommendation response contains:

- **A one-line restatement** of the understood project, so a misread is obvious
  immediately rather than after reading a full list
- **In the Garage** — grouped by equipment and consumables. Each entry: name,
  full location path, one line on why it's relevant, safety marker if
  applicable, link to item detail
- **Not in the Garage** — plain list, each with a one-line reason, clearly
  marked as unavailable here
- **A refine affordance** — an obvious way to ask again with more detail

Every in-Garage entry must show its location. A recommendation that doesn't tell
you where the thing is has failed the same test as a search result that doesn't
(product spec §6.1).

---

## 8. Impact on the item model

This feature adds fields to the item model in product spec §5.1.

New equipment fields:

| Field | Required | Notes |
|---|---|---|
| Training required | Yes | `none`, `orientation`, `supervised`, `certified` |
| Safety notes | No | Verbatim text shown wherever the item appears |

New shared fields:

| Field | Required | Notes |
|---|---|---|
| Good for | No | Project types / use cases this item suits — improves matching for items whose names don't describe their use |

Consumables may also carry safety notes (solvents, resins, adhesives).

---

## 9. Privacy

Project descriptions are typed on a **shared, unauthenticated kiosk**.

- Do not require sign-in to use the assistant.
- Do not retain inputs tied to an individual.
- If inputs are logged at all to improve recommendations, log them anonymously,
  say so on the surface, and keep them short-lived.
- Clear input and output on idle reset (§2).

---

## 10. Hackathon scope

Aligned with the demo-on-seeded-data scope in product spec §8.

Must have:

- Free-text project input on the kiosk
- Recommendations grounded in seeded catalog data, resolving to real records
- Clear separation of the in-Garage and not-in-Garage tiers
- Location path on every in-Garage recommendation
- Training/safety surfaced from catalog data
- A handful of rehearsed demo scenarios that exercise the seed data well

Nice to have:

- Refine-by-re-asking
- Example prompts on the empty state
- Links through to item detail

Out of scope for the hackathon:

- Conversational memory across turns
- Personalization or history
- Step-by-step project instructions — this recommends tools, it does not teach
  woodworking

---

## 11. Open questions

- What are the real training tiers in the Reston Garage? The values in §8 are a
  guess and should match whatever the Garage actually enforces.
- Who owns and reviews safety text? This is the one field where a wrong value
  has physical consequences, and it should not be crowd-edited.
- Should staff see what people are asking for? Aggregate, anonymous demand data
  would be genuinely useful for purchasing decisions — but it interacts with §9
  and needs a deliberate decision rather than accidental logging.
- How do we evaluate recommendation quality? Worth defining a small fixed set of
  project prompts with expected items, so changes can be checked against it.
