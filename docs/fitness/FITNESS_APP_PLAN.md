# Fitness App — Technical Plan v3

**Role split:** Carey = Product Manager (scope, priorities, acceptance criteria). Claude = Software Engineer (architecture, schema, implementation, tradeoffs).

**Status:** All blocking questions resolved. Ready to write schema pending repo access.

**Changed from v2:**
- Deployment target is **single-user (Carey)**. Auth, onboarding, and novice-safe defaults removed.
- **Manual 1RM entry pulled into M1** — percentage-based prescription now works on day one instead of falling back to RPE.
- **Session editor promoted into M2**, shipping alongside the generator. The main loop is generate → tweak → log, not generate → log.
- `experience_level` demoted from a user-facing gate to a static config value.

---

## 1. Problem Statement

Plan training at two horizons:

1. **Single session** — "what am I doing in the gym in 40 minutes"
2. **Multi-week regimen** — "what do the next 12 weeks look like, and how does week 7 differ from week 2"

**Neither is authored from scratch.** The answer to "what should I do today" is a generator that takes parameters and emits a credible, immediately editable session. Authoring is the escape hatch.

**New in v3:** the user is an experienced lifter who knows his own numbers and will have opinions the parameters don't capture. The generator's job is to produce a strong first draft, not a final answer. Every generated session must be editable in under thirty seconds without leaving the screen.

---

## 2. Core Architectural Decisions

### 2.1 One recursive plan tree

```
Program            (8–16 weeks, has a goal + progression model)
└── Mesocycle      (3–6 weeks, e.g. "Accumulation", "Peak", "Deload")
    └── Week       (ordinal, has a target load multiplier)
        └── Session    (one workout; can exist WITHOUT a parent)
            └── Block      ("Warmup", "Main Lift", "Accessory", "Conditioning")
                └── SetGroup   (one exercise + its prescription)
                    └── Set        (the atomic unit: reps, load, RPE, rest)
```

A one-off session is a `Session` with `plan_week_id = NULL`. Same editor, same player, same logging flow. No parallel code paths.

**The generator emits into this same tree.** A generated workout is an ordinary `Session` — fully editable the moment it exists. No locked or special-cased "generated" state.

### 2.2 Prescription vs. Performance

Hard separation, non-negotiable:

- **`PrescribedSet`** — what the plan says (3 × 5 @ 82.5%, RPE 8)
- **`LoggedSet`** — what actually happened (3 × 5 @ 185lb, RPE 9, one rep missed)

Never the same row. This is what makes adherence tracking, progression, and eventual auto-regulation possible. Merging them is unrecoverable without a migration.

### 2.3 Templates are copied, not referenced

Applying a program template **deep-copies** it into the account. No live reference to the source. Nobody wants week 5 silently rewritten.

### 2.4 Ownership: solo, single-user deployment

**Resolved:** this is a personal tool. One user, who plans and performs his own training.

What this removes from v1:
- Signup, email verification, password reset, account management
- Onboarding flow and novice-safe defaults
- Any notion of sharing, following, or social

What it keeps, deliberately:
- **`owner_id` on every ownable table.** One column, populated with a constant. Access is checked in exactly one accessor, not inline across the codebase.

Cost today: near zero. If this ever becomes multi-user, it's a real auth provider plus one changed accessor — not a schema migration across a dozen tables.

**Auth in v1:** a single signed session cookie against an env-var credential. Not a user system. Enough to keep the instance from being world-writable.

### 2.5 Scheduling: computed, not stored

**Resolved (shift-or-skip):** a Program stores an `anchor_date`; each Session stores a `day_offset`. Calendar dates are derived at read time.

Missing a session prompts **shift or skip**. Shift = increment the anchor or the offsets downstream. Skip = mark status and move on. Single-field update either way, instead of a bulk rewrite of every future row.

Cost: no session has a stored date, so every calendar view computes. Irrelevant at this scale.

### 2.6 Hand-edits freeze downstream weeks

Editing week 5 does **not** recalculate weeks 6–8. Frozen is predictable and never destroys work. Recalculation is a v2 objective.

---

## 3. Data Model

