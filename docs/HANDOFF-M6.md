# Handoff — starting M6

Paste this into a new chat before anything else. It exists because five docs in
this repo were written at different times and two of them are wrong; this file
says which is authoritative.

## Read order

1. **`docs/adr/README.md`** — 27 ADRs, grouped by area. **Authoritative for every
   architectural question.** Immutable once accepted: a decision is never edited,
   it is superseded or refined by a new record.
2. **`js/engine/SPEC.md`** — the engine contract, including the current session
   output shape.
3. **`docs/MILESTONES.md`** — M0–M5 done, M6 next, with mechanical exit criteria.
4. **`docs/MIGRATIONS.md`** — schema log. Empty of real migrations because nothing
   is persisted yet. M6 is where that stops being true.

## ⚠️ Two documents that will mislead you

**`docs/fitness/FITNESS_APP_PLAN.md` §6 specifies Next.js + Postgres + Drizzle +
Vercel. That is not this project.** It was written before the repo was visible.
The real stack is **Vite + vanilla JS PWA + IndexedDB, offline-first, no server**
(ADR-001, ADR-004). The file carries a banner saying so. Do not propose a
database for M6.

**`tests/coverage.test.js` fixtures use a vocabulary that exists nowhere in
shipped data** — `horizontal-push`, `vertical-pull`, `plates`, `pullup-bar`. They
are internally consistent and test the coverage *algorithm*, which is fine. They
are not evidence about shipped data. `tests/shipped-data.test.js` is the file that
asserts against real definition files, and it exists because the synthetic suite
passed continuously through two real defects.

## What this project is

A single-user, offline-first PWA that generates strength and conditioning
sessions, from one workout up to a multi-week block. One person plans and
performs their own training. No signup, no multi-tenancy, no server.

The generator is **a deterministic constraint solver, not a model** (ADR-002).
`generate(request, defs) → program` is pure: no clock reads, no `Math.random`, no
I/O. The same seed always produces the same program. If a session is wrong, there
is a rule to find and fix.

## Where things stand

| Milestone | State |
|---|---|
| M0 Scaffolding | done |
| M1 Schema contract | done |
| M2 Seed catalog | done — 24 scaffolding rows, since retired |
| M3 Load-domain generator | done |
| M4 Full catalog authoring | **done — 285 rows across 12 CSV files** |
| M5 UI shell | **done — render, edit, honest failure reporting** |
| **M6 Logger + IndexedDB + export/import** | **NEXT — indivisible (ADR-011)** |
| M7 Interval-domain generator | `monostructural` deferral expires here |
| M8 Progression from history | fatigue budget becomes cross-day |
| M9 CrossFit | last, and first to cut |

**Gates:** `npm run check` → 11 validators, 24557 checks, 82 tests. All green.

## The data pipeline

```
data/exercises/*.csv          authored by hand, 12 files, one per muscle group
        │                     ADR-016: CSV is the authoring surface, because
        │                     cross-row calibration is a spreadsheet operation
        ▼  tools/build_seed.py
js/data/exercises.seed.json   GENERATED. Do not hand-edit.
        │                     `npm run validate` runs --check and fails on drift.
        ▼
js/engine/defs.js  →  the engine
```

Ownership rule (ADR-017): an exercise lives in exactly one file, decided by the
**first token of `primary_muscles`**. Romanian deadlift is `hamstrings|glutes`, so
it lives in `03_hamstrings.csv` and nowhere else. The glute file looks thin
because most glute work is hinge-primary. That is correct.

`lunge` is **derived at build time** from `exercise_family` ∈ {lunge, split_squat,
step_up} (ADR-026). No CSV row carries it.

## Session output shape (ADR-027) — the thing M6 persists

```js
blocks: [
  { blockType: 'straight', setGroups: [ {...oneExercise} ] },
  { blockType: 'superset', setGroups: [ {...bench}, {...fly} ] },
  { blockType: 'amrap', timeCapSeconds: 900,
    setGroups: [ {...dl}, {...clean}, {...jerk} ] }
]
```

`blockType` ∈ `straight | superset | circuit | emom | amrap`. A straight set is a
one-element list — no special case for the common shape. `stations[]` is retired;
a conditioning session is one `circuit`/`amrap` block.

**Build and read blocks only through `js/engine/blocks.js`.** That module exists so
the next shape change edits one constructor instead of six inline literals.

## M6 — what it has to do

One indivisible milestone. Four issues, all open:

1. **IndexedDB schema + migration runner** (ADR-004)
2. **Session logger** — `PrescribedSet` and `LoggedSet` are separate records and
   must never merge (this is what makes progression and adherence possible at all)
3. **JSON export / import** — ships *with* the logger, not after. A logger without
   export means real training history with no backup, which ADR-011 forbids.
4. **Equipment profile editor** — moved here from M5, because ADR-011 means an
   edited profile would vanish on reload

**ADR-011 is the constraint that shapes this milestone: no real training is logged
until the persistence gate passes.** Losing real logged history is unrecoverable,
so export/import is not a follow-up feature — it is half of what makes logging
permissible.

**The profile editor has a specific trap.** ADR-026 records a defect where
`coverage.js` read `profile.equipment` while `equipment.json` ships
`profile.available`, so every shipped profile silently resolved to an empty
owned-set. `commercial-gym` masked it via `assumesAll: true`. Whatever the editor
writes must satisfy both check 11 and `tests/shipped-data.test.js` — the runtime
path and the shipped-data path must not diverge again.

## Failure modes this project has already hit twice

Both were **a check that reported PASS while verifying nothing**:

- Check 11 exported a bare function while the runner expects `{ id, name, run }`.
  It threw on every run, the runner's try/catch swallowed it, and it reported
  `0 checks` for its entire life.
- Check 04 keyed on `pattern === 'olympic'`, retired by ADR-026. The assertion
  became unreachable and the check kept printing PASS.

When adding a validator or a test in M6, make it fail on purpose once and confirm
the suite goes red. `tests/shipped-data.test.js` has preconditions specifically to
guard against a vacuous pass.

## Working conventions

- macOS, zsh. Pipe long output through `| tee /dev/tty | pbcopy`.
- `npm run dev` → the app. `npm run check` → validators + tests.
- Never hand-edit `js/data/exercises.seed.json`.
- A decision that changes an accepted ADR gets a **new** ADR, numbered
  sequentially, added to **both** tables in `docs/adr/README.md`.
- Data goes in definition files, logic goes in the engine (ADR-012). Safety-
  adjacent rules stay in code and fail closed.

## Known issues, filed and deferred

- **Fatigue budget saturates at 100%** on most sessions. The fill pass reaches for
  `exercisesPerSession.max` and scores toward spending the remainder, so with 123
  cost-1 catalog rows the budget is always exactly met. A constraint that never
  leaves slack is a target. Filed against M8, where cross-day fatigue from logged
  history makes the number meaningful.
- **ADR-025 is PROPOSED, not accepted** — the single-joint pattern rule is
  inconsistent (flies are `push_h`, pushdowns are `isolation`, trunk work stays
  `core`). Recorded unresolved rather than rediscovered. Not blocking.
- **Supersets are expressible but not generated.** ADR-027 made the shape
  possible; no pairing pass exists yet. The equipment-contention rule is drafted
  but unwritten: a `rack` cannot be at squat height and bench height at once, so
  same-station pairs must be refused while a shared static bench is fine.
