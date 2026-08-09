# ADR-010 — Workout styles become data; scoring domains stay code

**Status:** ACCEPTED
**Date:** 2026-08-09
**Refines:** ADR-003
**Refined by:** ADR-012

---

## Decision

A training style is a record in `styles.json` describing **parameters**: rep ranges, intensity
bands, accessory ratios, work/rest bands, rest seconds, pattern emphasis.

A scoring **domain** is a generator in code. There are exactly two: load-domain and
interval-domain.

---

## Context

The distinction that matters is *shape versus numbers*.

| Difference | Nature | Where it belongs |
|---|---|---|
| Powerlifting `3×5 @ 85%` vs. bodybuilding `4×10 @ 70%` | Same shape, different numbers | `styles.json` — data |
| Set/rep prescription vs. "AMRAP, 12-min cap, scored by rounds" | Different shape | Two generators — code |

Powerlifting and bodybuilding are the same algorithm with different constants. HIIT and
powerlifting are not the same algorithm at all — one emits sets with loads, the other emits
intervals with time caps and a rounds-based score.

**The rejected alternative** is a single generator with a mode flag. That is how these engines
rot: the flag multiplies through every function, and each new style adds a branch to code that
already has branches for every previous style.

---

## Consequences

**Positive**

- A new style needing new *numbers* is a JSON file, shipped in an hour.
- A new style needing a new *shape* is a new generator, ~200 lines, written once. Deliberately
  cheap escape hatch.
- Each generator is unit-testable in isolation with no cross-domain fixtures.

**Negative / accepted**

- Two code paths to maintain rather than one.
- Styles must declare their domain, and the request contract must route on it.

**Review condition**

See ADR-012 — a third domain may justify extracting a shared skeleton, as a code refactor.
