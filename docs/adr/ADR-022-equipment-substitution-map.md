# ADR-022 — Equipment substitution map instead of duplicate implement rows

**Status:** ACCEPTED
**Date:** 2026-08-10
**Supersedes:** nothing
**Refines:** ADR-021
**Related:** —

---

## Decision

Equipment matching is not exact-string. An owned token can satisfy a requirement it is a
legitimate stand-in for:

```python
SATISFIES = {
    "kettlebell":    {"dumbbell"},
    "dumbbell":      {"kettlebell", "plate"},
    "barbell":       {"ez_bar"},
    "ez_bar":        {"barbell"},
    "trap_bar":      set(),
    "plate":         set(),
    "bench":         {"box"},        # a bench works as a step
    "box":           set(),          # a box is not a bench
    "smith_machine": {"rack"},
    "dip_bar":       {"parallettes"},
    "parallettes":   set(),
    "rings":         {"suspension_trainer"},
}

NO_SUBSTITUTE_FAMILIES = {
    "fly":           {"kettlebell"},
    "wrist_curl":    {"kettlebell"},
    "preacher_curl": {"kettlebell"},
    "lateral_raise": {"kettlebell"},
}
```

Kettlebells get their own rows **only where the implement changes the movement** — seven
rows: KB clean, KB snatch, KB high pull, Turkish get-up, front rack carry, overhead
carry, and the existing KB swing.

---

## Context

The library had exactly one kettlebell row across 236. The naive fix — author 25 KB
duplicates — is wrong: a KB goblet squat and a DB goblet squat are the same exercise. Same
pattern, same muscles, same fatigue, same rep range. Authoring both gives the engine two
identical candidates and doubles the review burden for nothing.

The actual defect was that `equipment` matching had no notion of interchangeability. A
kettlebell-only profile resolved to **1 usable exercise**. With the map it resolves to
roughly **45**.

**The asymmetry is where the value is, and it is deliberate.** A bench serves as a box; a
box has no back support and no stability, so it does not serve as a bench. A Smith machine
covers a rack for a bench press but not for a rack pull.

Four family-level exceptions, not forty rows of duplication. That ratio is the argument.

### Rejected alternatives

**Explicit kettlebell rows for every dumbbell movement.** ~40 rows, all near-duplicates,
each needing independent calibration and review.

**Symmetric substitution.** Simpler to write and wrong in both directions — it would let
the engine prescribe a barbell bench press to someone who owns only a Smith machine's
worth of rack.

---

## Consequences

**Positive**

- A kettlebell-only setup resolves from 1 usable exercise to roughly 45.
- Four family-level exceptions instead of forty duplicate rows. That ratio is
  the argument for the approach.
- Asymmetry carries real information: a bench serves as a box, a box has no
  back support and does not serve as a bench.
- No duplicate rows means no duplicate ratings to keep in sync, and no two
  identical candidates for the solver to choose between.

**Negative / accepted**

- Substitution is a validator/engine concern, not a data concern. Adding a new
- `smith_machine` satisfying `rack` is slightly generous — true for pressing and squatting
- `NO_SUBSTITUTE_FAMILIES` is keyed by family, so a new row in an excepted family inherits

**Review condition**

Revisit if a generated session ever prescribes a substitution that is
materially worse than the original — the current known-loose entry is
`smith_machine` satisfying `rack`, which is true for pressing and squatting
setups and false for rack pulls and pin work.
