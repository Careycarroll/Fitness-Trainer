# Engine Schema Contract

**Authoritative.** Definition files conform to this document; the engine reads only what is
described here. Changes to this file require a version bump in `schemaVersion` and a
corresponding migration note in `docs/MIGRATIONS.md`.

**Schema version:** 1

> Governed by ADR-003 (content as data), ADR-009 (dual-domain), ADR-012 (data/code boundary).
> Before adding a field, apply the ADR-012 promotion test: *values only*, *statically
> checkable*, *loud on typo*. Fail any one and it belongs in code.

---

## Enumerations

### `pattern` — movement pattern (12)

`squat` · `lunge` · `hinge` · `push_h` · `push_v` · `pull_h` · `pull_v` ·
`carry` · `core` · `isolation` · `explosive` · `locomotion` · `monostructural`

ADR-026: `olympic` and `gymnastic` are retired. Olympic lifts are `explosive`
with `skillGate: 'olympic-lift'`; `gymnastic` returns only if M9 lands.
`lunge` is derived at build time from `exercise_family`, never authored.

Pattern is the axis substitution matches on (ADR: substitution resolves by pattern +
equipment, not hand-maintained substitute lists — those rot on every catalog addition).

### `loadType`

`barbell` · `dumbbell` · `kettlebell` · `machine` · `cable` · `bodyweight` · `band` ·
`implement` · `none`

### `scoring`

`load` — sets × reps × %1RM · `time` — intervals, rounds, reps-for-time · `both`

### `muscleGroup`

`chest` · `back` · `quads` · `hamstrings` · `glutes` · `calves` · `shoulders` · `biceps` ·
`triceps` · `forearms` · `abs` · `obliques` · `traps` · `lowerBack` · `systemic`

---

## `exercises.json` — exercise record

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | `kebab-case`, unique, immutable once shipped |
| `name` | string | yes | Display name |
| `pattern` | `pattern` | yes | |
| `loadType` | `loadType` | yes | |
| `equipment` | string[] | yes | Resolved against `equipment.json` profiles |
| `primaryMuscles` | `muscleGroup`[] | yes | ≥1 |
| `secondaryMuscles` | `muscleGroup`[] | yes | may be empty |
| `fatigueCost` | int 1–5 | yes | Systemic cost. Drives session fatigue budget |
| `skill` | int 1–5 | yes | Technical demand. Inputs to the skill gate (code) |
| `defaultRIR` | int 0–5 | yes | Baseline reps-in-reserve |
| `restSeconds` | int | yes | Baseline; style may override |
| `warmupRequired` | bool | yes | |
| `unilateral` | bool | yes | Affects set counting in volume checks |

### Dual-domain fields (ADR-009) — required on every record

| Field | Type | Notes |
|---|---|---|
| `scoring` | `scoring` | Which domains this movement can be prescribed in |
| `timeDomain` | `{minSeconds:int, maxSeconds:int}` \| `null` | `null` iff `scoring === "load"` |
| `roundsCapable` | bool | Eligible for AMRAP / rounds-for-time |
| `kipAllowed` | bool \| `null` | `null` for non-`gymnastic` patterns |
| `monostructural` | bool | Cyclical machine/locomotion work (row, bike, run) |
| `skillGate` | string \| `null` | ID of a gate **implemented in code**. Data references it; data never defines it (ADR-012) |

**Invariants enforced by the validator**

1. `scoring === "load"` ⟺ `timeDomain === null`
2. `kipAllowed !== null` ⟺ `pattern === "gymnastic"`
3. `monostructural === true` ⟹ `pattern === "monostructural"`
4. `skillGate`, when non-null, must resolve to a gate registered in `js/engine/safety.js`
5. `id` unique across the catalog

---

## `styles.json` — style record

Parameters only. A style may not introduce branching behaviour (ADR-010, ADR-012).

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `domain` | `"load"` \| `"time"` | Routes to a generator. Adding a value here requires a new generator in code |
| `tier` | int 1–3 | Build order, see MILESTONES |
| `repRange` | `{min,max}` | load domain |
| `intensityBand` | `{min,max}` | fraction of 1RM, load domain |
| `setsPerMainLift` | `{min,max}` | load domain |
| `accessoryRatio` | float 0–1 | share of session volume that is accessory work |
| `restSeconds` | `{main,accessory}` | overrides exercise baseline |
| `workRest` | `{workSeconds,restSeconds,rounds}` \| `null` | time domain |
| `patternEmphasis` | `{<pattern>: float}` | relative weighting; need not sum to 1 |
| `fatigueBudget` | int | per-session cap, sum of `fatigueCost` |

Load-domain styles set the load fields and `workRest: null`. Time-domain styles do the inverse.

---

## `landmarks.json` — weekly volume landmarks

Per `muscleGroup`: `{ mv, mev, mav, mrv }` in hard sets per week.

> **Caveat retained from planning:** these are population estimates from published hypertrophy
> literature with wide individual variance. The engine seeds from them and then corrects
> against logged history. They are not medical guidance and do not account for injury history.

---

## `splits.json`, `equipment.json`, `substitution-weights.json`

- `splits.json` — day templates:
  `{id, name, daysPerWeek, days:[{label, patterns:[], muscles?:[]}]}`
  `muscles` is **optional** and **weights** selection within the day's own patterns;
  it never filters. Patterns alone cannot express a body-part split — "Chest &
  Triceps" and "Shoulders & Arms" are both `push_h/push_v/isolation` — so without
  it those days differ only by seed. A day that omits it scores exactly as before.
