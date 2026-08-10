# Equipment Vocabulary

Settles the equipment layer before `12_fullbody.csv` is written. Covers the
canonical token list, the `machine` problem, the substitution map, and the gym
profiles the validator reports survivors against.

Library state at time of writing: **247 rows across 11 files.**

---

## 1. The real finding: `machine` is not a token, it's a shrug

`machine` currently appears on **35 rows** and stands for eleven physically
different pieces of equipment:

| What the row means | Rows |
|---|---|
| Selectorised cable stack | already `cable`, fine |
| Leg press sled | 3 |
| Hack squat | 1 |
| Belt squat | 1 |
| Leg extension | 1 |
| Leg curl (seated / lying / standing) | 4 |
| Smith machine | 3 |
| Plate-loaded chest / shoulder / row | 8 |
| Pec deck / reverse fly | 3 |
| Hip thrust machine | 1 |
| Hip adduction / abduction | 2 |
| 45° back extension / reverse hyper / GHR | 5 |
| Calf raise (standing / seated) | 2 |
| Captain's chair, ab crunch machine | 2 |

**Why this matters more than the six pending tokens.** `equipment` is the
generator's only *hard* filter. Every other column is a preference. A filter
whose largest token means "some machine, somewhere" produces exactly one useful
answer — full commercial gym — and is a lie in every other setting. Ask for a
quad session in a garage gym today and the solver will happily prescribe a hack
squat, because the profile says `machine` and so does the row.

**Recommendation: split into 9 tokens, retire `machine` entirely.**

```
leg_press | hack_squat | belt_squat | leg_extension_machine | leg_curl_machine
smith_machine | plate_loaded | pec_deck | back_extension_bench
```

Rules for the split:

- `plate_loaded` covers plate- and selectorised-stack pressing/rowing units —
  chest press, shoulder press, machine row, machine lateral raise, machine
  preacher curl, machine triceps extension. These cluster because any gym with
  one has most of them.
- `back_extension_bench` covers 45° hyper, reverse hyper, and GHR. Same corner
  of the same gyms.
- `pec_deck` is separate from `plate_loaded` because a lot of home setups have
  a press station and no fly station.
- `machine` is **removed from the vocabulary**. Leaving it as a legal fallback
  guarantees drift back into it on row 260.

**Cost: a 35-row sweep across 11 files.** Half the price now that it will be
after file 12 and the conditioning files, and it is the difference between the
equipment filter working and merely appearing to.

**The counter-argument, honestly:** you train somewhere with all of it, so for
your own use `machine` is adequate. If you want to defer, the fallback is to
keep `machine` and add only `smith_machine` and `leg_press` — the two that most
often exist without the rest. I'd still split fully.

---

## 2. Canonical token list

### 2.1 Confirmed — currently in the validator (17 after removing `machine`)

```
barbell        dumbbell       kettlebell     trap_bar
cable          rack           bench          box
platform       pullup_bar     dip_bar        belt
bands          ab_wheel       sled           landmine
bodyweight
```

### 2.2 Pending — used in files 01–11, not yet in the validator (6)

```
safety_bar     suspension_trainer     stability_ball
plate          ez_bar                 slant_board
```

All six are already load-bearing in written rows. They go in regardless of the
`machine` decision.

### 2.3 Proposed — the machine split (9)

```
leg_press      hack_squat            belt_squat
leg_extension_machine                leg_curl_machine
smith_machine  plate_loaded          pec_deck
back_extension_bench
```

### 2.4 Needed by `12_fullbody.csv` (2)

```
med_ball       parallettes
```

`platform` already exists for olympic lifting. `sandbag`, `yoke`, `atlas_stone`,
and `log` stay out — equipment you don't have, and the metadata would be guesswork.

**Total if everything lands: 34 tokens.**

---

## 3. `bench` — derived, not split

Incline dumbbell press needs an adjustable bench. Flat bench press does not.
That is a genuine home-gym distinction, and it is tempting to add
`bench_adjustable`.

**Don't. It's already in the data.** Any row with `bench` in `equipment` and
`incline` or `decline` in `emphasis` requires adjustability. One derived rule
in the validator, zero new tokens, zero rows to edit:

```python
def requires_adjustable_bench(row) -> bool:
    return "bench" in row["equipment"] and \
           bool({"incline", "decline"} & set(row["emphasis"]))
```

Gym profiles then declare `bench_adjustable: true|false` as a *capability*
rather than a token, and the filter consults the derived rule. Same result,
nothing to maintain.

The one row this misreads is `dumbbell-fly` — flat bench, but most people do
them on an incline. Emphasis is `stretch_bias`, not `incline`, so it resolves
as flat-bench-legal. Correct enough.

---

## 4. Substitution map — the kettlebell answer

Settled: **no duplicate kettlebell rows.** A KB goblet squat and a DB goblet
squat are the same exercise — same pattern, same muscles, same fatigue, same
rep range. Authoring both gives the solver two identical candidates and doubles
the review burden for nothing.

