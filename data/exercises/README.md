# Exercise Library

Authoring surface for the workout generator's exercise pool.

**Status: complete. 285 rows across 12 files. Validator passes.**

**This directory is build-time data, not application code.** Nothing here is
imported at runtime. The CSVs are parsed once by the validator, which emits
typed JSON, which the seed loader writes into Postgres at deploy.

```
data/exercises/*.csv  →  validate_exercise_seed.py  →  build/exercises.json  →  seed loader  →  Postgres
     (you edit)              (CI gate)                   (generated)             (deploy)
```

---

## Why CSV and not JSON

The dominant activity on these files is **cross-row comparison**, not per-row
authoring. When you rate a new movement's `fatigue_cost`, the thing you need is
to sort by that column and check your new 3 against every existing 3. That's a
spreadsheet operation. In JSON those values are forty lines apart and drift is
invisible.

CSV also gives one-line diffs. Changing one rating should be one readable line
in review, not a multi-line hunk.

JSON's advantages — real types, real arrays, schema enforcement — are all
delivered by the validator instead of by the authoring format.

---

## File manifest

| File | Owns primary muscle tokens | Rows | Mean `fatigue_cost` |
|---|---|---|---|
| `01_quads.csv` | `quads` | 34 | 2.41 |
| `02_glutes.csv` | `glutes` | 20 | 2.40 |
| `03_hamstrings.csv` | `hamstrings` | 19 | 2.32 |
| `04_calves.csv` | `calves` | 9 | 1.00 |
| `05_hips.csv` | `adductors`, `abductors` | 13 | 1.31 |
| `06_chest.csv` | `chest` | 27 | 2.00 |
| `07_back.csv` | `lats`, `mid_back`, `upper_back`, `traps`, `erectors` | 37 | 2.14 |
| `08_shoulders.csv` | `front_delts`, `side_delts`, `rear_delts`, `neck` | 28 | 1.71 |
| `09_biceps.csv` | `biceps`, `forearms` | 20 | 1.05 |
| `10_triceps.csv` | `triceps` | 21 | 1.52 |
| `11_core.csv` | `abs`, `obliques`, `hip_flexors` | 25 | 1.20 |
| `12_fullbody.csv` | *(pattern-selected — see below)* | 32 | 2.41 |
| | **Total** | **285** | **1.90** |

Every file has an **identical header row**. The validator concatenates all of
them before checking, so slug uniqueness and calibration drift are still
enforced globally.

---

## The ownership rule

> An exercise lives in **exactly one file**, determined by the **first token in
> its `primary_muscles` column**.

Romanian deadlift is `hamstrings|glutes` — first token is `hamstrings`, so it
lives in `03_hamstrings.csv` and appears nowhere else, even though it is a real
glute builder.

Without this rule the same movement gets authored in three files by three
different judgment calls, each with its own `fatigue_cost`. Nothing errors. The
seed loader keeps whichever it read last — alphabetical by filename, an
arbitrary winner — and the generator runs on ratings nobody approved.

**Consequence to accept:** file size does not equal training importance. The
glute file looks thin because most glute work is hinge-primary and lives in
hamstrings. Volume accounting happens in the generator off `primary_muscles` +
`secondary_muscles`, never off which file a row was typed into.

`12_fullbody.csv` is the only exemption — olympic lifts, carries, jumps, throws,
and grip holds are defined by **pattern**, not by a single owning muscle. The
validator checks its rows against `{explosive, carry, locomotion}` instead of
against a set of owned muscle tokens.

---

## Columns

