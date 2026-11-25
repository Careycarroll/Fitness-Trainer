# ADR-035 — Periodization model ownership and scope

**Status:** ACCEPTED
**Date:** 2026-11-25
**Supersedes:** nothing
**Refines:** ADR-002 (determinism), ADR-010 (styles as data), ADR-012 (data/code boundary), ADR-023 (e1RM maxes)
**Related:** #45, #46, #47

---

## Decision

1. **Style owns the model; `progression.json` owns the coefficients; code owns the curve.**
   - `js/data/styles.json` remains authoritative for `repRange`, `intensityBand`, `setsPerMainLift`, and `restSeconds`. Periodization interpolates *within* the style's own band rather than overriding it.
   - `js/data/progression.json` stores model parameters (`linear-load.deloadFraction`, `double-progression`, etc.) as data (ADR-012); `js/engine/loadDomain.js` computes the week-over-week curve in code.
2. **Scope: linear accumulation + planned deload inside a 1–12 week block.**
   - Single-week blocks (`blockWeeks === 1`) keep their existing deterministic behaviour unchanged.
   - Multi-week blocks (`blockWeeks >= 2`) replace week-to-week RNG jitter in prescription intensity/reps with a monotonic linear ramp across accumulation weeks (`week 1 .. N-1`), followed by a planned deload on the final week when `blockWeeks >= 4` (lower band intensity, `-1` working set floored at `2`, `+1` target RIR).
3. **Interaction with ADR-023, #44, and #40:**
   - Anchored lifts (ADR-023) express the ramp as `%1RM` (and aligned RIR); unanchored lifts express it via `RIR` / rep-band position (#47).
   - Weekly volume tracking (#44) reflects the accumulation ramp and the Week N deload drop in sets.
   - Main-lift anchoring (#40) keeps primary movements consistent across weeks so the ramp applies to the same lift rather than rotating it away.

## Rejected alternatives

- **Conjugate / concurrent periodization:** Rejected on complexity and test surface; dynamic/max-effort rotation requires weak-point diagnostics that do not exist yet.
- **Overriding `style.repRange` / `style.intensityBand` per phase:** Rejected; breaks style invariants (`tests/engine.test.js`) and forces 3–5 rep strength lifts into 10–15 rep blocks.
- **8–16 week multi-block macrocycle container:** Deferred; `blockWeeks` (1–12) already covers a mesocycle without adding another persisted container.
