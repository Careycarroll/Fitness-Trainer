# ADR-020 — `joint_load` is descriptive, not a safety rating

**Status:** ACCEPTED
**Date:** 2026-08-10
**Supersedes:** nothing
**Refines:** —
**Related:** —

---

## Decision

```
joint_load = knee | lower_back | shoulder | elbow | wrist | hip | neck
```

Pipe-delimited, optional, blank on most rows. It reads as:

> *"This movement places significant demand on this joint, at end range, under load,
> even when performed correctly."*

That is a neutral fact. The engine consumes it in **both** directions:

| Parameter | Effect | Use |
|---|---|---|
| `avoid_joint_load: [knee]` | drops those rows | acute pain, post-op, in-season |
| `prioritize_joint_load: [knee]` | weights those rows up | building joint resilience |
| unset | no effect | default |

Current coverage: `shoulder` 56, `lower_back` 45, `elbow` 22, `knee` 22, `wrist` 16,
`neck` 7, `hip` 7.

---

## Context

The column was first specified as `joint_stress` and framed as a risk flag. That was a
design error, caught in review.

`joint_stress` merged two facts that point in opposite directions:

- *this movement wears the joint out* — a risk claim
- *this movement loads the joint hard at end range* — a description

Sissy squats, ATG split squats, and reverse Nordic curls are the second. Loaded
end-range knee flexion **is** the stimulus — it is precisely why they build knee
resilience. A column that flagged them as hazards would have had the generator strip out
the exact movements the user was asking for.

Renaming to `joint_load` and defining it descriptively means the knee-strength family
becomes a queryable set rather than a list of exercise names to remember.

`joint_load` is also not a substitute for `technical_demand`. Leg extension is trivial to
execute and places high shear on the knee — `technical_demand 1`, `joint_load knee`. That
combination is the entire reason the column exists; neither existing axis captures it.

### Rejected alternatives

**`joint_stress` as a risk flag.** Would have deleted the knee-resilience family from the
candidate pool for the one user who most wants it.

**A numeric 1–5 joint stress score.** Implies a precision that does not exist and invites
summing across joints, which is meaningless.

---

## Consequences

**Positive**

- The knees-over-toes family becomes a query rather than a list of exercise
  names to remember: `prioritize_joint_load: [knee]` returns 22 rows.
- One column serves two opposite uses. `avoid` for acute pain or post-op,
  `prioritize` for building resilience.
- Naming it descriptively prevented a real bug: as `joint_stress` it would have
  stripped out sissy squats, ATG split squats, and reverse Nordics — the exact
  movements the training goal requires.
- It captures an axis neither `fatigue_cost` nor `technical_demand` reaches.
  Leg extension is 1/1 and high knee shear; trap bar deadlift is 4/2 and gentle.

**Negative / accepted**

- `prioritize_joint_load: [knee]` currently returns a coherent training block: reverse
- **`lower_back` appears on 45 rows and is nearly useless as an avoid filter.** Excluding
- No `ankle` token. Calf rows are blank, which looks wrong for a file about the ankle
- The column is optional and blank on most rows. Blank means "nothing notable," not

**Review condition**

Revisit if `avoid_joint_load` is ever used in anger. `lower_back` sits on 45
rows — avoiding it removes the entire posterior chain, which is descriptively
true and practically all-or-nothing. If that filter proves unusable, the column
needs a severity axis, not more tokens.