```
User                              -- exactly one row in v1
  id, email, display_name, units (kg|lb), created_at
  experience_level                -- static config; gates technical_demand in the generator

Exercise                          -- the generator's fuel; see §4
  id, name, slug, modality
  movement_pattern (squat|hinge|push_h|push_v|pull_h|pull_v|carry|core|locomotion)
  primary_muscles[], secondary_muscles[]
  equipment[]                     -- barbell, rack, dumbbell, cable, bodyweight...
  is_compound, fatigue_cost (1-5), technical_demand (1-5)
  default_rep_low, default_rep_high, default_rest_sec
  is_unilateral, tracking_type
  owner_id NULL                   -- NULL = global exercise

TrackingType                      -- enum, drives the logging UI
  weight_reps | reps_only | time | distance_time | time_load
  -- v1 IMPLEMENTS: weight_reps, reps_only, time
  -- v2: distance_time, time_load

Program
  id, owner_id, name, goal, duration_weeks
  progression_model, status (draft|active|archived|template)
  anchor_date, source_template_id NULL

Mesocycle
  id, program_id, name, order_index, week_count, intent

PlanWeek
  id, mesocycle_id, order_index, is_deload, load_multiplier

Session
  id, owner_id
  plan_week_id NULL               -- NULL = standalone / generated ad-hoc
  name, order_index, day_offset NULL
  estimated_duration_min, status (planned|in_progress|complete|skipped)
  generated_from_params JSONB NULL  -- provenance; enables "regenerate"

Block
  id, session_id, name, order_index
  block_type (straight|superset|circuit|emom|amrap)
  rounds NULL, time_cap_sec NULL

SetGroup
  id, block_id, exercise_id, order_index
  notes, rest_sec, tempo NULL

PrescribedSet
  id, set_group_id, order_index
  target_reps NULL, rep_range_low NULL, rep_range_high NULL
  load_type (absolute|percent_1rm|rpe|rir|bodyweight)
  load_value NULL, target_rpe NULL, target_rir NULL
  duration_sec NULL, distance_m NULL
  is_amrap, is_warmup

SessionLog
  id, session_id, user_id, started_at, completed_at
  perceived_effort, bodyweight NULL, notes

LoggedSet
  id, session_log_id, prescribed_set_id NULL   -- NULL = added on the fly
  exercise_id, order_index
  actual_reps, actual_load, actual_rpe
  duration_sec NULL, distance_m NULL
  completed_at, was_skipped

ExerciseMax                       -- feeds percent-based generation
  id, user_id, exercise_id, e1rm
  source (tested|estimated|entered)   -- 'entered' is new in v3
  computed_at
```

**`generated_from_params`** stores the inputs that produced a generated session. One JSONB column, and it buys "regenerate this but keep it shorter" — the highest-value follow-up action in the generator flow.

**`ExerciseMax.source = 'entered'`** is the v3 addition that makes percentage prescription work on day one. Seeded by hand for the main lifts; `estimated` values are recomputed from logs thereafter.

---

## 4. The Generator

**This is the product.** Everything else is scaffolding around it.

### 4.1 Approach: constraint solver, not a model

Rules-based selection under constraints. Debuggable, deterministic, testable. If it prescribes something dumb we can find out exactly why and fix that rule. Reaching for anything fancier before the rules demonstrably fail trades away every one of those properties for novelty.

### 4.2 Inputs

| Parameter | Example | Notes |
|---|---|---|
| Time available | 45 min | Hard constraint — drives set count |
| Equipment | rack, barbell, dumbbells | Hard filter on exercise pool |
| Target | full body / push / legs / specific muscles | |
| Recent training | last 7 days of logs | Avoids re-hammering fatigued muscles |
| Intensity | easy / moderate / hard | Maps to RPE + volume targets |

`experience_level` is read from config rather than asked. There is one user and his level does not change between sessions.

### 4.3 Algorithm sketch

1. **Filter** the exercise pool by equipment, modality, and `technical_demand ≤ experience_level`.
2. **Select the primary** — highest-value compound matching the target pattern, biased away from anything trained hard in the last 48–72h.
3. **Fill supporting slots** — enforce pattern balance (no push-only sessions), respect a session-level `fatigue_cost` budget.
4. **Assign volume** — sets and reps from intensity target and each exercise's defaults.
5. **Assign load** — `%e1RM` wherever a max exists, RPE only as fallback. With maxes seeded at setup, the main lifts get real percentages from session one.
6. **Fit to time** — estimate duration from sets × (work + rest); trim accessories until it fits.
7. **Emit** an ordinary editable `Session`.

### 4.4 "Challenging but plausible"

Three testable invariants:

