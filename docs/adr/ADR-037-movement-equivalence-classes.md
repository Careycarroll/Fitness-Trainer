# ADR-037 — Movement equivalence classes and implement variations

**Status:** ACCEPTED
**Date:** 2026-11-25
**Supersedes:** nothing
**Refines:** ADR-002 (determinism), ADR-012 (data/code boundary), ADR-023 (e1RM per exerciseId), ADR-026 (exercise_family)
**Related:** #52

---

## Decision

1. **Where equivalence lives:** Derived in code from `(exerciseFamily, pattern)` via `sameEquivalenceClass(a, b)` in `js/engine/substitution.js`. No new catalog column is added. Using the pair `(exerciseFamily, pattern)` avoids conflating `explosive` variants (e.g. `jump-squat`) with `squat` load variants.
2. **e1RM does NOT pool across a class:** `ExerciseMax` (ADR-023) remains keyed on `exerciseId`. Barbell, dumbbell, and machine loads are not comparable at equal weight.
3. **Substitutions are recorded, never silent:** Swapping an exercise writes `swappedFrom: { id, name }` onto the `SetGroup`, and `toFitNotesCSV()` exports the primary unless swapped.
4. **Determinism (ADR-002):** `loadDomain.js` primary selection is unchanged; offering ranked implement variations does not alter which primary exercise is selected.

## Consequences

- `rankSubstitutes()` flags `sameMovement: true` and prioritizes same-`(exerciseFamily, pattern)` implement variations within each `selectable` tier, and `rankImplementVariations()` exposes them directly.
