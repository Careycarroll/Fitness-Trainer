# ADR-026 — Catalog schema reconciliation: the engine vocabulary widens to the CSV's

**Status:** ACCEPTED
**Date:** 2026-08-11
**Supersedes:** nothing
**Refines:** ADR-016
**Related:** ADR-009, ADR-012, ADR-013, ADR-018, ADR-021

---

## Decision

`data/exercises/*.csv` is the authoring surface (ADR-016). This record specifies
the *mapping* ADR-016 left unstated, and it resolves the mapping in one
direction: **the engine's vocabulary widens to the catalog's. The catalog is
never downcast to the engine's.**

Four parts:

1. **Muscles widen from 12 to 22.** `_enums.js MUSCLES` adopts the catalog
   tokens: `lats`, `mid_back`, `upper_back`, `traps`, `erectors` replace `back`
   and `lowerBack`; `front_delts`, `side_delts`, `rear_delts` replace
   `shoulders`; `adductors`, `abductors`, `hip_flexors`, `neck` are added.
   `systemic` is retained as an engine-only token with no catalog rows.

2. **Patterns become snake_case and adopt the catalog set**, plus `lunge`:
   `squat`, `lunge`, `hinge`, `push_h`, `push_v`, `pull_h`, `pull_v`, `carry`,
   `core`, `isolation`, `explosive`, `locomotion`, `monostructural`.
   `gymnastic` and `olympic` are retired as patterns — Olympic lifts are
   `explosive` in the catalog, and `gymnastic` returns in M9 if CrossFit lands.

3. **`lunge` is derived at build time, not authored.** Catalog rows whose
   `exercise_family` is `lunge`, `split_squat`, or `step_up` emit
   `pattern: "lunge"`. Everything else keeps its authored pattern. No CSV row is
   edited.

4. **Equipment tokens become the catalog's 35 snake_case tokens.**
   `equipment.json` profiles are rewritten: `pull-up-bar` → `pullup_bar`,
   `cable-machine` → `cable`, `bumper-plates` → `plate`, `belt` → `dip_belt`
   (ADR-021), `wall` is dropped. `rower` and `air-bike` are retained for M7.

Fields the engine requires that the catalog does not carry are **derived**, not
authored:

| Engine field | Derivation |
|---|---|
| `loadType` | first matching token in `equipment` against an ordered precedence list |
| `scoring` | `weight_reps`/`weight_distance` → `load`; `time`/`time_load` → `both` |
| `timeDomain` | `null` when `scoring === 'load'`; else from `default_rest_sec` bounds |
| `defaultRIR` | `2` |
| `warmupRequired` | `fatigue_cost >= 4` |
| `roundsCapable` | `scoring !== 'load'` |
| `kipAllowed` | `null` (no `gymnastic` rows) |
| `monostructural` | `false` |
| `skillGate` | `'olympic-lift'` when `technical_demand === 5`, else `null` |

`exercise_family`, `joint_load`, `emphasis`, and `default_rep_low/high` pass
through to the generated JSON as new engine-visible fields. They are already
authored and already validated; discarding them at the boundary would make
ADR-020's `prioritize_joint_load` unimplementable.

The 24 M2 seed records are **retired**. The file's own `note` declares them
scaffolding "sized to prove the schema before M4 authors ~200 records."

---

## Context

ADR-016 established CSV as the authoring surface and `js/data/exercises.seed.json`
as generated. It assumed the transform was serialization. It is not: the two
surfaces speak incompatible vocabularies, and discovering this required check 11
to be repaired first.

### The forcing discovery

Check 11 exported a bare function while `scripts/validate.js` calls
`check.run(defs, assert, rawFiles)`. It threw on every run, the runner's
try/catch swallowed it, and it reported `0 checks`. Shipped-profile coverage had
therefore never been verified.

Repairing it exposed a second defect: `coverage.js` read `profile.equipment`
while `equipment.json` ships `profile.available`. Every shipped profile resolved
to an empty owned-set, so only zero-equipment movements were performable.
`commercial-gym` masked this via `assumesAll: true`, and `home-garage` — the one
profile that exercised the path — was only ever checked by the validator that
was not running.

`tests/coverage.test.js` could not have caught either: its fixtures are entirely
synthetic and use `horizontal-push`, `vertical-pull`, `plates`, `pullup-bar` —
a kebab-case vocabulary that appears in no shipped file.

### Why widen rather than downcast

Downcasting is cheaper: collapse `lats|mid_back|upper_back|traps|erectors` into
`back`, three delt heads into `shoulders`, and 35 equipment tokens into 15. One
mapping table, no engine changes.

