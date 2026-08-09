# ADR-009 — Schema is dual-domain (load and time) from record one

**Status:** ACCEPTED
**Date:** 2026-08-09
**Related:** ADR-006, ADR-008, ADR-010

---

## Decision

Every exercise record carries both load-domain and interval-domain metadata from the first
record authored. Six additional fields per record: `scoring`, `timeDomain`, `roundsCapable`,
`kipAllowed`, `monostructural`, `skillGate`.

---

## Context

The requested style list — HIIT, CrossFit, cardio alongside powerlifting, bodybuilding,
strength — spans two scoring domains:

| Domain | Scored in | Styles |
|---|---|---|
| Load | sets × reps × %1RM | powerlifting, bodybuilding, strength, core |
| Time | work/rest intervals, rounds, reps-for-time | HIIT, CrossFit, cardio |

Authoring the catalog load-only now and adding conditioning later means revisiting **every
record**. Since ADR-008 places catalog authoring on the critical path, that would invalidate
the single largest investment in the project.

The cost comparison is stark: six extra fields per record now, versus re-authoring ~200
records at M7.

---

## Consequences

**Positive**

- Records are authored once. Conditioning styles need no catalog migration.
- Forces the domain distinction to be explicit in the schema rather than implied by usage.

**Negative / accepted**

- Roughly doubles the domain model. This is a real expansion and is recorded as a scope
  reversal in `PLAN.md` §1 — v2 listed cardio as a non-goal and that non-goal is **withdrawn**,
  not clarified.
- Some fields are `null` for most records (`kipAllowed` is meaningful only for gymnastic
  movements). Accepted: an explicit `null` is cheaper than a schema migration.
- Wearable / heart-rate integration remains a non-goal despite conditioning entering scope.
  Time-domain prescription does not require biometrics.

**Review condition**

A third scoring domain — distance/pace as first-class — would trigger review. See ADR-012
review condition; the answer would be a code refactor, not a data change.
