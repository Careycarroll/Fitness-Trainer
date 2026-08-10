# ADR-013 — Equipment profiles and the first validated style

**Status:** ACCEPTED
**Date:** 2026-08-09
**Supersedes:** nothing
**Refines:** ADR-006 (hand-authored catalog), ADR-008 (catalog before logger), ADR-010 (styles as data)
**Related:** ADR-007 (quality gates), ADR-012 (data/code boundary)

---

## Questions raised

1. Which equipment profiles are real, given that M4 completeness is defined as
   *two options per (pattern x loadType x equipment-profile)*?
2. Which training style does M3 validate first?

Both were left open through M0-M1. They are now blocking: M3 writes generator
configuration and M4 authors ~200 records against whatever is chosen here.

---

## Decision

**Equipment:** two profiles ship. `home-garage` is the **default and the authoring
baseline**. `commercial-gym` is **additive**, used on travel days. The `minimal`
profile is removed from `equipment.json` and filed to Backlog.

**Split:** full body.

**Style:** `general-strength` — moderate rep ranges, moderate intensity — is the first
style validated end-to-end in M3. Powerlifting and bodybuilding are derived from it as
`styles.json` edits (ADR-010), not as new generators.

---

## Context

### Equipment

PM trains in a home garage with a squat rack, and periodically at a full commercial gym
while travelling. No bodyweight-only training context was identified.

Three profiles were scaffolded in M0. Each real profile is a direct multiplier on M4
authoring effort, because completeness requires two options in every
(pattern x loadType x profile) cell. Dropping `minimal` removes roughly a third of the
M4 authoring surface at no cost to any stated use case.

**Authoring rule that follows from this:** every catalog record must either be
performable in `home-garage`, or resolve to a `home-garage` substitute via the
substitution engine. There is no session the app can generate that the athlete's default
environment cannot run. `commercial-gym` therefore only ever *widens* the option set; it
never gates a session.

This is deliberately asymmetric. Authoring gym-first and substituting downward produces
sessions that silently fail in the garage. Authoring garage-first cannot.

### Split vs. style

PM's answer to "which style first" was "full body". These are orthogonal axes and the
distinction is recorded here because it will recur:

| Axis | Question it answers | Where it lives |
|---|---|---|
| **Split** | Which patterns are trained on a given day | `splits.json` |
| **Style** | Sets, reps, intensity, rest, accessory ratio | `styles.json` |

Full body is a split. It is compatible with any style. Selecting it does not answer the
style question, so a style was chosen by default and is flagged as such below.

### Why full body is correct here regardless

- Suits 3 days/week, which suits a home garage.
- Every session touches most movement patterns, so it exercises pattern balance,
  fatigue budgeting and substitution harder than a body-part split would.
- It fails loudly if the catalog has a coverage hole, because a missing pattern shows up
  every session rather than once a week.

### Why `general-strength` is the right first style

Powerlifting stresses %1RM math and intensity bands. Bodybuilding stresses volume
landmarks and accessory ratios. `general-strength` sits between them and exercises both
paths at moderate values, so defects surface in M3 rather than in M5.

Both other Tier 1 styles are then parameter edits off a proven generator — which is the
claim ADR-010 makes, and this is the cheapest opportunity to test it.

---

## Assumption flagged for PM review

`general-strength` was **not** explicitly chosen by PM; it was defaulted because the
answer given ("full body") addressed the split axis instead. If training intent skews
heavy/low-rep or size-focused, this is a one-line change in `styles.json` and should be
made before M4 authoring begins.

---

## Consequences

**Positive**

- M4 authoring surface reduced by ~1/3 (two profiles, not three).
- No generated session can be undoable in the athlete's default environment.
- M3 validates the generator at values that are representative rather than extreme.
- ADR-010's "second style is a data edit" claim gets tested immediately.

**Negative / accepted**

- Bodyweight-only / hotel training is unsupported until `minimal` is restored from
  Backlog. Accepted: not a stated use case.
- `general-strength` is a defaulted decision, not a specified one. Mitigated by the
  review flag above and by the fact that it is a data edit to change.

**Review condition**

Revisit if a third training environment becomes real, or if PM's training intent is
stated explicitly and conflicts with `general-strength`.

---

## Implementation notes (M3)

- Remove the `minimal` profile from `js/data/equipment.json`.
- Validator check 06 (equipment tokens resolve) will fail if any catalog record
  references only `minimal` — this is the intended tripwire, not a bug.
- Add a new validator: every exercise must be performable in `home-garage` **or** have at
  least one `home-garage` substitute. This encodes the asymmetry above as a build
  failure rather than an authoring convention.
- `splits.json` gains a validated `full-body-3day` template.
- `styles.json` gains `general-strength` routed to the load domain.
