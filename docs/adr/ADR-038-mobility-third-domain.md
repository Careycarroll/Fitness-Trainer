# ADR-038 — Mobility as a third domain: yoga, pilates, and flexibility

**Status:** ACCEPTED
**Date:** 2026-11-25
**Supersedes:** nothing
**Refines:** ADR-002 (determinism), ADR-009 (dual-domain schema), ADR-010 (styles as data), ADR-012 (data/code boundary), ADR-027 (block/setGroup nesting)
**Related:** #65

---

## Decision

1. **Third domain (`mobility` alongside `load` and `time`):**
   - `js/engine/index.js` routes `domain: 'mobility'` to `js/engine/mobilityDomain.js`.
   - `BLOCK_TYPES` adds `'flow'`; poses in a flow carry `holdSeconds`, `restSeconds`, and `position`.
2. **Isolation from load fatigue budgeting:**
   - Mobility poses carry `scoring: 'mobility'` and `pattern: 'mobility'`, so `loadDomain` and `intervalDomain` never select them and they never corrupt load-domain `fatigueBudget`.
3. **Session shape:**
   - Mobility sessions emit `{ domain: 'mobility', label, styleId, blocks, omitted: [], fatigueUsed: null, fatigueBudget: null, blockedByGates }`. Consumers check `session.domain === 'mobility'` and never render fatigue totals for mobility.
4. **Feasible pose-to-pose transitions:**
   - Each mobility pose declares a body `position` (`standing`, `hinge`, `plank`, `prone`, `all_fours`, `kneeling`, `seated`, `side_lying`, `supine`).
   - `POSITION_TRANSITIONS` in `js/engine/mobilityDomain.js` defines legal transitions in code (ADR-012), powering both `nextFeasiblePoses()` and fallback flow generation when predefined flows are filtered by joint constraints.
5. **Sources & licences (text and media assessed separately):**
   - Authored yoga, pilates, and flexibility poses/flows in `data/exercises/14_mobility.csv` and `js/data/mobility-flows.json` are owned outright by this repository.
   - `yuhonas/free-exercise-db` (Unlicense) is approved for stretching text/reference only; Gym Visual media (`hasaneyldrm/exercises-dataset`) and mixed-licence wger media remain rejected.

## Consequences

- `yoga`, `pilates`, and `flexibility` appear in the style selector, generate deterministic `flow` sessions with feasible transitions, and expose `nextFeasiblePoses()` for any pose.
