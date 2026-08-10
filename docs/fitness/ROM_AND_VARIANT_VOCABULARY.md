# ROM & Variant Vocabulary

Reference for authoring the exercise library. Two purposes: name the variants
correctly, and decide which ones earn a library row versus which are a
prescription setting on a row that already exists.

---

## 1. The correction to `joint_load` (was `joint_stress`)

`joint_stress` was the wrong name and the wrong concept. It merged two facts
that point in opposite directions:

- *This movement wears the joint out* — a risk claim
- *This movement loads the joint hard at end range* — a description

Sissy squats, ATG split squats, and reverse Nordics are the second. That is
precisely why they build knee resilience: loaded end-range knee flexion is the
stimulus. A column that flags them as hazards would have the generator strip out
the exact movements being sought.

**Corrected spec — descriptive, not prescriptive:**

```
joint_load = knee | lower_back | shoulder | elbow | wrist | hip | neck
```

Pipe-delimited, optional, blank on most rows. Read it as: *"this movement places
significant demand on this joint, at end range, under load, even when performed
correctly."*

The generator takes a preference, not a rule:

| Parameter | Effect | Who uses it |
|---|---|---|
| `avoid_joint_load: [knee]` | Drops those rows from the pool | Acute pain, post-op, in-season |
| `prioritize_joint_load: [knee]` | Weights those rows up | Building joint resilience |
| unset | No effect | Default |

One column, opposite uses. The knee-strength family below becomes a queryable
set instead of a list of names to remember.

**What `joint_load` is not.** It is not a safety rating and not a substitute for
`technical_demand`. A movement can be high `joint_load` and low
`technical_demand` — leg extension is trivial to execute and puts high shear on
the knee. That combination is the whole reason the column exists: neither
existing axis captures it.

---

## 2. Range-of-motion vocabulary

### 2.1 The core terms

| Term | Meaning | In our schema |
|---|---|---|
| **Full ROM** | End to end, joint's usable range | Default; no tag |
| **Lengthened partials** | Reps confined to the stretched half. Also "long-length partials." | `emphasis: stretch_bias` + prescription note |
| **Shortened partials** | Reps confined to the contracted half | `emphasis: shortened_bias` |
| **Deficit** | ROM *extended past* standard, usually by elevating the lifter | Own row (`deficit-romanian-deadlift`) |
| **Partial / block / pin** | ROM *truncated* by a hard stop | Own row (`rack-pull`) |
| **1.5 reps** | Full rep, then the bottom half again | Prescription |
| **Iso-hold / pause** | Static at a position | Prescription (tempo) |

### 2.2 Named truncated-ROM lifts

These have their own names because the hard stop changes the lift enough to
train differently. All are **own rows**, tagged `shortened_bias`.

| Name | What it is | Why it exists |
|---|---|---|
| **Rack pull** | Deadlift from pins at knee height or above | Overloads the lockout; spares the pull off the floor |
| **Block pull** | Deadlift from blocks under the plates | Same as rack pull with a less awkward bar path |
| **Pin squat** | Squat starting from a dead stop on pins | Kills the stretch reflex; exposes the weak position |
| **Anderson squat** | Pin squat starting from the *bottom* | Concentric-only; brutal, very knee/hip specific |
| **Board press** | Bench with boards on the chest limiting depth | Overloads lockout; triceps-biased |
| **Pin press** | Press from pins in a rack | Dead-stop equivalent of the board press |
| **Floor press** | Bench on the floor; elbows stop at the deck | Same effect, no equipment beyond a bar |

Currently in the library: `rack-pull`, `barbell-floor-press`,
`dumbbell-floor-press`. The rest are candidates, not commitments — see §5.

### 2.3 Named extended-ROM lifts

| Name | What it is |
|---|---|
| **Deficit deadlift / RDL** | Standing on a plate or block; longer pull |
| **Deficit push-up** | Hands on dumbbells or parallettes; chest drops below hands |
| **Deep / ATG squat** | Maximal depth, hamstring on calf. "Ass to grass." |
| **Snatch-grip anything** | Wider grip lengthens the movement |

### 2.4 Terms that are *not* ROM, and are prescription

Common source of confusion. None of these get a library row.

- **Tempo** (e.g. 3-1-1-0) — eccentric/pause/concentric timing
- **Cluster sets, rest-pause, myo-reps** — set structure
- **21s** — a partial-rep scheme, not a movement
- **Drop sets, back-off sets** — load progression
- **Cheat reps** — a form allowance

---

## 3. The knee-strength family — correct names

This is the group referenced as "knees over toes." Most were popularized by Ben
Patrick; several are older rehab movements. The unifying feature: loaded knee
flexion past 90°, with the knee tracking forward over the toes.

