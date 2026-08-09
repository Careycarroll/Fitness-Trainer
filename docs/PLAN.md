# Training Planner — Product & Technical Plan

**Status:** v4 — restructured into a repository
**Owner:** Carey Carroll (PM) / Engineering
**Date:** 2026-08-09

**Change since v3 — structural, not editorial.** ADR bodies have been extracted from this
document into `docs/adr/` as one file per decision. `docs/adr/` is now the single source of
truth for decisions; this file no longer restates them and links instead. Restating a decision
in two places guarantees the copies drift, and the copy people read is rarely the copy that
was updated.

---

## 1. Vision

A single-user, offline-first training planner that acts as a personal trainer: you say how many
days you want and what style you want to train, and it generates the sessions — standalone or
as a multi-week periodized block — then adapts from logged performance.

**One-line scope test:** if a feature does not help decide *what to do in the gym today*, it is
out of MVP.

### Non-goals (MVP)

- Nutrition / macro tracking
- Body composition / weight tracking
- Multi-user, auth, sync, sharing
- Exercise demo video hosting (link out instead)
- Wearable / heart-rate integration

### Scope reversal, recorded (v3, unchanged)

v2 listed **cardio & conditioning programming** as a non-goal. PM subsequently specified HIIT,
CrossFit and cardio as target styles, so that non-goal is **withdrawn**. This is a real
expansion, not a clarification — it roughly doubles the domain model, because conditioning is
scored in the time domain and strength in the load domain. ADR-009 and ADR-010 absorb that cost
once, up front, rather than twice.

---

## 2. Decisions

Bodies live in [`docs/adr/`](adr/README.md). ADRs are immutable once accepted; a change means a
new ADR that supersedes, not an edit.

| # | Decision | Status |
|---|---|---|
| 001 | Vite + vanilla JS PWA, phone-first, no desktop lane | ACCEPTED |
| 002 | Deterministic rules engine, not an LLM | ACCEPTED |
| 003 | Content as data | ACCEPTED |
| 004 | IndexedDB with JSON export/import | ACCEPTED |
| 005 | Fork web scaffolding; no shared package at n=3 | ACCEPTED |
| 006 | Hand-authored exercise catalog | ACCEPTED |
| 007 | No deadline; quality gates replace dates | ACCEPTED |
| 008 | Catalog authored before the logger | ACCEPTED |
| 009 | Dual-domain schema from record one | ACCEPTED |
| 010 | Styles are data; scoring domains are code | ACCEPTED |
| 011 | Persistence gate — logger + export ship together | ACCEPTED |
| 012 | The data/code boundary | ACCEPTED |

---

## 3. Architecture

```
Definition files (JSON)  ──►  Engine (pure functions)  ──►  UI (render only)
   schema-validated              two generators:                no planning
   in CI, 10 validators          load-domain, interval-domain    logic, ever
                                 + gates, progression,
                                   substitution — all code
```

**Generation is pure:** `(request, definitions) => program`. No clock reads, no `Math.random`,
no I/O inside the engine. `seed` is a mandatory field on every request. This is what makes
regression testing possible at all (ADR-002).

**The boundary** (ADR-012), in one line: *data holds values, code holds shapes.*

| Data — definition files | Code — engine |
|---|---|
| Exercise records | The two domain generators |
| Style parameters | Progression **algorithms** |
| Volume landmarks | Safety and skill gates |
| Split templates, periodization curves | All validators |
| Progression **coefficients** | Storage layer and migrations |
| Equipment profiles, substitution weights | All UI |

---

## 4. Open questions blocking M4

1. **Equipment profiles.** Three ship today: `commercial-gym`, `home-garage`, `minimal`. Which
   are real? This directly sizes M4 — the completeness rule is *two options per
   (pattern × loadType × equipment-profile)* cell, so a third real profile is not a third more
   authoring, it is a multiplier.
2. **Tier 1 style to target first.** Three load-domain styles are parameterised; which one gets
   validated against real training first decides where M8's progression work lands.
3. **Athlete skill level and strict-rep baselines.** The gates in `js/engine/safety.js` need
   real inputs. Defaults assume skill 2, no coaching, no strict-rep history — which correctly
   blocks every gated movement until told otherwise.

---

## 5. Status

See [`MILESTONES.md`](MILESTONES.md). M0–M3 complete and green; M4 is next and is the long pole.
