# ADR-029 — `fatigue_cost` stays one scale; `metabolic_cost` is deferred

**Status:** PROPOSED
**Date:** 2026-08-16
**Supersedes:** nothing
**Refines:** ADR-009, ADR-026
**Related:** ADR-006, ADR-012, ADR-028, #15, #34

---

## Decision

> `fatigue_cost` remains a **single integer scale, 1–5, shared by both scoring
> domains**. No `metabolic_cost` column is authored, stored, or read. A session
> budget sums one currency because a session draws from one generator.

The mixed-currency problem #15 describes is real in principle and unreachable in
code today. It becomes reachable only when one session emits both load and
interval work, which no shipped style does.

---

## Context

`fatigue_cost` is asked to rate a 400m repeat and a heavy single on the same
1–5 scale. Those cost recovery in different currencies, and a budget that sums
them treats them as interchangeable.

**Measured before deciding.** The catalog is 300 rows:

| `scoring` | rows | mean cost | distribution |
|---|---|---|---|
| `load` | 267 | 1.91 | 1:114, 2:85, 3:48, 4:17, 5:3 |
| `both` | 33 | 2.00 | 1:10, 2:13, 3:10 |

Four facts made the deferral the cheaper correct answer:

- **`GENERATORS[style.domain]` selects exactly one generator per program.** All
  eight styles are pure `load` or pure `time`. Crucially `crossfit` is `time`,
  so even M9 routes to the interval domain rather than blending currencies.
- **Every dual-use row sits at cost 1–3.** The scale runs to 5, so the largest
  possible mis-estimate is bounded at two steps, not the full range.
- **14 of the 33 are `monostructural`** — running, rowing, ergs, boxing. Only
  `conditioning-3` declares that pattern, and it is a time-domain split, so
  `loadDomain` cannot place them regardless of `scoring`. The genuine overlap is
  carries, core holds, and `wall-sit`.
- **Time styles already run lower budgets** — 12–18 against 20–22 for load —
  which acts as an implicit per-domain scale factor.

### Options rejected

**Author `metabolic_cost` now.** Hand-calibrating a second integer across 300
rows, plus a build-step change, a validator, and a schema migration, to correct
at most two steps on roughly 19 accessory rows that never lead a session. This
is the speculative field #34's final acceptance criterion forbids: *no new field
in the core schema without a demonstrated need.*

**Split `fatigue_cost` per domain on the dual-use rows only.** Two columns where
one is null for 89% of the catalog. Every consumer then branches on `scoring`
before reading a cost — the same conditional ADR-027 removed from block
consumers.

**Derive it at build time from `timeDomain`.** Plausible, and it would satisfy
ADR-012 by keeping the value in the build step rather than the CSV. Rejected for
now only because it solves a problem nothing has yet exhibited, and derivation
would need calibrating against sessions that do not exist.

---

## Consequences

**Positive**

- No schema change, no migration, no second calibration pass over the catalog.
- One number per row stays readable by a human authoring CSV, which is the whole
  premise of ADR-016.
- The 33 dual-use rows keep a single rating, so a carry cannot be rated
  inconsistently against itself in two files.

**Negative / accepted**

- **A carry or core hold is budgeted identically in both domains.** A Farmer's
  Carry at 3 costs a strength session and a conditioning session the same, and
  those are not the same cost. Accepted because both budgets were calibrated
  with those rows already in the pool.
- **The problem is deferred, not solved.** Anything mixing domains inside one
  session inherits it immediately.
- **`wall-sit` is the clearest mis-rating** — cost 1 as a load accessory,
  plainly more than 1 as a conditioning interval. One row, one step.

**Review condition**

Revisit when **one session emits both load and interval blocks** — a CrossFit
metcon appended to strength work, or any style whose `domain` is not a single
value. That is the concrete event that makes the currencies sum. Until then the
generator boundary keeps them apart.

Revisit sooner if the dual-use set passes **~60 rows** or if any dual-use row is
authored above **cost 3**, either of which would mean the overlap is no longer
the bounded accessory tail measured here.
