# ADR-030 — Duration and intensity remain the whole conditioning prescription

**Status:** PROPOSED
**Date:** 2026-08-19
**Supersedes:** nothing
**Refines:** ADR-028, ADR-009
**Related:** ADR-006, ADR-012, ADR-014, ADR-029, #30, #34

---

## Decision

> A conditioning prescription is **duration and intensity**. No distance, pace,
> speed, incline, resistance level, cadence, stroke rate, or pool length is
> authored in the catalog, stored on a prescription, or read by a generator.

The app plans *how long* and *how hard*. It does not plan *how far* or *how fast*.
Anything measured in distance or pace is the athlete's business during the
session, not the planner's before it.

---

## Context

Issue #30 asked whether planning quality justifies expanding beyond duration and
effort for cardio modalities. The question was inherited from #34 and predates
both the conditioning catalog and the interval generator, so it was answered
against a system that could not yet be observed. It can be now.

### What the shipped system actually produces

All three time-domain styles generate on shipped profiles at seed 20260813,
`commercial-gym`, three days per week:

- `hiit` — a six-station circuit, eight rounds, 40s work / 20s rest
- `cardio` — Stair Climber, 600s, two rounds
- `crossfit` — a 720s AMRAP

Every prescription above is fully expressed by a movement, a duration, and the
style's work-to-rest ratio. None of them is degraded by the absence of a
distance or pace field, and none of them would be improved by one. The
representation was tested against the use cases and holds.

### What the catalog already encodes

All fourteen rows in `13_conditioning.csv` carry a time range and nothing else
dimensional — `Walking` spans 60–3600s, `Battle Ropes` 15–120s. The row states
what duration is sensible for that modality; the style states how long and how
hard to go within it. Distance and pace appear nowhere, so this ADR ratifies the
existing shape rather than changing it.

### Why not add the fields anyway

Distance and pace are not one column. A distance-and-pace prescription needs
per-modality units, a unit system, modality-specific validators, an authored
value on every conditioning row, and a rule for what happens when an athlete has
no way to measure the metric. It would also reopen the domain question ADR-009
settled: pace is a third scoring domain wearing a costume, and a third domain
needs a third generator.

The cost is a milestone. The benefit accrues to structured endurance
training — interval work prescribed by pace, long runs prescribed by distance —
which is a running coach's job and outside what this app is for.

### FitNotes representability

Not assessed in depth, and deliberately so. #30's own acceptance criteria forbid
expanding the schema solely to mirror FitNotes fields, so what FitNotes can
record cannot by itself justify the work. The export mapping in M7 carries
duration and intensity; a field the planner never emits cannot fail to export.

### Options rejected

**Add distance and pace as first-class fields now.** Rejected on cost. Every
conditioning row needs new authored values, the validator suite needs
modality-aware rules, and ADR-012's data/code boundary gets a review it has not
earned. No shipped style would use the result.

**Add distance to monostructural rows only, as an optional column.** Rejected as
worse than either alternative. An optional dimensional field is one the
generator must either ignore — in which case it is decoration — or branch
on, which puts modality-specific control flow into selection for a capability
nothing requests.

---

## Consequences

The conditioning vocabulary is complete as authored. M6's remaining work is
naming alignment (#33), not schema expansion.

The planner cannot express "5k at 8:00/mile" or "row 2000m," and will not
mis-express them either — it prescribes a duration and an effort, and the
athlete runs the distance that produces.

**Revisit when** a shipped style needs pace or distance to express its own
prescription — not when an athlete wants to record one, and not because FitNotes
has a field for it. Realistically that means endurance-event programming, which
is out of scope for M0–M9.

Two conditioning defects observed while testing this decision are **not** in
scope here and are filed separately: an AMRAP whose stations are wildly
disproportionate in length, and misleading omission reporting on `cardio`.
Neither is caused by the time-domain representation, and neither would be fixed
by adding dimensional fields.
