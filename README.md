# Training Planner

Offline-first, single-user training planner. Choose when and how you want to train; it generates a single week or a multi-week periodized block through a deterministic rules engine.

**One-line scope test:** if a feature does not help decide what to do in the gym today, it is out of MVP.

## Run it

```bash
npm install
npm run dev       # local development server
npm run validate  # rebuild check plus definition-file validators
npm test          # engine unit tests
npm run check     # validation and tests; run before every commit
npm run build     # validate, then create the production PWA build
```

## How it is put together

```text
js/
  data/       generated catalog and other schema-validated definitions
  engine/     deterministic rules engine — pure functions, no I/O
  storage/    IndexedDB layer — gated to M7; see ADR-011
  ui/         planner interaction and rendering; no planning logic
  SPEC.md     authoritative schema contract; read before touching data

data/exercises/
  split CSV authoring source for the exercise catalog

tools/
  build_seed.py converts the CSV source into exercises.seed.json

scripts/
  validate.js validator runner
  checks/     one file per validator

tests/
  engine suites plus ui-contract.test.js, which crosses the engine/UI boundary

docs/adr/
  architecture decision records — immutable once accepted
```

## The one rule that matters

**Data holds values. Code holds shapes.**

A training style that needs different numbers — rep ranges, percentages, work/rest bands — is a record in `styles.json`. A style that needs a different shape is implemented once in the engine.

Control flow, safety gates, and validators never become data. A dropped key in JSON can silently disable a safety gate; the same mistake in code fails a test at commit time. See [ADR-012](docs/adr/012-data-code-boundary.md) for the full reasoning and promotion test.

`scripts/checks/10-no-logic-in-data.js` enforces this boundary by rejecting control-flow keys, stored expressions, and operation-object arrays in definition files.

## Current state

| Milestone | Status |
| --- | --- |
| M0 Scaffolding, ADRs, CI | done |
| M1 Schema contract (`SPEC.md`) | done |
| M2 Seed catalog and baseline coverage | done |
| M3 Load-domain generator | done |
| M4 Full catalog integrated with the engine | done |
| M5 Planner UI | done — audited, not merely shipped |
| M6 Conditioning expansion and catalog alignment | **next** |
| M7 Persistence and FitNotes interoperability | gated by ADR-011 |

Verified on the current `main` branch:

- 286 generated exercises from 12 CSV source files
- 7 training styles
- 11 validators and 24,648 validation checks passing
- 86 tests passing
- deterministic seeded generation
- unified `Block → SetGroup` output across load and conditioning domains
- scored exercise selection, accessory fill, equipment coverage, substitutions, safety gates, scheduling, progression, and deload behavior under test
- successful Vite production build and generated PWA service worker
- offline generation confirmed on the deployed GitHub Pages build, including style and schedule changes with the network down (ADR-001)

The planner and catalog are usable now, but nothing is durable. Do not trust real training history to the app until M7 passes its round-trip gate:

```text
export → wipe storage → import → identical state
```

## Catalog authoring

The exercise catalog is hand-authored against the project schema rather than imported from a public dataset. CSV files under `data/exercises/` are the source of truth; `js/data/exercises.seed.json` is the generated build artifact.

After changing the CSV source, regenerate the artifact with:

```bash
npm run build:seed
```

Before committing any catalog or engine change, run:

```bash
npm run check
npm run build
```

Validation confirms that the generated JSON matches its source and that definition files remain schema-valid, internally consistent, and free of planning logic.

## Decisions

Start with [`docs/adr/README.md`](docs/adr/README.md). Load-bearing decisions include:

- ADR-001 — web PWA, phone-first; offline is a hard requirement
- ADR-002 — deterministic rules engine, not an LLM
- ADR-006 — hand-authored catalog; no public dataset fits the project taxonomy
- ADR-009 — dual-domain schema from the first record
- ADR-011 — no real logging before persistence passes the round-trip gate
- ADR-012 — the data/code boundary
- ADR-016 — split CSV is the catalog authoring surface
- ADR-023 — append-only exercise-max history and computed e1RM
- ADR-026 — catalog schema reconciliation
- ADR-027 — unified `Block → SetGroup` output shape

Accepted ADRs are immutable. If a decision changes, add a new ADR that supersedes or refines the old one rather than editing history.

## Next milestone: M6

M6 completes the training vocabulary before any interoperability work, because export and import mappings built against an incomplete catalog would have to be redone.

- ADR for conditioning catalog ownership and domain scope
- monostructural catalog rows: rower, bike, jump rope, boxing, machine cardio
- conditioning generator for steady, interval, and round-based work
- canonical exercise naming aligned with the FitNotes exercise library

### Known conditioning gap

The M5 audit measured the time-domain candidate pool. Only 19 of 286 rows are time-scored, and they cluster in core and carries:

```text
squat: 1   core: 7   carry: 9   locomotion: 2
```

No time-scored `hinge`, `push_h`, `push_v`, `pull_h`, or `pull_v` row exists. Consequently the `cardio` style emits zero blocks in every session, and `hiit` emits single-station "circuits". The engine reports these honestly in `omitted[]` and the UI explains them rather than rendering a blank card, so this is a catalog gap rather than a defect.

Separately, 42 `reps_only` compound rows are time-domain scoring under ADR-009's own definition of the domain — "reps-for-time" — but the current derivation treats them as load-only. Resolving that rule is expected to supply most of the missing pattern coverage without authoring new records, which materially reduces the scope of the new conditioning file.

M7 then adds durable local state: profile editing, IndexedDB persistence, JSON export and import, dated plan export to FitNotes, and local import of completed FitNotes history. Persistence must fail safely.

## Testing note

`tests/ui-contract.test.js` exists because 82 engine tests stayed green while the warm-up badge silently disappeared from every exercise: the UI read `needsWarmup` while the engine emitted `warmupRequired`, and nothing crossed that boundary. The test scans `js/ui/app.js` for property reads on setGroup locals and asserts each name against setGroups generated from shipped data.

It covers setGroup fields only. Program- and session-level reads are still unguarded, and three separate field-name bugs were found there during the same audit.

## Caveats

Volume landmarks in `landmarks.json` are population estimates derived from hypertrophy literature and have wide individual variance. The engine uses them as starting points and is intended to adjust against logged history after persistence and progression are active.

They are not medical guidance and do not account for injury history. Consult a qualified medical or rehabilitation professional before acting on training advice involving an injury or health condition.
