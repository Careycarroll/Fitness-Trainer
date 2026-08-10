# ADR-025 — The single-joint pattern rule is inconsistent for flies and trunk work

**Status:** PROPOSED
**Date:** 2026-08-10
**Supersedes:** nothing
**Refines:** ADR-019
**Related:** —

---

## Decision

**None yet.** Recorded so it is a decision taken later rather than a discrepancy
rediscovered later.

---

## Context

ADR-019 introduced `isolation` for single-joint work whose pattern carries no programming
meaning. The rule was not applied uniformly, and the exceptions were deliberate at the time
but do not reconcile:

| Movement | Single-joint? | Pattern assigned | Rationale given |
|---|---|---|---|
| Leg extension, curls, raises, pushdowns, shrugs | yes | `isolation` | rule applied |
| Cable fly, dumbbell fly, pec deck | yes | `push_h` | "genuinely a horizontal push; the pattern carries real meaning for session balance" |
| Cable crunch, side bend, other trunk work | yes | `core` | "emptying `core` into `isolation` defeats the purpose of having the pattern" |

So the operative rule is currently *"single-joint = isolation, except flies and except
trunk work"*, which is two exceptions and no principle.

The clean alternatives:

1. **Strict:** single-joint is always `isolation`. Moves flies out of `push_h`, and empties
   most of `core` into `isolation`. Consistent; costs the `core` pattern most of its rows
   and removes flies from push-pattern balance, which arguably understates chest volume.
2. **Trunk exception only:** single-joint is `isolation` except trunk work, which stays
   `core`. Moves flies to `isolation`; one exception, stated.
3. **Status quo:** two exceptions, documented here.

---

## Consequences of leaving it open

- `isolation` currently holds 84 of 285 rows and is excluded from balance checks. Moving
  flies in would take it to ~89 and reduce `push_h` from 33 to ~28.
- Balance checks currently count flies toward horizontal push volume. A session of bench
  press plus three fly variations reads as well-covered horizontal pushing. That is the
  concrete symptom if option 1 or 2 is correct.
- Nothing is blocked. The engine runs correctly under any of the three; they differ in what
  "balanced" means.

---

## Trigger for resolution

Resolve when the engine's pattern-balance rules are actually written (M3-adjacent), because
that is the first point at which the difference produces a visible output change.