- **Plausible:** total session `fatigue_cost` within recent tolerance; no muscle group trained hard twice inside 48h.
- **Challenging:** prescribed load ≥ recent equivalent working load at the same rep range; deliberately no easier than last time unless intensity is set to `easy`.
- **Fits:** estimated duration within ±10% of the time constraint.

Each is a unit test against seeded log history, not a vibe check.

### 4.5 The edit loop is part of the feature

An advanced user overrides the generator constantly — not because it's wrong, but because he has information about today that no parameter captures. Required on the generated-session screen, all inline:

- Swap an exercise (filtered to same pattern + available equipment)
- Add/remove a set
- Change load or reps on any set
- Reorder or delete a block
- **Regenerate with modified params**, preserving anything explicitly edited

A generator you can't edit around gets abandoned in a week. This is why the editor ships in M2 and not later.

---

## 5. Milestones

**M1 — Foundation**
Schema, migrations, single-cookie auth, exercise library with full metadata, manual 1RM seeding for the main lifts.
*Exit:* the exercise table is queryable by pattern + equipment + fatigue cost, and maxes exist for the big lifts.

**M2 — Generator + Editor + Player**
Constraint solver, generated-session screen with inline editing, live logging player, session history.
*Exit:* generate a session from parameters, tweak it, take it to the gym, log every set, review it afterward.

**M3 — Standalone authoring**
Build a session from scratch. Save any session as a reusable template.
*Exit:* a session can be created without the generator.

**M4 — Multi-week programs**
Program → Mesocycle → Week structure, anchor-date scheduling, shift-or-skip handling, calendar view, progression models (linear, double progression, percentage-based).
*Exit:* an 8-week program runs end to end with a missed session handled correctly.

**M5 — Analytics**
Volume by muscle group over time, e1RM trends, adherence, PR detection.

**v2 backlog:** auto-regulation from logged RPE, downstream recalculation on hand-edit, distance/pace modalities, coach mode.

---

## 6. Stack

**Unconfirmed — pending repo access.** Working assumption, to be replaced by whatever is already there:

- **Postgres** — the recursive tree, arrays, and JSONB all want a relational store. Not negotiable in the way the rest of this is.
- **Next.js + TypeScript**, server components for read paths, server actions for mutations
- **Drizzle** for schema-as-code and typed queries
- **Tailwind + shadcn/ui**
- **Deployment:** single container or Vercel + hosted Postgres. One user, so scaling is not a design input.

The gym-floor logging UI is the only performance-sensitive surface: it must work on a phone browser, tolerate bad signal, and never lose a logged set to a failed request. That means optimistic local writes with reconciliation, regardless of the rest of the stack.

---

## 7. Resolved Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Coach-athlete or solo | **Solo, single-user.** `owner_id` retained as insurance |
| 2 | Who authors content | **The generator does.** Manual authoring is the escape hatch |
| 3 | Platform | **Web only**, mobile-browser-first for logging |
| 4 | Modalities | Schema open to all; **v1 implements weight_reps, reps_only, time** |
| 5 | Missed session | **Prompt: shift or skip.** Requires computed dates |
| 6 | Hand-edit week 5 | **Freeze 6–8.** Recalculation is v2 |
| 7 | Auto-regulation | **v2.** ~3× the cost of all other progression models combined |
| 8 | Opinionated coaching | **No.** No nags, no warnings, no unsolicited judgment |
| 9 | Week-one hook | **Challenging but plausible generated workouts.** Everything is ordered around this |

---

## 8. Risks

**Exercise metadata is the whole ballgame.** ~200 movements need accurate, internally consistent values for pattern, equipment, fatigue cost, and technical demand. No amount of engineering compensates for bad data here, and it's on M1's critical path. **This task belongs to Carey** — it needs training judgment, not code.

**No second opinion.** An app built to one person's judgment encodes that judgment, including its blind spots. There's no other user to notice when a rule is wrong. Mitigation: the §4.4 invariants are tests, so at least the failures are loud.

**Time estimation drives the whole constraint.** If duration estimates are off by 30%, "fits in 45 minutes" is a lie and the core promise breaks. Needs calibration against real logged session durations, starting in M2.

**Scope creep via modalities.** "Eventually everything" is correct as a direction and fatal as a v1 requirement. Each modality multiplies the generator's constraint space and needs its own logging UI. Hold the line until strength generation is genuinely good.

---

## 9. Blocking

**Repo access.** §6 is a guess until I see what's there. Send the URL or the file tree and I'll conform to the existing stack rather than impose one, then start on schema and migrations.