| Column | Type | Notes |
|---|---|---|
| `name` | text | Display name |
| `slug` | text | Unique across **all** files |
| `exercise_family` | token | Groups variations. Same family = substitution candidates |
| `modality` | enum | `strength` \| `conditioning` \| `mobility` |
| `movement_pattern` | enum | squat, hinge, push_h, push_v, pull_h, pull_v, carry, core, locomotion, isolation, explosive |
| `primary_muscles` | list | Pipe-delimited. **First token decides the file** |
| `secondary_muscles` | list | Pipe-delimited. **May be empty** — see below |
| `equipment` | list | Pipe-delimited. The generator's only *hard* filter |
| `is_compound` | bool | `TRUE` / `FALSE` |
| `fatigue_cost` | 1–5 | Systemic cost, not how hard the set feels |
| `technical_demand` | 1–5 | How badly it degrades under fatigue |
| `default_rep_low` / `_high` | int | |
| `default_rest_sec` | int | |
| `is_unilateral` | bool | |
| `tracking_type` | enum | weight_reps, reps_only, time, time_load, weight_distance |
| `emphasis` | list | Optional. flat/incline/decline/overhead, stretch_bias/shortened_bias, long_head/short_head, wide_grip/close_grip |
| `joint_load` | list | Optional. **Descriptive, not a warning** — see below |

**Three columns are required in the header but may be blank in a row:**
`secondary_muscles`, `emphasis`, `joint_load`. All nine calf rows, both neck
rows, and the wrist curls genuinely have no meaningful secondary mover.
Treating blank as an error silently dropped 21 rows and produced fake
"zero exercises for calves" profile failures.

### `fatigue_cost` vs `technical_demand`

Independent axes. Conflating them is the most common way this table goes wrong.

| | 1 | 3 | 5 |
|---|---|---|---|
| `fatigue_cost` | Cable fly, lateral raise | Bulgarian split squat | Back squat, deadlift |
| `technical_demand` | Leg press, machine curl | Back squat, barbell row | Snatch, clean & jerk |

Leg press is `fatigue 4, technical 1` — genuinely taxing, nearly impossible to
do wrong. Snatch is `fatigue 3, technical 5`.

**Drift is the real risk.** A healthy library is bottom-heavy. If mean
`fatigue_cost` across all rows climbs past **2.6**, the scale has stretched and
the generator's per-session fatigue budget has stopped meaning anything. The
validator fails the build on this.

Current distribution across 285 rows:

```
fatigue_cost      mean 1.90    1:123   2: 91   3: 51   4: 17   5:  3
technical_demand  mean 1.77    1:146   2: 80   3: 41   4: 14   5:  4
```

The four `technical_demand 5` rows are snatch, power snatch, clean & jerk, and
split jerk. The three `fatigue_cost 5` rows are back squat, conventional
deadlift, and sumo deadlift. Those seven are the ceiling anchors — rate
everything else against them, not against an abstract scale.

### `joint_load` is not a safety rating

Read it as: *"this movement places significant demand on this joint, at end
range, under load, even when performed correctly."*

That is a neutral fact, and the generator reads it in both directions:

- `avoid_joint_load: [knee]` — acute pain, post-op, in-season
- `prioritize_joint_load: [knee]` — building knee resilience

Sissy squats, ATG split squats, and reverse Nordics carry `knee` as a
**feature**. Loaded end-range knee flexion is the stimulus.

Current coverage:

```
shoulder 56   lower_back 45   elbow 22   knee 22   wrist 16   neck 7   hip 7
```

Caveat: `lower_back` appears on 45 rows. Avoiding it removes the entire
posterior chain. Descriptively true, practically all-or-nothing.

---

## Pattern coverage

```
squat      28     push_h  33     pull_h  26     core        27
hinge      26     push_v  11     pull_v  12     isolation   84  (excluded from balance)
carry      10     explosive 22  (must be placed early)      locomotion   6
```

`isolation` is excluded from the solver's pattern-balance checks — it is the
honest junk drawer for single-joint work whose pattern carries no programming
meaning. `explosive` rows must be placed in the first block of a session or not
at all.

**`carry`, `explosive`, and `locomotion` are almost entirely supplied by
`12_fullbody.csv`.** That file is not a leftovers bin; it is the sole source of
an entire movement pattern.

---

## Running the validator

Python 3.10+. No third-party dependencies. On macOS use `python3`.

