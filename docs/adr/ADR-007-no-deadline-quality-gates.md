# ADR-007 — No deadline; quality gates replace dates

**Status:** ACCEPTED
**Date:** 2026-08-09

---

## Decision

Milestones advance on **exit criteria**, never on calendar estimates. There is no target ship
date. Progress is reported as gates passed, not percent complete.

---

## Context

Stated PM preference: "however long it takes." Correct for a solo project with no external
commitment — but open-ended timelines do not kill projects through slow work, they kill them
through unbounded scope.

---

## Consequences

**What this licenses**

- Getting the data model right before writing generator code.
- A real validator suite before any UI polish.
- Refactoring the engine outright if the first design proves wrong.

**What this explicitly does not license**

- Scope growth. The non-goals list in `PLAN.md` §1 stays fixed as amended. The one-line scope
  test still applies: *if it does not help decide what to do in the gym today, it is out.*
- Extending an in-flight milestone to absorb a new idea. A milestone is **closed** at its exit
  criteria and the idea is filed to Backlog. This is the enforcement mechanism; without it
  this ADR is just permission to drift.

**Review condition**

None. This one is structural.
