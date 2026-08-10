# ADR-018 — A muscle token must be programmable in isolation from its parent

**Status:** ACCEPTED
**Date:** 2026-08-10
**Supersedes:** nothing
**Refines:** —
**Related:** —

---

## Decision

A muscle token earns a place in the vocabulary **only if you would ever program it while
deliberately excluding its parent.**

Applying the test:

| Candidate | Verdict | Reason |
|---|---|---|
| `front_delts`, `side_delts`, `rear_delts` | **keep** | A lateral raise makes `side_delts` primary with no other head involved. "Rear delts but not front delts" is a real weekly decision. |
| `upper_chest` | **removed** | No exercise makes it primary without also making `chest` primary. |
| triceps heads (`long_head`, `short_head`) | **rejected** | Same failure. Bias is not targeting. |
| biceps heads | **rejected** | Same. |
| `brachialis` | **rejected** | Never programmed while excluding biceps. |
| `tibialis` | **rejected** | Filed under `calves`; would have one row. |

The distinction these were reaching for is real, and it moves to a new optional column:

```
emphasis = flat | incline | decline | overhead
         | stretch_bias | shortened_bias
         | long_head | short_head
         | wide_grip | close_grip
```

`emphasis` does **not** affect muscle targeting or volume accounting.

---

## Context

The question arrived as "chest vs upper_chest, and the same for delts and triceps
heads." Treating them uniformly is wrong — the delts pass the test and the others fail.

The decisive argument is not taxonomic, it is arithmetic. **Overlapping tokens corrupt
volume accounting.** Once the engine tracks weekly sets per muscle to enforce a fatigue
budget, every incline press counts once for `chest` and once for `upper_chest`. Ten sets
of chest work reads as sixteen. The budget inflates, the generator under-prescribes, and
the symptom presents as "the app is being weirdly conservative" rather than as a data
model error.

What `emphasis` actually buys is de-duplication: it is what stops the generator
prescribing flat bench, dumbbell bench, and push-ups in the same session — same pattern,
same primary muscle, near-identical stimulus.

It pays for itself a second time as substitution. Rows sharing
`(movement_pattern, primary_muscles, emphasis)` are interchangeable by definition, so the
swap-exercise list is derived from authored data rather than hand-maintained.

### Rejected alternatives

**Keeping `upper_chest` as an alias for `chest`.** An alias that never changes a
selection decision is a column nobody maintains and everybody trusts.

**Head-level tokens for arms.** Would have doubled arm volume accounting for zero
selection benefit.

---

## Consequences

**Positive**

- Volume accounting stays honest. Overlapping parent/child tokens double-count
  every set — ten sets of chest work reading as sixteen, which inflates the
  fatigue budget and makes the generator quietly under-prescribe.
- The three delt heads survive the test and stay separate, so the generator
  knows overhead pressing does nothing for rear delts.
- The distinction the rejected tokens were reaching for is preserved in
  `emphasis`, which de-duplicates near-identical stimuli without touching
  muscle math.
- `emphasis` pays for itself twice: rows sharing pattern + primary muscles +
  emphasis are substitution candidates by definition.

**Negative / accepted**

- Volume accounting stays honest: one set of incline press is one set of chest.
- `emphasis` is optional and blank on many rows. It must not become a required column or
- A future contributor will re-propose `upper_chest`. This ADR is the answer.
- The validator derives the hierarchy automatically — any token that is a prefixed or

**Review condition**

Revisit if a movement is ever authored where a sub-token is genuinely primary
and its parent is not. That is the test, and nothing in 285 rows has met it.
