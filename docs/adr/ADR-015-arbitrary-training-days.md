# ADR-015 — Arbitrary training days: sequence is the plan, dates are a view

**Status:** ACCEPTED
**Date:** 2026-08-09
**Supersedes:** nothing
**Refines:** ADR-013 (full-body split), ADR-014 (conditioning as whole sessions)
**Related:** ADR-002 (deterministic rules engine), ADR-004 (storage & export), ADR-011 (persistence gate), ADR-012 (data/code boundary)

---

## Question raised

> "Is it possible to select days? For example switch to Tuesday Friday Saturday, or any
> other pattern?"

The M0 scaffold assumed evenly spaced days (`full-body-3day` implying Mon/Wed/Fri). The
question is whether arbitrary weekday selection is supported, and what it costs.

---

## Decision

**1. Any weekday combination is selectable**, including uneven patterns
(Tue/Fri/Sat, Sat/Sun, four consecutive days).

**2. A generated plan is stored as an ordered sequence of sessions, not as dated calendar
entries.** Session *n* is "the nth session of the block." Weekday assignment is a
presentation-layer mapping applied on read.

**3. Uneven spacing is absorbed by a recovery-aware volume adjustment**, not by new
generator machinery. Sessions following a short gap receive reduced accessory volume at
unchanged intensity.

---

## Context

### Why sequence, not dates

The obvious implementation stamps each generated session with a calendar date. It is wrong
for a single-user training app, for three reasons:

**Missed sessions create permanent holes.** If Friday is dated and Friday is skipped, that
session is orphaned. Every subsequent week either drifts or requires a regeneration that
discards logged progress.

**Schedule changes invalidate the block.** Moving from Tue/Fri/Sat to Mon/Wed/Fri in week 4
would require rewriting every remaining dated record.

**Dates are not an input to any programming rule.** Progression reads *logged performance
on the previous instance of this movement* (ADR-002). It does not read the calendar. Storing
dates would introduce a field the engine never consumes but the export schema must carry
forever (ADR-012's asymmetric-cost argument).

Under the sequence model, a skipped session is not a hole — it is simply not yet performed.
The next session you do is the next session in the block. This is the behaviour the athlete
already expects.

**A `performedAt` timestamp is still recorded on the *log*, not on the *plan*.** The plan is
prescriptive and undated; the log is historical and dated. Conflating them is the defect
being avoided here.

### Weekday selection is a preference, not plan state

| | Plan | Schedule preference |
|---|---|---|
| Shape | Ordered array of sessions | `["tue","fri","sat"]` |
| Changes | On regeneration only | Freely, any time |
| Consumed by | Generator, progression | UI only |
| Storage | IndexedDB (M6) | `localStorage` (ADR-014 exception) |

Changing training days mid-block is therefore a preference edit with no effect on generated
content. This falls under the same narrow `localStorage` exception granted to equipment
profiles in ADR-014 — small, flat, non-critical, migrating to IndexedDB at M6. No other user
state gets this exception.

### What spacing actually changes

The naive assumption is that day selection is purely cosmetic. It is not, and the reason is
specific to ADR-013's full-body split: **every session trains every pattern.** Consecutive
training days therefore mean consecutive lower-body sessions, which is precisely the case
where a body-part split would have been self-protecting.

Gap classes:

| Gap since previous session | Class | Adjustment |
|---|---|---|
| ≥ 2 days | `recovered` | None — baseline prescription |
| 1 day | `compressed` | Accessory volume ×0.75; intensity unchanged |
| 0 days (twice in one day) | rejected | Not a supported input |

**Intensity is deliberately not reduced.** Cutting load on a compressed day would corrupt the
progression signal — the next session's load recommendation reads the previous session's
performance, and a deliberately light day would read as a stall (ADR-002). Volume is the
correct dial: it lowers fatigue cost without misreporting capability.

The multiplier is a **coefficient in `progression.json`**, not a branch in the generator.
It passes the ADR-012 promotion test: it is a value the engine already reads, statically
checkable, and loud on typo. The *decision* of which gap class applies is code.

### Why not warn on "bad" schedules

Considered and rejected: blocking or warning on patterns like Sat/Sun/Mon.

A warning the athlete cannot act on is noise. The athlete's schedule is a fact about their
life, not a preference the app should litigate — training days are constrained by work,
family and travel, and an app that argues with that gets closed. The volume adjustment
already handles the physiological consequence. Recording the reasoning here so this is not
proposed again as a "safety" feature; it is not one, and it does not belong alongside the
genuine safety gates of ADR-012.

### Interaction with conditioning (ADR-014)

Per-day style assignment already exists in `splits.json`. Arbitrary weekdays compose with it
directly:

```
tue → general-strength
fri → general-strength
sat → hiit
```

The `compressed` adjustment applies **within a domain, not across domains**. A conditioning
day following a lifting day is not compressed, because the two do not compete for the same
recovery resource in a way this engine models. Modelling cross-domain fatigue interaction is
out of scope and filed to Backlog; claiming to model it with a single multiplier would be
false precision.

---

## Consequences

**Positive**

- Any schedule is supported, including irregular and weekend-loaded patterns.
- A missed session cannot corrupt a block — it is simply the next one performed.
- Training days can change mid-block with no regeneration and no loss of progression history.
- Export format carries no calendar data on the plan side, keeping the schema narrow (ADR-012).
- Back-to-back full-body days are handled honestly rather than ignored.

**Negative / accepted**

- No calendar view in MVP. Sessions display as "Session 4 of 24 — Friday," not as a month
  grid. Accepted; a calendar is a view over the sequence and can be added later without a
  schema change.
- No reminders or notifications. Out of scope, and they would require the dated model this
  ADR rejects.
- The `compressed` multiplier is a single blunt coefficient, not a recovery model. Accepted
  as deliberately crude — it is tunable in data once real logs exist.

**Review condition**

Revisit if logged data shows compressed-day sessions failing to complete prescribed volume,
which would indicate the 0.75 coefficient is wrong. Revisit the sequence model only if a
calendar view is promoted from Backlog into scope — and note that even then, dates belong in
the view, not the plan.

---

## Implementation notes

**M3**

- `splits.json`: `full-body-3day` gains `sessionsPerWeek: 3` and drops any implied weekday.
  Day names must not appear in shipped plan data.
- Schedule preference shape: `{ days: ["tue","fri","sat"] }`, validated as 1–7 unique
  lowercase weekday tokens, count matching the split's `sessionsPerWeek`.
- New pure function `gapClass(days, index) → "recovered" | "compressed"`, computed from the
  weekday list with wraparound across the week boundary. Code, not data.
- `progression.json` gains `compressedAccessoryMultiplier: 0.75`.
- Generator applies the multiplier to accessory volume only. Primary lifts are untouched.

**Tests**

- Tue/Fri/Sat marks Saturday `compressed`, Tuesday and Friday `recovered`.
- Sat/Sun wraps correctly: Saturday `recovered` (5-day gap from Sunday), Sunday `compressed`.
- Mon/Wed/Fri marks all three `recovered`.
- A compressed session's accessory volume is strictly less than the same session generated
  as recovered, and its primary-lift intensity is **identical**.
- Changing the weekday preference does not alter generated session content.
- Seven consecutive days: every session after the first is `compressed`, and none is rejected.

**Validator (check 12)**

Shipped split templates must not contain weekday tokens. This encodes the sequence/display
boundary as a build failure rather than a convention.
