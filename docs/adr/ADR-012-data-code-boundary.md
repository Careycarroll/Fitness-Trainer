# ADR-012 — The data/code boundary: what becomes a definition file and what stays in the engine

**Status:** ACCEPTED
**Date:** 2026-08-09
**Supersedes:** nothing
**Refines:** ADR-003 (Content as data), ADR-010 (Workout styles become data, not code)
**Related:** ADR-002 (deterministic rules engine), ADR-004 (storage & export)

---

## Question raised

> "Wouldn't everything make sense to be data instead of code, for flexibility?"

ADR-003 established content-as-data and ADR-010 extended it to training styles. The natural
next step is to ask why the boundary stops there. This ADR draws the line explicitly so it
does not have to be re-litigated per feature.

---

## Decision

Content-as-data applies to **parameters and content**. It does **not** apply to **control
flow, safety logic, or validation**.

A thing becomes a definition file only if it passes all three tests in §"Promotion test"
below. Everything else stays in the engine as ordinary JavaScript.

---

## Context

### The failure mode being avoided

Pushing control flow into data does not remove the logic — it relocates it into a bespoke
configuration language that the engine must then interpret. The result is a programming
language with:

- no type checker
- no debugger or breakpoints
- no stack traces
- no unit test framework
- no editor tooling
- a hand-written interpreter that itself needs testing

This is the **inner-platform effect**. The logic still exists and is still as complex; it is
merely expressed in a worse language, and the validator's job silently expands from
"is this data well-formed?" to "are this interpreter's semantics correct?"

### Worked example from this project

| Difference | Nature | Where it belongs |
|---|---|---|
| Powerlifting `3x5 @ 85%` vs. bodybuilding `4x10 @ 70%` | Same shape, different numbers | `styles.json` — data (ADR-010) |
| Set/rep prescription vs. "AMRAP, 12-min cap, scored by rounds" | Different shape | Two generators — code (ADR-010) |

The first is a parameter of a generator that already exists. The second requires conditionals,
loops and a different scoring domain — expressing it as data means inventing JSON that encodes
branching, then writing an interpreter for that JSON.

### The asymmetric cost of data

Code is cheap to refactor: nothing outside the module depends on its internals.

Shipped data is permanent. Once JSON export/import lands (M6, ADR-004), every field invented
lives in files on the user's device and requires a migration path when it changes. Each field
promoted to data carries a recurring cost:

1. a schema commitment in `SPEC.md`
2. a validator rule in CI
3. a migration story for every future change
4. an export-format version bump

"Everything is data" therefore makes the system *less* flexible than it appears, because the
data surface is the part that cannot be freely changed.

### Safety logic must fail closed

Skill gates for Olympic lifts, kipping prerequisites, and deload triggers are safety controls.

- A typo in `styles.json` that drops a `skillGate` key **silently disables the gate**. Data
  fails open.
- A typo in the equivalent code path **fails a unit test at commit time**. Code fails closed.

Safety logic is therefore code, without exception.

### Validators cannot be data

A validator expressed as data would be interpreted by the same engine whose output it
validates. That is circular: a defect in the engine can mask the defect the validator exists
to catch. Validators are code, and are tested independently of the generators.

---

## Promotion test

A candidate becomes a definition file only if **all three** hold:

1. **Values only.** It varies only in values the engine already reads (rep ranges,
   percentages, rest seconds, ratios, weights). It introduces no new branching behaviour.
2. **Statically checkable.** A schema validator can prove a bad instance is bad without
   executing it. If wrongness is only detectable by running the generator and inspecting
   output by eye, it belongs in code where tests can assert on it.
3. **Loud on typo.** A malformed or missing field produces a validation failure, not a silent
   behaviour change.

Fail any one -> it stays in code.

---

## The boundary for this project

### Data (definition files, schema-validated in CI)

- Exercise catalog records
- Style parameters (rep ranges, intensity bands, accessory ratios, work/rest bands)
- Volume landmarks per muscle group
- Split templates
- Periodization curves
- Progression **coefficients**
- Equipment profiles
- Substitution ranking weights

### Code (engine, unit-tested)

- The two domain generators (load-domain, interval-domain)
- Progression **algorithms**
- Safety gates and skill gates
- All validators
- Storage layer and schema migrations
- All UI

**Rule of thumb:** a new training style that needs new *numbers* is a JSON file, shipped in an
hour. A new style that needs a new *shape* is a new generator — roughly 200 lines, written
once. The second is a deliberately cheap escape hatch, and it is cheaper than the
configuration language that would otherwise be built to avoid writing it.

---

## Warning signs (review trigger)

If any of the following appear in a definition file, the boundary has been crossed and the
change must be reviewed against this ADR before merge:

- Keys named `if`, `when`, `then`, `else`, `unless`
- Conditions stored as strings (`"reps > 8 && rir < 2"`)
- Formula strings intended to be `eval`'d or parsed into expressions
- Arrays of operation objects (`[{op: "multiply", ...}, {op: "clamp", ...}]`)
- Array ordering that is semantically meaningful rather than cosmetic
- Any field whose value names a function

These are enforced mechanically by `scripts/checks/no-logic-in-data.js`.

---

## Consequences

**Positive**

- The definition-file schema stays small enough to validate exhaustively in CI.
- Generators remain unit-testable with ordinary tooling.
- Safety behaviour cannot be disabled by a data edit.
- Export format stays stable, because the data surface stays narrow.

**Negative / accepted**

- Some categories of new training style require a code change rather than a data edit. This is
  accepted: the cost is ~200 lines, once, and it is bounded and testable.
- The boundary requires judgement per feature rather than a blanket rule. The three-part
  promotion test and the warning-sign list exist to make that judgement mechanical.

**Review condition**

Revisit if a third scoring domain appears beyond load and time (e.g. distance/pace as a
first-class domain). Three generators sharing structure may justify extracting a shared
skeleton — but that would be a code refactor, not a move to data.