Instead, equipment matching stops being exact-string:

```python
# owned token -> requirements it can satisfy
SATISFIES = {
    "kettlebell":  {"dumbbell"},
    "dumbbell":    {"kettlebell", "plate"},
    "barbell":     {"ez_bar"},
    "ez_bar":      {"barbell"},
    "trap_bar":    set(),                  # substitutes for nothing
    "plate":       set(),
    "bench":       {"box"},                # bench works as a step/prop
    "box":         set(),                  # a box is not a bench
    "smith_machine": {"rack"},             # for pressing/squatting setups only
    "dip_bar":     {"parallettes"},
    "parallettes": set(),
}
```

Asymmetry is deliberate and is where the value is. A bench serves as a box; a
box has no back support and no stability, so it does not serve as a bench. A
Smith machine covers a rack for a bench press but not for a rack pull.

**Family-level exceptions.** Three families where the KB↔DB swap is genuinely
worse, not merely different:

```python
NO_SUBSTITUTE_FAMILIES = {
    "fly":           {"kettlebell"},   # offset mass fights the arc
    "wrist_curl":    {"kettlebell"},
    "preacher_curl": {"kettlebell"},
    "lateral_raise": {"kettlebell"},   # KB laterals are a different exercise
}
```

Four exceptions, not forty rows. That ratio is the argument for this approach.

**Payoff:** a kettlebell-only setup currently resolves to **1 exercise** in the
entire library. With the map it resolves to roughly **45** — goblet squats,
RDLs, rows, presses, lunges, carries, swings.

---

## 5. Kettlebell rows that *do* earn their own entry

Only where the implement changes the movement — offset centre of mass, rack
position, or a bell path a dumbbell can't trace. Seven rows, all bound for
`12_fullbody.csv` since they're `explosive` or full-body by pattern:

| Movement | Why it's not a dumbbell row |
|---|---|
| Turkish Get-Up | Overhead stability through five distinct positions; no DB equivalent |
| Kettlebell Clean | Rack position and bell path are KB-specific |
| Kettlebell Snatch | Single-arm overhead ballistic; DB version is a different lift |
| Kettlebell Windmill | Loaded lateral flexion under an overhead bell |
| Bottoms-Up Press | The instability *is* the exercise |
| Double KB Front Squat | Double rack position, unique trunk demand |
| Kettlebell High Pull | Between swing and snatch; own force curve |

Existing `kettlebell-swing` in `02_glutes.csv` stays where it is.

---

## 6. Gym profiles — what the validator reports against

Row counts alone don't tell you whether the library works. These four profiles
do. The validator prints survivors per muscle group per profile, and fails the
build if any profile drops a muscle group to zero.

| Profile | Tokens |
|---|---|
| `commercial` | everything |
| `garage` | barbell, rack, bench, dumbbell, box, bands, pullup_bar, plate, ez_bar, trap_bar, slant_board, sled, bodyweight |
| `minimal` | dumbbell, bands, bodyweight, box |
| `hotel` | bodyweight, bands |

`minimal` and `hotel` are the ones that will fail. That's the point — better to
know that hamstrings collapse to two options in a hotel room than to discover
it mid-session.

Known weak spots before the check even runs:

- **Hamstrings under `hotel`** — sliding leg curl and band good morning. Two rows.
- **Adductors under `hotel`** — Copenhagen needs a bench. Cossack squat survives.
- **Biceps under `hotel`** — zero. Flagged previously; no honest fix exists.
- **Calves under `hotel`** — bodyweight calf raise only, and no way to load it.

---

## 7. Validator changes

1. Remove `machine` from `EQUIPMENT`; add the 9 split tokens.
2. Add the 6 pending tokens and the 2 file-12 tokens.
3. Add `SATISFIES` and `NO_SUBSTITUTE_FAMILIES`; resolve equipment through them
   before filtering.
4. Add `requires_adjustable_bench()` derived check.
5. Add `GYM_PROFILES`; report survivors per muscle group per profile.
6. New error: any row still using `machine` after the sweep.
7. New warning: a muscle group with fewer than 3 survivors under `garage`.

---

## 8. Open decisions

| # | Decision | My call |
|---|---|---|
| 1 | Split `machine` into 9, or keep it plus `smith_machine`/`leg_press` | **Split fully** — 35-row sweep now, cheaper than later |
| 2 | Kettlebell rows: 7 distinct, or 40 duplicates | **7 + substitution map** |
| 3 | `bench_adjustable` as a token, or derived from emphasis | **Derived** |
| 4 | `med_ball` and `parallettes` in, or cut the rows that need them | **In** — 4–5 rows in file 12 |
| 5 | `ankle` added to `joint_load` for symmetry | **No** — nothing loads it at end range |

Answer 1 and I'll run the sweep, then write file 12 against a settled vocabulary.
