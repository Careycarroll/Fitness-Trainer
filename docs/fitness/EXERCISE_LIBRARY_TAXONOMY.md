# Exercise Library — Muscle Group Split

Splits the exercise library into **12 authoring files**, one per muscle group.
Every file has an **identical header row**. The validator concatenates all of
them before checking, so calibration and slug-uniqueness are still enforced
globally.

**v2 changes:** row counts replaced with actuals (files 01–11 are written);
`exercise_family` and `joint_load` columns documented; `weight_distance`
tracking type added; §7 rewritten as a record of what was actually built.

Current state: **248 rows across 11 files.** `12_fullbody.csv` not yet written.

---

## 1. The ownership rule (read this first)

> **An exercise lives in exactly one file, determined by the FIRST token in its
> `primary_muscles` column.**

Romanian deadlift is `primary_muscles = hamstrings|glutes`. First token is
`hamstrings`, so it lives in `03_hamstrings.csv` and appears in no other file —
even though it is a genuine glute builder and the glute file will look thinner
for its absence.

**Why this rule is not optional.** Without it, "put it wherever it fits" means
the same movement gets authored three times by three different judgment calls,
each with its own `fatigue_cost`. Nothing errors. The seed loader keeps whichever
row it read last, which is alphabetical by filename — an arbitrary winner. The
generator then works off ratings you never approved.

The validator enforces this: **duplicate slug across files = build error**, and
**a row whose first primary muscle does not belong to its file = build error**.

**Consequence to accept:** file size does not equal training importance. The
glute file is short because most glute work is hinge-primary and lives in
hamstrings. That is correct. Volume accounting happens in the generator off
`primary_muscles` + `secondary_muscles`, not off which file a row was typed into.

**Where the rule costs the most:** `07_back.csv` has exactly two erector rows,
because every deadlift is `glutes`-first and lives in file 02. Descriptively
correct, and it looks wrong every time you open the file.

---

## 2. Taxonomy changes this split forced

All four are now implemented in files 01–11.

### 2.1 New movement pattern: `isolation`

Calves, forearms, and neck do not belong to any of squat / hinge / push_h /
push_v / pull_h / pull_v / carry / core / locomotion. The original seed filed
`standing-calf-raise` under `core`, which is wrong in a way that matters: the
solver reasons about pattern balance, so every calf raise read as trunk work and
made a session look better balanced than it was.

`isolation` is the honest junk drawer — single-joint work whose pattern carries
no programming meaning. The solver skips it in balance checks and slots it as
accessory volume.

**Applied to:** leg extension, sissy squat family, all leg curls, all calf work,
hip adduction/abduction, shrugs, superman, all raises, all curls, pushdowns.

**Known inconsistency, unresolved:** flies in `06_chest.csv` are `push_h` and
pushdowns in `10_triceps.csv` are `isolation`, though both are single-joint.
Trunk work in `11_core.csv` stays `core` even where single-joint, because
emptying `core` into `isolation` would defeat the purpose of having the pattern.
The clean rule would be "single-joint = isolation, except trunk." Not applied.

### 2.2 New movement pattern: `explosive`

Snatch and clean & jerk were originally `hinge`. That means a hinge-focused
session could serve a snatch as third accessory, at RPE 8, after squats.
`explosive` marks movements that are CNS-cost-first and must be placed early or
not at all.

**Applied to:** jump squat, kettlebell swing, plyometric push-up. Olympic lifts
follow in file 12.

### 2.3 Tracking types pulled into v1

`time_load` — carries need it. One extra logging input (weight + duration).

`weight_distance` — the three sled rows in `01_quads.csv`. Neither
`weight_reps` nor `distance_time` fits: you track load on the sled and distance
covered. The alternative was calling a length of turf "one rep."

### 2.4 Two columns added after the split began

`exercise_family` — groups variations so the generator knows goblet squat and
heels-elevated goblet squat are the same movement, not two independent choices.
Rows sharing a family are substitution candidates.

`joint_load` — pipe-delimited, optional. **Descriptive, not a warning.** Reads as
"this movement places significant demand on this joint, at end range, under load,
even when performed correctly." The generator takes it in both directions:
`avoid_joint_load: [knee]` for acute pain, `prioritize_joint_load: [knee]` for
building knee resilience. Full spec in `ROM_AND_VARIANT_VOCABULARY.md` §1.

---

## 3. File manifest

