# ADR-014 — Editable equipment profiles, and conditioning as whole sessions

**Status:** ACCEPTED
**Date:** 2026-08-09
**Supersedes:** nothing
**Refines:** ADR-013 (equipment profiles and first style), ADR-010 (styles as data), ADR-012 (data/code boundary)
**Related:** ADR-004 (storage & export), ADR-011 (persistence gate), ADR-009 (dual-domain schema)

---

## Questions raised

1. Should equipment be two fixed profiles, or a profile the athlete can edit as the home
   gym grows?
2. Is conditioning (HIIT / CrossFit / cardio) a **finisher** appended to a lifting
   session, or a **whole session** of its own?

Both were open after ADR-013. Question 2 was the last item blocking M3.

---

## Decision

**1. Equipment profiles become user-editable data.**
`home-garage` ships as an editable starting point. `commercial-gym` ships as a fixed
"assume everything is available" profile that is never edited. The athlete may create
additional profiles. Shipped profiles and user profiles are stored separately.

**2. Conditioning styles generate entire sessions.**
A generated session is scored in exactly one domain — load **or** time — never both. There
is no hybrid session, and no "finisher" concept in MVP. Conditioning occupies whole
training days.

---

## Context

### Equipment: why editable is the right shape

ADR-013 fixed two profiles to bound M4 authoring effort. That reasoning still holds for
*authoring*, but it wrongly assumed the profile list is also fixed at *runtime*.

A profile is already a list of equipment tokens. Letting the athlete edit that list is a
data change, not a structural one — it requires no new engine behaviour, and it passes the
ADR-012 promotion test (values only, statically checkable, loud on typo).

The stated driver is real: the home gym will accumulate equipment over time. Requiring a
code change to record a new pair of dumbbells would be absurd.

`commercial-gym` remains fixed and non-editable. It means "assume everything." There is no
version of that profile worth editing, and making it editable would invite the athlete to
narrow it and then wonder why travel-day sessions degraded.

### What editability breaks, and the fix

ADR-013 guaranteed that no generated session can be undoable in the athlete's default
environment. That guarantee was enforceable because both profiles were authored and
CI-validated.

An arbitrary user profile cannot be validated at build time. A profile containing only a
jump rope has no valid hinge option, and no amount of catalog authoring fixes that.

**The guarantee is therefore restated:**

> The generator must never emit a session containing a movement the selected profile
> cannot perform. Where a required pattern has no option, it must **fail loudly with a
> named cause**, not silently substitute, drop the pattern, or emit a degraded session.

Required error shape:

```
Cannot generate: no 'hinge' option available in profile "My Garage".
Add one of: barbell, kettlebell, dumbbell, trap-bar.
```

This is a **coverage precondition check**, and per ADR-012 it is code, not data. It runs
before generation, not during rendering.

### Equipment granularity: presence, not quantity

Profiles record *which* equipment exists, not *how much*. `barbell + plates`, not
`2×45, 4×25, 1×10`.

Quantity tracking would let the generator avoid prescribing unloadable weights, which is a
genuine benefit. It is rejected for MVP because it multiplies setup cost, goes stale on
every purchase, and introduces a second failure mode (correct exercise, impossible load)
that is better handled by the athlete rounding to what is on the rack.

Filed to Backlog. Revisit only if unloadable prescriptions are observed in real use.

### Shipped data vs. user data

| | Shipped profiles | User profiles |
|---|---|---|
| Source | `js/data/equipment.json` | User storage |
| Validated | In CI, exhaustively | At edit time, in-app |
| Ownership | Ships with app updates | Belongs to the athlete |
| On app update | Replaced | Never touched |

These must not share a namespace. If an app update can overwrite a hand-built garage
profile, the feature is worse than not having it.

**Interim storage note (ADR-011):** an equipment profile is small, flat, and non-critical —
it is a preference, not training history. It may live in `localStorage` before M6, and
must migrate into IndexedDB alongside everything else at M6. No other user state is
permitted this exception.

### Conditioning: whole sessions, not finishers

PM: *"They will be the entire workout, not the end."*

This is the cheaper answer by a wide margin, and it is worth recording why.

A finisher model means one session contains both a load-domain block and a time-domain
block. That requires:

- a session container holding two scoring domains at once
- a fatigue budget shared and negotiated across both generators
- a UI that renders sets/reps and a running clock in the same view
- logging that captures weight-and-reps *and* rounds-and-time for one session
- export schema carrying both shapes per session

The whole-session model requires none of it. A session is generated by exactly one
generator, scored in exactly one domain, rendered by one view, and logged in one shape.
ADR-009's dual-domain schema already supports this: records carry metadata for both
domains, but any given *session* only ever reads one side.

**Weekly structure is a split concern, not a session concern.** "Lift Mon/Wed/Fri,
condition Tue/Thu" is expressed in `splits.json` as day→style assignment. It needs no
engine support beyond what already exists.

### On HIIT vs. CrossFit

Both are time-domain and share the interval generator; they differ mainly in parameters,
which is exactly the ADR-010 claim.

They diverge in one respect that keeps CrossFit last in sequence: CrossFit embeds
load-domain movements (cleans, snatches, thrusters) and gymnastic skills inside a timed
format, which requires the skill gates from ADR-012 to run *inside* interval generation.
HIIT does not — it deliberately uses low-skill movements precisely because they are
performed fatigued and fast.

That is a difference in required safety machinery, not in session shape. Both remain whole
sessions.

---

## Consequences

**Positive**

- Home gym can grow without a code change or an app update.
- No hybrid-session machinery is built: one generator, one domain, one view, one log shape.
- Weekly mixing of strength and conditioning is free — it is a `splits.json` edit.
- Failure to cover a pattern becomes an explicit, actionable message rather than a silently
  degraded workout.

**Negative / accepted**

- The build-time guarantee from ADR-013 weakens to a runtime precondition check for user
  profiles. Accepted: the check is code, unit-tested, and fails closed.
- A user can construct a profile that generates nothing. Accepted, provided the message
  names the missing pattern and the equipment that would resolve it.
- No "10 minutes of intervals after squats." Accepted for MVP; filed to Backlog. Revisit
  only after both generators are proven independently.

**Review condition**

Revisit the finisher decision only once M7 conditioning is validated end to end. Revisit
plate-quantity tracking only if real logged sessions show unloadable prescriptions.

---

## Implementation notes

**M3 (now unblocked)**

- `commercial-gym` marked `editable: false`; `home-garage` marked `editable: true`.
- New engine module `coverage.js`: given a profile + split + style, return the set of
  required patterns with zero available options. Pure function, no I/O.
- Generator calls the coverage check **before** generating and throws a typed
  `CoverageError` naming pattern and suggested equipment.
- New validator (check 11): every **shipped** profile covers every pattern referenced by
  every shipped split. User profiles are exempt — they are checked at runtime instead.
- Tests: a deliberately impoverished profile must raise `CoverageError`, never emit a
  session with a missing pattern, and never silently substitute across patterns.

**M5 (UI)**

- Equipment setup is a one-time screen, not a per-session step.
- A single prominent profile switcher ("Garage" / "Full gym") for travel days.
- Editing is available but not on the generation path.

**M6 (storage)**

- Migrate user profiles from `localStorage` to IndexedDB.
- Include user profiles in JSON export; on import, never overwrite shipped profiles.
