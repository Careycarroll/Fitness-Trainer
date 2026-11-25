# ADR-034 — Joint-load tags may filter exercise selection when athlete constraints are present

**Status:** ACCEPTED
**Date:** 2026-11-25
**Supersedes:** nothing
**Refines:** ADR-020 (`joint_load` is descriptive), ADR-012 (fail-closed safety)
**Related:** #48

---

## Decision

`joint_load` on catalog exercises remains descriptive (ADR-020), and the engine
may now consume it as an explicit filter when `request.athlete.avoidJoints` is
supplied:

- Valid joint tokens match the catalog's `joint_load` vocabulary:
  `ankle`, `elbow`, `hip`, `knee`, `lower_back`, `neck`, `shoulder`, `wrist`.
- **Fail closed (ADR-012):** an unrecognised joint token in `avoidJoints` throws
  `RequestError` / `UnknownJointError` rather than permitting exercises.
- Excluded exercises are reported in `session.blockedByGates` with their reason,
  and `rankSubstitutes()` applies the same joint filter when suggesting swaps.
- **Not medical guidance:** UI controls and notices explicitly state that joint
  exclusions filter catalog tags only and are not medical advice.

## Consequences

- Athletes can exclude joints (e.g. `shoulder`, `lower_back`, `knee`) in
  Settings -> Defaults, persisted locally and honoured by Planner, WOD, and Swaps.
- When `avoidJoints` is empty or omitted, selection is unchanged (ADR-002).
