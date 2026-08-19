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
| M6 Conditioning expansion and catalog alignment | done — 16 issues closed; ADR-028/029/030 remain PROPOSED |
| M7 Persistence and FitNotes interoperability | **next** — gated by ADR-011 |

Verified on the current `main` branch:

- 300 generated exercises from 13 CSV source files
- 8 training styles
- 11 validators and 27,665 validation checks passing
- 91 tests passing
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

### FitNotes mapping manifest

`data/fitnotes/fitnotes-mapping.csv` maps every exercise definition in the
athlete's FitNotes export onto this catalog, and `data/fitnotes/README.md`
records the merge rule, the tiering, and the deliberate omissions. Trainer IDs
and names are canonical for exported plans; FitNotes names are preserved as
migration aliases.

The manifest is **authored, not generated** — it encodes judgement calls no
matcher can make. An early automated pass scored `Incline Barbell Bench Press`
against `Barbell Bench Press` while `Incline Barbell Press` existed, which
would have carried 18 completed sets onto the wrong lift. Do not rebuild it
from a fresh fuzzy pass.

No live FitNotes database is read or modified by anything in this repo, and
the export itself is deliberately not committed.

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

## Milestone complete: M6

M6 completed the training vocabulary before any interoperability work, because export and import mappings built against an incomplete catalog would have to be redone. All 16 issues are closed.

The three ADRs governing it — 028, 029, 030 — are still **PROPOSED**. The
work they describe has shipped and held under test; promoting them is a
separate, deliberate decision, because an ACCEPTED ADR is immutable here.

Shipped:

- ADR-028 (PROPOSED) — conditioning modalities own a file; prescription stays duration and intensity
- ADR-029 (PROPOSED) — `fatigue_cost` stays one 1-5 scale; `metabolic_cost` deferred
- `13_conditioning.csv`: 14 monostructural rows and the retirement of the monostructural deferral
- the ADR-009 reps-for-time derivation, making compound `reps_only` rows time-eligible without authoring records
- a conditioning generator for steady, interval, and round-based work: reps-for-time capped, `exercisesPerSession` honoured, full-window rows preferred over clamped ones

- ADR-030 (PROPOSED) — duration and intensity remain the whole conditioning
  prescription; no distance, pace, incline, or resistance field (#30)
- an AMRAP station window derived from the block cap rather than handed the
  whole cap — `crossfit` went from an 855s round under a 720s cap, which the
  athlete could not complete once, to a 240s round at exactly 3.0 rounds (#42)
- omission reporting that names its real cause: a pattern the style scores at
  0 reports `style-emphasis-zero` rather than claiming a catalog gap (#43)
- `data/fitnotes/fitnotes-mapping.csv` — 149 FitNotes definitions and 748
  completed sets mapped onto the catalog, with the many-to-one merge rule
  and its preconditions recorded beside it (#33)

### Conditioning gap: closed

The M5 audit found only 19 time-scored rows, none for `hinge`, `push_h`, `push_v`, `pull_h`, or `pull_v`, and a `cardio` style that emitted zero blocks. M6 closed this two ways. The ADR-009 reps-for-time derivation made compound `reps_only` rows time-eligible — candidate pool 23 to 55, covering `push_h`, `push_v`, `pull_h`, `pull_v`, `squat`, and `explosive` without authoring records — and `13_conditioning.csv` added the monostructural modalities `cardio` requires. `hiit` and `crossfit` now build multi-station circuits and `cardio` generates on both shipped profiles.

One thin spot remains by design: authored time-scored `hinge` rows are still a pool of one, tracked with the catalog rather than blocking the milestone.

M7 then adds durable local state: profile editing, IndexedDB persistence, JSON export and import, dated plan export to FitNotes, and local import of completed FitNotes history. Persistence must fail safely.

## Testing note

`tests/ui-contract.test.js` exists because 82 engine tests stayed green while the warm-up badge silently disappeared from every exercise: the UI read `needsWarmup` while the engine emitted `warmupRequired`, and nothing crossed that boundary. The test scans `js/ui/app.js` for property reads on setGroup locals and asserts each name against setGroups generated from shipped data.

It covers setGroup fields only. Program- and session-level reads are still unguarded, and three separate field-name bugs were found there during the same audit.

## Caveats

Volume landmarks in `landmarks.json` are population estimates derived from hypertrophy literature and have wide individual variance. The engine uses them as starting points and is intended to adjust against logged history after persistence and progression are active.

They are not medical guidance and do not account for injury history. Consult a qualified medical or rehabilitation professional before acting on training advice involving an injury or health condition.
