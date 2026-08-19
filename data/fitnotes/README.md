# FitNotes mapping manifest

`fitnotes-mapping.csv` maps every exercise definition in the athlete's FitNotes
Android export onto the Trainer catalog. Trainer IDs and names are canonical for
exported plans (#33); FitNotes names are preserved as migration aliases.

The mapping was produced in an earlier session and existed only as a spreadsheet
outside the repo and as prose in #38. It was nearly lost. This directory is the
tracked record.

**No live FitNotes database is read or modified by anything in this repo.** The
export is the athlete's own data and is deliberately not committed.

---

## What the file contains

149 FitNotes definitions and 748 completed sets, every row accounted for.

| Tier | Rows | Meaning |
| --- | --- | --- |
| `exact` | 51 | Names identical after normalisation |
| `alias` | 36 | Different name, unambiguous movement |
| `token-set` | 11 | Same tokens, different order or spelling |
| `judgement` | 7 | Resolved by the athlete's account of what he was doing (#38) |
| `review` | 40 | **Not approved.** No mapping applied |
| `legacy` | 4 | No Trainer equivalent; imports as a legacy row |

`tracking` is populated for all 311 rows — the 98 matched, the 213 Trainer rows
with no FitNotes definition — as `weight_reps` (118), `reps_only` (67), `time`
(15), `time_load` (8), or `weight_distance` (5).

### No fuzzy tier is auto-approved

An early automated pass scored `Incline Barbell Bench Press` against
`Barbell Bench Press` while `Incline Barbell Press` existed, which would have
carried 18 sets onto the wrong lift. Nothing above `token-set` is applied without
an explicit decision recorded against an issue.

The 40 `review` rows carry **0 completed sets between them**. They cannot corrupt
history, so they do not block the manifest. They are picker clutter, not data
risk.

---

## Many-to-one merge rule

Ten Trainer exercises receive more than one FitNotes definition. This is what a
FitNotes table looks like after years of use: the stock row survives beside the
athlete's renamed or re-created copy.

**The merge is safe here for one checkable reason: in every group, at most one
source carries completed sets.** No two histories combine, so no estimated 1RM is
affected.

| Trainer target | FitNotes sources (sets) |
| --- | --- |
| Dumbbell Lateral Raise | Lateral Dumbbell Raise (23) · Seated Dumbbell Lateral Raise (0) |
| Leg Extension | Leg Extension Machine (13) · Leg Extension (0) |
| Seated Leg Curl | Seated Leg Curl Machine (7) · Seated Leg Curl (0) |
| Triceps Dip | Parallel Bar Triceps Dip (6) · Parallel Bar Triceps Dips (0) |
| Push-Up | Push Up (6) · Pushup (0) |
| Seated Calf Raise | Seated Calf Raise Machine (5) · Seated Calf Raise (0) |
| Standing Calf Raise | Barbell Calf Raise (4) · Standing Calf Raise (0) · Standing Calf Raise Machine (0) |
| Cycling - Outdoor | Cycling (0) · Cycling (Outdoor) (0) |
| Cycling - Stationary Bike | Cycling (Indoor) (0) · Stationary Bike (0) |
| Lying Leg Curl | Lying Leg Curl (0) · Lying Leg Curl Machine (0) |

### This is a property of this export, not a guarantee

ADR-023 computes estimated 1RM from logged sets, so two populated sources
merging silently would change future prescriptions rather than sitting inert.

**Re-check on every new export.** One set logged against `Pushup` makes that
group unsafe. If two sources in a group ever both carry sets, the merge needs an
explicit decision before import — combining them, keeping them separate, or
choosing one — and that decision belongs in an issue, not in this table.

---

## Conditioning coverage

8 of the 14 monostructural rows have a FitNotes definition:

- Mapped — Walking, Running - Outdoor, Running - Treadmill, Cycling - Outdoor,
  Cycling - Stationary Bike, Rowing Machine, Elliptical Trainer, Jump Rope
- Absent — Air Bike, Ski Erg, Stair Climber, Heavy Bag Boxing, Shadow Boxing,
  Battle Ropes

The six absent are simply not defined in FitNotes. Authoring them into the
athlete's exercise picker is not this repo's business.

**Stair Climber is the one that bites.** It is what `cardio` currently
prescribes, so a generated plan contains a movement FitNotes has no row for.
Lazy creation at export time — creating only the exercises a plan actually
contains — is therefore required rather than optional. Carried to the export work
per #38.

---

## Deliberate omissions

**213 Trainer rows have no FitNotes definition.** Creating all of them would
bloat the exercise picker with movements never prescribed. Lazy creation at
export is the recommendation, and it is an export-path decision (#38).

**`Shoulder Curl`, 17 sets, stays unmapped.** It is a biceps curl transitioning
into a shoulder press: two movements logged as one, and the catalog models both
separately. Mapping a combo lift to half of itself corrupts the estimated 1RM on
both halves, which is worse than an honest gap. Tracked in #38.

---

## Regenerating

The manifest is authored, not generated. It encodes judgement calls that no
matcher can make — see the seven `judgement` rows and the reasoning in #38.

On a new FitNotes export, diff the definition list against `fitnotes_name` in
this file, map only what is new, and re-run the merge-safety check above. Do not
rebuild the file from a fresh automated pass; the near-miss at the top of this
document is what that produces.
