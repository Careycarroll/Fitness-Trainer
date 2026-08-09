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

`squat` · `hinge` · `lunge` · `horizontalPush` · `verticalPush` · `horizontalPull` ·
`verticalPull` · `carry` · `core` · `olympic` · `gymnastic` · `monostructural`

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

- `splits.json` — day templates: `{id, name, daysPerWeek, days:[{label, patterns:[]}]}`
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
  styleId: "hypertrophy-upper-lower",
  daysPerWeek: 4,
  sessionMinutes: 70,
  equipmentProfile: "commercial-gym",
  blockWeeks: 1,            // 1 = single session set; 4-12 = mesocycle
  seed: 20260809,           // determinism: same request => same program (ADR-002)
  history: []               // logged sets; empty until M6
}
```

`seed` is mandatory. Generation is pure: `(request, definitions) => program`. No clock reads,
no `Math.random`, no I/O inside the generator (ADR-002).
