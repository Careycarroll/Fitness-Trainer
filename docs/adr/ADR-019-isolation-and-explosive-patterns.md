# ADR-019 — `isolation` and `explosive` added as movement patterns

**Status:** ACCEPTED
**Date:** 2026-08-10
**Supersedes:** nothing
**Refines:** ADR-025 (open inconsistency)
**Related:** —

---

## Decision

Two patterns added to the vocabulary:

- **`isolation`** — single-joint work whose pattern carries no programming meaning.
  Excluded from the engine's pattern-balance checks.
- **`explosive`** — CNS-cost-first movements. Must be placed in the first block of a
  session or not at all.

Current coverage: `isolation` 84 rows, `explosive` 22.

---

## Context

**`isolation`.** Calves, forearms, and neck belong to none of squat / hinge / push_h /
push_v / pull_h / pull_v / carry / core / locomotion. The original seed filed
`standing-calf-raise` under `core`. That is wrong in a way that matters: the engine
reasons about pattern balance, so every calf raise read as trunk work and made a session
look better balanced than it was.

`isolation` is the honest junk drawer. Naming it as such and excluding it from balance
checks is better than a dishonest assignment that quietly corrupts a real calculation.

**`explosive`.** Snatch and clean & jerk were `hinge`. That means a hinge-focused session
could legally serve a snatch as a third accessory, at RPE 8, after squats. The cost of an
olympic lift is rate-of-force and CNS, not tonnage, and it is not interchangeable with
other hinge volume.

### Rejected alternatives

**Filing single-joint work under the nearest compound pattern.** This is what the
original seed did and it is what broke pattern balance.

**Rating olympic lifts higher on `fatigue_cost` instead of adding a pattern.** Conflates
two independent axes and still permits late-session placement.

---

## Consequences

**Positive**

- Pattern-balance checks stop being corrupted by single-joint work. The
  original seed filed calf raises under `core`, so every calf raise counted as
  trunk volume and made sessions look better balanced than they were.
- `explosive` gives the solver a placement rule it can enforce: first block or
  not at all. Snatch under `hinge` allowed it as a third accessory after squats.
- 84 isolation rows are now excluded from balance arithmetic, which is the
  majority of the library and was previously miscounted.

**Negative / accepted**

- A session of pulldowns and shrugs no longer reads as balanced vertical pulling, because
- `explosive` rows are unavailable to the engine outside block one. If a generated
- 84 of 285 rows are excluded from balance checks — nearly a third of the library. The
- The rule for what counts as `isolation` is not fully consistent. See ADR-025.

**Review condition**

Revisit if `isolation` exceeds ~40% of a single file, which would mean the
junk drawer has become the file's actual content and the pattern is hiding a
real distinction.
