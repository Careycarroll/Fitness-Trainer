# Milestones

Milestones advance on **exit criteria**, never dates (ADR-007). A milestone is not extended to
absorb a new idea — it is closed and the idea goes to Backlog.

---

## M0 — Scaffolding · **done**

Vite PWA shell, GitHub Actions deploy, ADR set, validator harness.

**Exit:** `npm run check` passes in CI; a blank shell installs to an iOS home screen and opens
in airplane mode.

---

## M1 — Schema contract · **done**

`js/engine/SPEC.md` defines exercises, styles, landmarks, splits, equipment, substitution
weights, progression coefficients, and the generation request contract.

**Exit:** every field in SPEC.md has a validator rule.

---

## M2 — Seed catalog · **done**

24 records. Every movement pattern covered twice — the minimum that exercises substitution and
pattern-balance validation.

**Exit:** 10 validators green. Deliberately small: it exists to find schema defects *before* M4
makes them expensive (ADR-008).

---

## M3 — Load-domain generator · **done**

Sets × reps × %1RM. Serves powerlifting, bodybuilding, strength, core.

**Exit:** same request → byte-identical program; no session exceeds its fatigue budget; every
prescription lands inside its style's rep and intensity bands; no gated movement reaches an
unqualified athlete.

---

## M4 — Full catalog authoring · **done**

Hand-author the catalog against the schema M3 has now proven.

**Exit (mechanical, per ADR-008):** every (pattern × loadType × equipment-profile) cell holds
at least two options — roughly 180–220 records — and all validators stay green.

**Closed at 285 records across 12 CSV files.** All 11 validators pass, 24419 checks.
Check 11 (shipped-profile coverage) ran green for the first time — it had been
throwing on a signature mismatch since it was written and reporting 0 checks.
`monostructural` is the sole SKIP, deferred to M7 by `scripts/checks/_deferred.js`.
See ADR-026 for the vocabulary reconciliation this required.

**Not exit:** "all possible exercises." That has no exit condition. Past two options per cell,
more records add variety but zero generator capability. Variety goes to Backlog forever.

---

## M5 — UI shell · **done**

Request form, session render, theme toggle. Rendering only — no planning logic in `js/ui/`.

**Exit:** a full session is legible one-handed on a phone at arm's length; every control is a
44px target.

---

## M6 — Logger + IndexedDB + export/import · **one indivisible milestone (ADR-011)**

**Exit:** export → wipe browser storage → import → **identical state**. Nothing starts until
this passes, and no real training is logged before it.

---

## M7 — Interval-domain generator (HIIT, cardio)

Generator exists; M7 is where it earns real use: time-domain progression, density adjustments,
and interval sessions validated against logged history.

**Exit:** an 8-week conditioning block passes volume and recovery checks.

---

## M8 — Progression from history

Estimated 1RM from logged sets, deload triggers firing on real data, week-over-week
autoregulation.

**Exit:** a stalled lift produces a deload without manual intervention, demonstrated on
replayed history.

---

## M9 — CrossFit · last, and first to cut

Needs both generators, the Olympic skill gate, gymnastic progressions with kipping
prerequisites, and a benchmark-WOD table. The most expensive single style by a wide margin.

M0–M8 is a complete, useful app without it.

---

## Backlog (never blocks a gate)

Exercise variety beyond the M4 floor · benchmark WOD table · warm-up generator ·
plate-loading calculator · session notes · distance/pace as a third domain (would trigger
ADR-012 review)