```bash
# check everything
python3 tools/validate_exercise_seed.py data/exercises/

# emit the build artifact
python3 tools/validate_exercise_seed.py data/exercises/ -o build/exercises.json

# CI mode — warnings fail too
python3 tools/validate_exercise_seed.py data/exercises/ --strict
```

Exit `0` = clean, `1` = errors.

**The bug this exists to prevent:** you type `quad` instead of `quads` on row
143. Nothing errors, the row loads fine, and that exercise silently stops
existing whenever the generator looks for quad work. You find out weeks later
when leg day feels thin.

It also reports calibration distribution, pattern coverage, `joint_load`
coverage, and survivor counts per gym profile — and **fails the build if any
profile drops a muscle group to zero**, because a profile that cannot train a
muscle produces an incoherent session rather than an error.

### Known-acceptable warnings

Four warnings are expected and should not be "fixed" by padding files:

- `04_calves.csv` and `09_biceps.csv` at 2 dumbbell-only survivors against a
  floor of 3. There is no third dumbbell calf movement that is not a positional
  duplicate, and the honest bodyweight biceps exercise is a chin-up — which is
  lats-primary and lives in `07_back.csv`.
- `single-arm-lat-pulldown` and `single-arm-cable-row` flagged as compounds
  rated `fatigue_cost 1`. Correct as data; the check does not know that
  unilateral cable work halves systemic cost.

---

## Adding a row

1. Find the file that owns your movement's **first** primary muscle.
2. Copy an adjacent row and edit it — never start from a blank line.
3. Set `exercise_family` to an existing family if the movement is a variation of
   something already there.
4. Rate against the seven anchor rows above, not against an abstract 1–5 scale.
5. Run the validator.

### Does it earn a row, or is it a prescription?

**Row** if it changes any of: required equipment, which muscle is primary,
resistance profile through the range, stability or technical demand, unilateral
vs bilateral, how it's tracked.

**Prescription** if it only changes: tempo, pauses, set/rep counts, load, RPE/RIR,
rest interval.

So band-resisted push-up is a row. "3-second eccentric push-up" is not.

---

## Open items

- [ ] CI job wiring `--strict` on every push
- [ ] Equipment ownership confirmation (see `docs/fitness/EQUIPMENT_MASTER_INVENTORY.md` §18)
- [ ] Sandbag / odd-object rows — deferred, equipment not owned
- [ ] Conditioning + mobility files (13–15) — product decision, not yet made
- [ ] `metabolic_cost` column — needed only if conditioning files land, since
      `fatigue_cost` cannot honestly sum a 400m repeat and a heavy single

### Closed

- [x] `12_fullbody.csv` written — 32 rows, olympic lifts, carries, KB, grip
- [x] Validator v3 — `exercise_family`, `joint_load`, `isolation`, `explosive`,
      `weight_distance`, directory mode, ownership enforcement, gym profiles
- [x] `machine` split — **12** tokens, not the 9 originally proposed.
      `calf_machine`, `hip_abductor_machine`, and `captains_chair` had rows with
      nowhere legal to land. `machine` is retired from the vocabulary.
- [x] `belt` → `dip_belt` rename
- [x] Six pending equipment tokens, plus `med_ball` and `platform` for file 12
- [x] Equipment substitution map — a kettlebell-only setup went from 1 usable
      exercise to ~45

## Related docs

Everything in `docs/fitness/`:

| Doc | What it settles |
|---|---|
| `FITNESS_APP_PLAN.md` | Architecture, data model, milestones |
| `EXERCISE_LIBRARY_TAXONOMY.md` | The 12-file split, ownership rule, calibration anchors |
| `ROM_AND_VARIANT_VOCABULARY.md` | ROM naming, `joint_load` spec, knee-strength family |
| `EQUIPMENT_MASTER_INVENTORY.md` | Full equipment survey and tokenization triage |
| `EQUIPMENT_VOCABULARY.md` | Canonical tokens, substitution map, gym profiles |
