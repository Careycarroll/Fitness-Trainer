# Training Planner

Offline-first, single-user training planner. Tell it how many days you want and what style you
want to train; it generates the sessions — a single week or a multi-week periodized block — and
adapts from logged performance.

**One-line scope test:** if a feature does not help decide *what to do in the gym today*, it is
out of MVP.

---

## Run it

```bash
npm install
npm run dev        # local dev server
npm run validate   # definition-file validators (10 validators, ~2,800 checks)
npm test           # engine unit tests
npm run check      # both — run this before every commit
npm run build      # validate, then build (build fails if data is invalid)
```

---

## How it is put together

```
js/
  data/        definition files — JSON, schema-validated in CI
  engine/      the rules engine — pure functions, no I/O
    SPEC.md    ← authoritative schema contract. Read this before touching data.
  storage/     IndexedDB layer (gated to M6 — see ADR-011)
  ui/          rendering only; no planning logic
scripts/
  validate.js  validator runner
  checks/      one file per validator
docs/adr/      architecture decision records — immutable once accepted
```

### The one rule that matters

**Data holds values. Code holds shapes.**

A training style that needs different *numbers* — rep ranges, percentages, work/rest bands — is
a record in `styles.json`, shipped in an hour. A style that needs a different *shape* — AMRAP
scored by rounds rather than sets by percentage — is a new generator, ~200 lines, written once.

Control flow, safety gates and validators never become data. A dropped key in JSON silently
disables a safety gate; the same mistake in code fails a test at commit time. Full reasoning and
a mechanical promotion test: **[ADR-012](docs/adr/ADR-012-data-code-boundary.md)**.

`scripts/checks/10-no-logic-in-data.js` enforces this automatically — it fails the build on keys
named `if`/`when`/`then`, stored expressions, or arrays of operation objects.

---

## Current state

| Milestone | Status |
|---|---|
| M0 Scaffolding, ADRs, CI | done |
| M1 Schema contract (`SPEC.md`) | done |
| M2 Seed catalog — 24 records, every pattern ×2 | done |
| M3 Load-domain generator | done |
| M4 Full catalog authoring (~180–220 records) | **next — the long pole** |
| M5 UI shell | shell only |
| M6 Logger + IndexedDB + export/import | gated, see ADR-011 |

**Nothing is persisted yet.** Do not log real training until M6 passes its round-trip gate:
export → wipe storage → import → identical state.

---

## Decisions

Start with [`docs/adr/README.md`](docs/adr/README.md). The load-bearing ones:

- [ADR-001](docs/adr/ADR-001-platform-web-pwa.md) — web PWA, phone-first; offline is a hard requirement
- [ADR-002](docs/adr/ADR-002-deterministic-rules-engine.md) — rules engine, not an LLM
- [ADR-006](docs/adr/ADR-006-hand-authored-catalog.md) — hand-authored catalog; no public dataset fits
- [ADR-009](docs/adr/ADR-009-dual-domain-schema.md) — dual-domain schema from record one
- [ADR-012](docs/adr/ADR-012-data-code-boundary.md) — the data/code boundary

---

## Caveats

Volume landmarks in `landmarks.json` are population estimates from published hypertrophy
literature, with wide individual variance. The engine seeds from them and corrects against your
own logged history. They are not medical guidance and account for no injury history — if you
have one, that belongs with a physio, not a JSON file.