It is also self-defeating. ADR-018 admitted a muscle token only if it would ever
be programmed while deliberately excluding its parent — that test is the reason
the delt heads exist and `upper_chest` does not. Collapsing them at the build
boundary reintroduces exactly the failure ADR-018 prevents: the generator can no
longer know that overhead pressing does nothing for rear delts. ADR-021 retired
`machine` for the same class of reason, and downcasting 12 machine tokens back to
one undoes a 35-row sweep.

The catalog is the expensive artifact — 285 hand-calibrated rows. The engine
enums are five arrays in one file. Widening moves the cost to the cheap side.

### `lunge`: derived, not authored

`splits.json` requires a `lunge` pattern. The catalog has no such pattern — the
taxonomy files reverse lunge, walking lunge, split squat, Bulgarian split squat,
and step-ups under `squat`.

Three options were available: reclassify ~11 CSV rows by hand, drop `lunge` from
the engine and rewrite the splits, or derive it. Deriving wins because
`exercise_family` already encodes the distinction — `lunge`, `split_squat`, and
`step_up` are precisely the unilateral families. The rule is one line in the
build step, no row is re-reviewed, and a future disagreement is a one-line edit
rather than an eleven-row sweep.

Accepted consequence: `squat` and `lunge` become separate balance buckets, so a
session with back squat and Bulgarian split squat reads as two patterns rather
than two squats. That is the intended behaviour, but it is a behaviour change.

### `monostructural`: deferred, not relaxed

`splits.json` ships `conditioning-3`, which requires `monostructural`. The
catalog is load-domain only and has zero such rows; `home-garage` owns no
ergometer. This fails on catalog size *and* on equipment, and no amount of
strength authoring closes it.

The rejected fix was lowering check 11's threshold from 2 to 1, or to 0 for
patterns with no rows. That makes the check quieter everywhere in order to
accommodate one known hole — the standard way a validator degrades into
decoration.

Instead, check 11 carries a `DEFERRED_PATTERNS` map naming the milestone that
removes each entry. Deferred patterns print as `SKIP` on every run, and a
staleness guard fails the build if a deferred pattern ever acquires catalog rows.
Per ADR-007, this gives M7 a mechanical exit: M7 is done when the map is empty
and check 11 passes unmodified.

### Rejected alternatives

**Keep `exercises.seed.json` authoritative, treat the CSVs as a one-time import.**
Reverses ADR-016 and discards the reason it exists — cross-row calibration is a
spreadsheet operation, and 285 rows of `fatigue_cost` cannot be kept consistent
in JSON.

**Two catalogs, one per surface.** Guarantees divergence. This is the failure
ADR-017 prevents inside the library; permitting it across the boundary is worse.

**Author the eight missing engine fields as CSV columns.** `defaultRIR`,
`warmupRequired`, `roundsCapable`, `kipAllowed` are either constant or a
function of columns already present. Authoring 285 values that a one-line rule
computes adds review burden and a drift surface, and buys nothing.

---

## Consequences

**Positive**

- The 285-row catalog reaches the engine without losing the distinctions it was
  authored to carry. ADR-018's admission test and ADR-021's machine split stay
  meaningful at runtime rather than only at validation time.
- `joint_load` reaches the generator, which is what makes ADR-020's
  `prioritize_joint_load: [knee]` implementable rather than aspirational.
- Check 11 runs for the first time, and M4's exit becomes mechanical: check 11
  passing against the real catalog, not a row count.
- Deferred patterns are declared with an owning milestone, so the one known hole
  is visible on every run instead of being absorbed into a lowered threshold.
- One vocabulary across CSV, JSON, enums, and profiles. The kebab/camel/snake
  split that hid two bugs for the life of the repo is gone.

**Negative / accepted**

- Four surfaces change at once: `_enums.js`, `equipment.json`, `splits.json`,
  `styles.json`. Nothing generates until all four agree, so this lands as one
  commit and cannot be staged.
- `tests/coverage.test.js` and the engine tests are written against the old
  vocabulary and will fail. They must be rewritten, and at least one case must
  be built from real `equipment.json` and real catalog data — synthetic-only
  fixtures are how both defects survived.
- `gymnastic` and `olympic` leave `PATTERNS`. If M9 lands, `gymnastic` returns
  as a new record, not by editing this one.
- Derived fields are invisible in the authoring surface. Someone reading a CSV
  row cannot see what `scoring` it will emit. The build step must print the
  derivation table on every run.
- `systemic` remains a legal muscle token with zero catalog rows, retained for
  engine use. It is a small inconsistency kept deliberately rather than removed
  and rediscovered.

**Review condition**

Revisit if a second consumer of the catalog appears — a mobile client, an export
format, an API. One consumer justifies deriving eight fields in the build step;
two consumers means the derivation rules are duplicated or drift, and they
should be promoted into authored columns at that point.

Revisit sooner if any derived field is ever hand-corrected in the generated
JSON. That is the signal the rule is wrong, and per ADR-016 the generated file is
not an editing surface.