| # | File | Owns primary tokens | Rows |
|---|---|---|---|
| 01 | `01_quads.csv` | `quads` | 34 |
| 02 | `02_glutes.csv` | `glutes` | 20 |
| 03 | `03_hamstrings.csv` | `hamstrings` | 19 |
| 04 | `04_calves.csv` | `calves` | 9 |
| 05 | `05_hips.csv` | `adductors`, `abductors` | 13 |
| 06 | `06_chest.csv` | `chest` | 27 |
| 07 | `07_back.csv` | `lats`, `mid_back`, `upper_back`, `traps`, `erectors` | 32 |
| 08 | `08_shoulders.csv` | `front_delts`, `side_delts`, `rear_delts`, `neck` | 28 |
| 09 | `09_biceps.csv` | `biceps`, `forearms` | 20 |
| 10 | `10_triceps.csv` | `triceps` | 21 |
| 11 | `11_core.csv` | `abs`, `obliques`, `hip_flexors` | 25 |
| 12 | `12_fullbody.csv` | *(pattern-selected — not yet written)* | — |
| | | **Total** | **248** |

Original target was 206. The overage is concentrated in `01_quads.csv` (+12, the
knee-strength family), `09_biceps.csv` (+6), and `10_triceps.csv` (+7) — the last
two because head-bias emphasis needs both ends authored at multiple equipment
tiers or the generator has nothing to swap when the cable stack is taken.

### Notes on the awkward files

**`07_back.csv` is the big one (32).** Splitting it further was tempting —
vertical pull vs. horizontal pull vs. erectors — but those are *pattern*
distinctions, not muscle-group distinctions, and the file is already sorted by
pattern. A lat pulldown and a barbell row belong in the same review pass because
you calibrate them against each other.

**`08_shoulders.csv` holds all three delt heads.** Front, side, and rear delts
are genuinely separate targeting decisions, so they remain three muscle tokens.
They share a file because you calibrate a lateral raise against a reverse fly,
not against a squat. `neck` is folded in here — 2 rows, not worth its own file.

**`09_biceps.csv` also owns `forearms`.** Not in the v1 manifest — `forearms` was
a live muscle token with no owning file, so reverse curls and wrist work had
nowhere to live. Same reasoning that folded `neck` into shoulders.

**`12_fullbody.csv` is the exception to the ownership rule.** Snatch is
`glutes|hamstrings|traps` — no single group owns it, and forcing it into glutes
buries it. These movements are defined by their *pattern* (`explosive`, `carry`),
not their primary muscle. This is the only file selected by pattern rather than
by first primary token, and the validator special-cases it.

---

## 4. Per-file composition targets

Row count alone is a bad target — 22 quad exercises that all need a barbell is a
worse file than 12 that span equipment. Each file should satisfy:

- **Equipment spread.** At least 3 rows executable with dumbbells only, and at
  least 1 bodyweight-only, per file. This is what makes a hotel-room session
  possible. The validator reports survivors per pattern under a dumbbell-only
  filter.
- **Fatigue spread.** Not every quad exercise is a 4. Each file needs low-cost
  options the generator can use as accessory volume late in a session.
- **Emphasis pairs.** Where a meaningful axis exists, author both ends —
  `stretch_bias` and `shortened_bias` hamstring curls, `long_head` and
  `short_head` triceps. Singletons are where the generator repeats itself,
  because a movement with no substitute gets picked every time.
- **At least 2 rows at `technical_demand` 1.** Fallbacks for the back half of a
  session, when skill work is a bad idea.

**One floor is knowingly violated.** `09_biceps.csv` has zero bodyweight-only
rows. There is no loaded biceps movement requiring nothing — the honest
bodyweight biceps exercise is the chin-up, which is `lats`-primary and lives in
file 07. The rule should be relaxed to "bodyweight-only where the muscle
permits" rather than special-cased in the validator.

---

## 5. Calibration anchors (unchanged across all 12 files)

These are the reference rows. When rating a new movement, compare against these
rather than against the abstract 1–5 scale.

| Axis | 1 | 3 | 5 |
|---|---|---|---|
| `fatigue_cost` | Cable fly, lateral raise | Bulgarian split squat | Back squat, deadlift |
| `technical_demand` | Leg press, machine curl | Back squat, barbell row | Snatch, clean & jerk |

**The two axes are independent.** Leg press is `fatigue_cost 4, technical_demand
1` — genuinely taxing, nearly impossible to do wrong. Snatch is `fatigue_cost 3,
technical_demand 5` — high skill, moderate systemic cost. Conflating them is the
most common way this table goes wrong, and it produces sessions that are either
unrecoverable or trivially easy.

**Only three rows in the library hold `fatigue_cost 5`:** back squat,
conventional deadlift, sumo deadlift. That is the point of a ceiling anchor.

