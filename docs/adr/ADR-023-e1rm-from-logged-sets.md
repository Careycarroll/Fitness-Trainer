# ADR-023 — Working maxes are append-only and computed from logged sets

**Status:** ACCEPTED
**Date:** 2026-08-10
**Supersedes:** nothing
**Refines:** ADR-004 (IndexedDB), ADR-011 (persistence gate), ADR-008 (progression from history)
**Related:** —

---

## Decision

Maxes live in an append-only `ExerciseMax` store keyed `(exercise_id)`, **not** as fields
on a user profile.

```
ExerciseMax
  id
  exercise_id        -- slug, e.g. 'back-squat'
  e1rm               -- canonical unit
  source             -- entered | tested | estimated | estimated_low_confidence
  effective_date
  superseded_at      -- nullable; set when a newer row lands
  created_at
```

Current max = latest non-superseded row. Edits append; they never overwrite.

**Estimation from logged sets**, Epley: `e1RM = load × (1 + reps/30)`

| Reps | Source | Behaviour |
|---|---|---|
| 1–3 | `estimated` | updates the working max |
| 4–6 | `estimated_low_confidence` | updates only if no 1–3 estimate exists in the last 8 weeks |
| 7+ | ignored | not stored as a max |

Additional filters: sets logged at RPE ≤ 7 are ignored.

Resolution: highest e1RM in the last **8 weeks**, preferring `tested` > `estimated` >
`entered` at equal value.

Only lifts anchoring percentage prescription get a max. Derived, not hardcoded:
`is_compound = TRUE`, `tracking_type = weight_reps`, `fatigue_cost >= 3`, `equipment`
includes `barbell` or `trap_bar` — about twelve candidates. The other ~273 fall back to
RPE, which is correct: nobody knows their cable fly 1RM.

---

## Context

The initial proposal was `squat_1rm` / `bench_1rm` columns on a profile. That breaks the
moment a max is wanted for front squat or trap bar deadlift, and the engine cannot look up
"the max for this exercise" generically.

The rep cap was raised from ≤10 to ≤3 in review, correctly — Epley is near-exact at 1–3
reps and drifts badly past 8. The cost is rarity: if the generator prescribes 6–10 reps for
hypertrophy blocks, which most of the library's defaults are, five weeks can pass with no
qualifying set while actual strength moves. The two-tier compromise keeps ≤3 authoritative
without going blind during a hypertrophy block.

The 8-week window matters. A PR from fourteen months ago is not a basis for today's
prescription, and without decay the engine drifts into programming loads that can no longer
be hit.

Append-only buys the strength-progress chart for free — the history *is* the chart — and
keeps generated sessions reproducible, since regenerating an old session uses the max that
was current then.

### Rejected alternatives

**Derived maxes** (inferring front squat from back squat at ~0.85). Ratios vary
enormously by individual, and a wrong derived max produces a session that looks precise
and is quietly too heavy. Empty field with RPE fallback is better.

**Overwrite-in-place.** Loses history, breaks reproducibility of generated sessions, and
destroys the progress chart.

**Brzycki over Epley.** Marginally tighter at low reps; they differ by ~1% at 3 reps.
Not worth the divergence from the formula everyone else uses.

---

## Consequences

**Positive**

- Percentage-based prescription works from day one via `entered`, then
  maintains itself from logged sets without any manual upkeep.
- Append-only history is the strength-progress chart, for free.
- `generated_from_params` stays reproducible: regenerating an old session uses
  the max that was current then, not today's.
- The two-tier confidence rule means a hypertrophy block that never goes below
  5 reps still tracks progress rather than going blind for five weeks.
- Precedence flags rather than silently overwrites, so a good AMRAP day cannot
  quietly rewrite the programming basis.

**Negative / accepted**

- The profile page is mostly read-only: current maxes, source, date, plus an override for
- An `entered` seed value is still required on day one, or percentage prescription has
- A good AMRAP day flags rather than silently rewriting the programming basis.
- **Open:** rounding to loadable increments. `82.5% × 315 = 259.9lb` is useless output.

**Review condition**

Revisit if the 8-week window produces prescriptions that are consistently
too heavy or too light after a layoff or a deload block. The window is the
tuning knob, not the formula.