- `equipment.json` — named profiles: `{id, name, available:[loadType/equipment tokens]}`
- `substitution-weights.json` — ranking coefficients only: how much a `fatigueCost` delta,
  `skill` delta or muscle-overlap gap penalises a candidate. **Coefficients are data; the
  ranking algorithm is code** (ADR-012).

---

## Generation request contract

The engine's single entry point. Constructed by the UI, consumed by `engine/index.js`.

```js
{
  schemaVersion: 1,
  styleId: "strength",      // one of the eight ids in styles.json
  daysPerWeek: 4,
  sessionMinutes: 70,
  equipmentProfile: "commercial-gym",
  blockWeeks: 1,            // 1 = single session set; 4-12 = mesocycle
  seed: 20260813,           // determinism: same request => same program (ADR-002)
  athlete: {                // REQUIRED. safety.js gates on skillLevel
    skillLevel: 3,          // 1-5; 5 admits olympic lifts
    hasCoaching: false,
    strictReps: {}          // exerciseId -> rep cap, athlete override
  },
  history: []               // completed sets; populated by the FitNotes import (#24)
}
```

`seed` is mandatory. Generation is pure: `(request, definitions) => program`. No clock reads,
no `Math.random`, no I/O inside the generator (ADR-002).

---

## Program output shape

`generate(request, definitions)` returns a PROGRAM. Read this from the engine, not
from the illustration below it: `splitId` and `domain` are emitted and were
undocumented here until #35 had to persist them.

```js
{
  schemaVersion: 1,
  styleId: 'strength',
  splitId: 'upper-lower-4',   // which split template was resolved
  domain: 'load' | 'time',    // which generator ran
  seed: 20260813,
  weeks: [ { week: 1, sessions: [ /* see below */ ] } ]
}
```

The program is what gets persisted, not the request. `js/ui/app.js` mutates the
program tree in place — `group[field] = value`, `setGroups.splice()`, and
`blocks.splice()` when a block empties — so replaying the request through the
engine reproduces the ORIGINAL draft rather than what the athlete is looking at.
The request is stored beside it for provenance (#35).

## Session output shape (ADR-027) — CURRENT

A session emits `blocks[]`. **A block holds an ordered list of `setGroups`**, and
declares a `blockType`. A `SetGroup` is one exercise plus its prescription.

```js
{
  domain: 'load' | 'time',
  label: 'Squat',
  styleId: 'powerlifting',
  blocks: [
    { blockType: 'straight', rounds: null, timeCapSeconds: null,
      setGroups: [ { exerciseId, name, pattern, equipment, primaryMuscles,
                     exerciseFamily, fatigueCost, unilateral, warmupRequired,
                     role, sets, reps, intensityOf1RM, rir, restSeconds } ] }
  ],
  omitted: [ { pattern, reason, ... } ],
  exercisesRequested: 7,
  exercisesPlaced: 6,
  fatigueUsed: 19,
  fatigueBudget: 22,
  blockedByGates: [ { id, reason } ]
}
```

`blockType` ∈ `straight | superset | circuit | emom | amrap`. A straight set is a
**one-element** `setGroups` — there is no special case for the common shape, and
`makeBlock()` rejects a `straight` block holding two.

**`stations[]` is RETIRED.** `intervalDomain.js` emits ONE `circuit` (or `amrap`)
block whose `setGroups` are the stations; `rounds` and `timeCapSeconds` sit on the
block, because they describe the group and not any member. Both domains therefore
emit the same container, and no consumer branches on `session.domain` to find the
exercise list.

**Construction and reading go through `js/engine/blocks.js`:**
`makeSetGroup`, `makeBlock`, `straightBlock`, `allSetGroups`, `sessionFatigue`,
`setGroupAt`. Do not build block literals inline — the point of that module is
that the next shape change edits one constructor rather than six call sites.

**SetGroups carry catalog identity** (`equipment`, `primaryMuscles`,
`exerciseFamily`, `fatigueCost`) so consumers never re-join against 285 rows, and
so pairing can check equipment contention without a lookup.

## Selection (loadDomain.js) — CURRENT

Two passes, one scoring function:

1. **Pattern coverage.** One block per pattern the split's day names. The split is
   the skeleton (ADR-015). `patternEmphasis === 0` omits with a reason.
2. **Accessory fill.** Keeps adding work until `style.exercisesPerSession` is met
   or the fatigue budget is spent. `accessoryRatio` steers which patterns pass 2
   returns to.

Candidates are **scored**, not sorted-and-end-picked. The retired rule took
`candidates[0]` for main and `candidates[last]` for everything else; sorted by
fatigue, "last" meant *cheapest*, so with 123 cost-1 catalog rows every accessory
resolved to a 1 and a powerlifting day came out at 8 of a 22 budget.

Score terms: style pattern emphasis · the split day's optional `muscles` ·
cost fit against budget-remaining-per-slot · penalties for repeating an
`exerciseFamily` or a pattern.

The muscle term is applied in **both** passes. Weighting pass 1 alone is not
enough: pass 2 picks its next pattern by style emphasis, so a chest day opened
with a bench and finished with good mornings and split squats. Pass 2 now also
weighs whether a pattern's remaining candidates serve the day.

Two rules live in **code**, not `styles.json`, because they are safety-adjacent
and must fail closed (ADR-012):

- at most one `fatigueCost >= 5` exercise per session — squat 5 plus deadlift 5
  passes a 22-point budget arithmetically and no competent coach programs it
- pattern repeats require `style.allowPatternRepeat` (powerlifting only), which is
  what makes back squat → pause squat expressible

## Known issue

The fatigue budget saturates at 100% on most sessions — the fill pass reaches for
`exercisesPerSession.max` and scores toward consuming the remainder. A constraint
that never leaves slack is a target. Filed against M8, where cross-day fatigue
from logged history makes the number mean something.