**Drift is the real risk.** A healthy library is bottom-heavy: most movements are
1s and 2s. If the mean `fatigue_cost` across all rows climbs past **2.6**, the
scale has stretched and the generator's per-session fatigue budget has quietly
stopped meaning anything. The validator fails the build on this.

### Per-file means as built

| File | Mean `fatigue_cost` |
|---|---|
| `01_quads.csv` | 2.29 |
| `02_glutes.csv` | 2.15 |
| `03_hamstrings.csv` | 2.16 |
| `04_calves.csv` | 1.00 |
| `05_hips.csv` | 1.33 |
| `06_chest.csv` | 2.00 |
| `07_back.csv` | 2.19 |
| `08_shoulders.csv` | 1.61 |
| `09_biceps.csv` | 1.05 |
| `10_triceps.csv` | 1.43 |
| `11_core.csv` | 1.20 |
| **Library** | **~1.83** |

Comfortably under the ceiling. File 12 will raise it — olympic lifts and carries
are expensive — but not enough to matter at 248 rows.

---

## 6. Build pipeline

```
01_quads.csv ─┐
02_glutes.csv ─┤
     ...       ├─→ concat ─→ validator ─→ exercises.json ─→ seed loader ─→ Postgres
12_fullbody.csv ┘            (CI gate)     (generated)        (deploy)
```

The 12 files are the authoring surface. Nothing downstream knows they were ever
separate — concatenation happens before validation, so cross-file slug
collisions, muscle-token typos, and global calibration drift are all still
caught.

Validator changes required for the split — **none of these are done yet**, and
running the current validator against files 01–11 fails on nearly every row:

1. Accept a directory or glob instead of a single file path.
2. Track source filename per row so errors report `03_hamstrings.csv row 12`
   rather than a meaningless concatenated line number.
3. New error: duplicate slug across files.
4. New error: first `primary_muscles` token does not belong to the owning file
   (per §3 manifest), with `12_fullbody.csv` exempted.
5. Add `isolation` and `explosive` to `MOVEMENT_PATTERNS`.
6. Move `time_load` into `TRACKING_TYPES_V1`; add `weight_distance`.
7. Accept the `exercise_family` and `joint_load` columns.
8. Add the six pending equipment tokens: `safety_bar`, `suspension_trainer`,
   `stability_ball`, `plate`, `ez_bar`, `slant_board`.
9. Resolve the `machine` split — see `EQUIPMENT_VOCABULARY.md` §1.

---

## 7. Generation order — what was actually built

Order was chosen so the scales were anchored before the ambiguous files were
written, and it held up:

1. **`01_quads.csv`** — anchored the top of the `fatigue_cost` scale (back squat
   at 5). Revised to v2 later to add the knee-strength family and `joint_load`.
2. **`02_glutes.csv`** — took all four deadlift variants by the ownership rule,
   which set the ceiling anchors alongside back squat.
3. **`03_hamstrings.csv`** — first file where `exercise_family` did real work:
   hip-extension and knee-flexion rows are not substitutes for each other.
4. **`04_calves.csv`** — first file that is entirely `isolation` pattern, and
   the floor of both scales (every row 1/1).
5. **`05_hips.csv`** — first file owning two primary tokens.
6. **`06_chest.csv`** — anchored the `emphasis` vocabulary (flat / incline /
   decline) and holds the densest substitution cluster in the library.
7. **`07_back.csv`** — largest file, five owned tokens.
8. **`08_shoulders.csv`** — proved the three-delt-token decision: the heads sit
   on three different movement patterns.
9. **`09_biceps.csv`** — first use of `long_head` / `short_head` emphasis.
   Absorbed `forearms`.
10. **`10_triceps.csv`** — closed the head-bias argument. 21 rows, one primary
    muscle token, emphasis carrying the entire distinction.
11. **`11_core.csv`** — families are functions (anti-extension, anti-rotation,
    rotation), not equipment.
12. **`12_fullbody.csv`** — blocked on the equipment vocabulary decision, since
    it introduces the most new tokens and the kettlebell substitution map
    determines whether several of its rows exist at all.

---

## 8. Related docs

| Doc | What it settles |
|---|---|
| `FITNESS_APP_PLAN.md` | Architecture, data model, milestones |
| `ROM_AND_VARIANT_VOCABULARY.md` | ROM naming, `joint_load` spec, knee-strength family |
| `EQUIPMENT_MASTER_INVENTORY.md` | Full equipment universe, tokenization triage |
| `EQUIPMENT_VOCABULARY.md` | Canonical tokens, `machine` split, substitution map, gym profiles |