All of these will carry `joint_load: knee` — as a *feature*.

### 3.1 Deep knee-flexion strength

| Name | Description | Library status |
|---|---|---|
| **ATG split squat** | Front foot flat, deep descent, back knee to floor, torso upright. Front knee travels well past the toe. | **Add** — distinct from Bulgarian and standard split squat |
| **Sissy squat** | Knees drive forward, hips stay extended, torso and thigh in one line | Already in `01_quads.csv` |
| **Reverse Nordic curl** | Kneeling upright, lean backward under control. Eccentric quad and knee at long length. | **Add** — the single biggest gap |
| **Slant board squat** | Heels elevated on a wedge, narrow stance, maximal depth | **Add** — needs `slant_board` equipment token |
| **Cyclist squat** | Heels elevated, narrow stance, upright torso. Effectively the barbell version of the above. | **Add** |
| **Petersen step-up** | Very short step, driven by the ankle and the VMO, heel of the working leg stays lifted | **Add** |
| **Poliquin step-up** | Short step-up from a slant board, heel elevated | Optional — near-duplicate of Petersen |
| **Step-down** | Controlled eccentric descent from a box on one leg | **Add** — low-skill entry to the family |

### 3.2 Low-shear knee loading

The other half of the approach: loading the quad with no eccentric and no shear.

| Name | Description | Library status |
|---|---|---|
| **Backward sled drag** | Walking backward dragging a sled. Concentric-only quad work. | **Add** — needs no new equipment token |
| **Forward sled push/drag** | Concentric quad and hip | **Add** |
| **Terminal knee extension (TKE)** | Band behind the knee, straighten against it | **Add** |
| **Tibialis raise** | Toes up against resistance | Already in `04_calves.csv` |
| **Nordic curl** | Hamstring eccentric — the posterior counterpart | Already in `03_hamstrings.csv` |

### 3.3 What this adds

Roughly **11 rows**: 8 to `01_quads.csv`, 3 sled rows that need a placement
decision (they are quad-primary but `locomotion` pattern — see §5).

One new equipment token: `slant_board`. Pending list becomes six —
`safety_bar`, `suspension_trainer`, `stability_ball`, `plate`, `ez_bar`,
`slant_board`.

---

## 4. Decision rule — row or prescription?

Restating the rule from earlier, now that ROM variants make it concrete.

**It earns a row if it changes any of:**

- Required equipment
- Which muscle is primary
- Resistance profile through the range
- Stability or technical demand
- Unilateral vs. bilateral
- How it is tracked

**It stays a prescription if it only changes:**

- Tempo, pauses, or rep timing
- Set and rep counts
- Load, RPE, or RIR
- Rest interval

**The ROM test specifically:** a truncated or extended range earns a row when it
requires *different equipment or setup* — pins, blocks, boards, a deficit
platform. It stays a prescription when it is only an instruction: "lengthened
partials on the last set" is a note on a row that already exists.

Worked examples:

| Variant | Verdict | Why |
|---|---|---|
| Rack pull | Row | Needs a rack, different setup, different load |
| Deficit RDL | Row | Needs a platform, longer range |
| Lengthened partials on a curl | Prescription | Same setup, same bar, an instruction |
| 3-sec eccentric squat | Prescription | Tempo |
| ATG split squat | Row | Different stance, depth, and torso angle than a standard split squat |
| Pause squat | Prescription | Tempo |
| Slant board squat | Row | Needs a slant board |
| Heels-elevated goblet squat | Row (already exists) | Needs a plate or wedge |

---

## 5. Open decisions

Three, all cheap now and annoying after file 12.

**5.1 Sled placement.** Sled rows are quad-primary but `locomotion` pattern.
They fit neither the muscle-group ownership rule nor the `12_fullbody.csv`
exception cleanly. Options: put them in `01_quads.csv` and accept a
`locomotion` row in a muscle file, or open `14_conditioning.csv` early. Leaning
toward quads — the intent is strength, not conditioning.

**5.2 Which truncated-ROM lifts to author.** Pin squat, Anderson squat, board
press, pin press, and block pull are all legitimate and all near-duplicates of
rows that exist. Recommend: **none for now.** They matter for peaking a
powerlifting total and add five near-identical candidates to the generator's
pool otherwise. Easy to add later; hard to prune once the generator is tuned
against them.

**5.3 Equipment interchangeability map.** Still unanswered from the kettlebell
discussion. This blocks file 12, since carries and swings are where it bites
first.

```
INTERCHANGEABLE = {
    "dumbbell": {"kettlebell"},
    "ez_bar":   {"barbell"},
    "plate":    {"dumbbell", "kettlebell"},
}
```

Either this dict goes in the validator, or ~40 kettlebell duplicate rows get
authored. Recommend the dict.
