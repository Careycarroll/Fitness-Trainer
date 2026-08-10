# ADR-017 — An exercise lives in exactly one file, decided by its first primary muscle

**Status:** ACCEPTED
**Date:** 2026-08-10
**Supersedes:** nothing
**Refines:** ADR-016
**Related:** —

---

## Decision

> An exercise lives in **exactly one file**, determined by the **first token in its
> `primary_muscles` column**.

Romanian deadlift is `hamstrings|glutes`. First token is `hamstrings`, so it lives in
`03_hamstrings.csv` and appears nowhere else, even though it is a genuine glute builder.

The validator enforces this: a duplicate slug across files is an error, and a row whose
first primary muscle does not belong to its file is an error that names the correct file.

`12_fullbody.csv` is the sole exemption. Olympic lifts, carries, jumps, throws, and grip
holds are defined by **pattern**, not by an owning muscle, so its rows are checked
against `{explosive, carry, locomotion}` instead.

---

## Context

Without a mechanical rule, "put it where it fits" means the same movement gets authored
in three files by three different judgment calls, each with its own `fatigue_cost`.

Nothing errors. The seed loader keeps whichever row it read last — alphabetical by
filename, an arbitrary winner — and the generator runs on ratings nobody approved. That
failure is silent and survives review, because each individual row looks reasonable.

First-token ordering was chosen over "most important muscle" because it is already
encoded in data the row must carry anyway, and it is not a judgment call.

### Rejected alternatives

**Author where it fits, dedupe later.** Deduplication requires choosing between
conflicting ratings after the fact, which is harder than not creating them.

**Cross-file references / a shared row pool.** Reintroduces the single-large-file
problem this split exists to solve.

---

## Consequences

**Positive**

- Duplicate authoring becomes impossible rather than merely discouraged. The
  failure it prevents is silent: three files, three `fatigue_cost` values, the
  loader keeping whichever it read last by alphabetical accident.
- File placement is mechanical, not a judgment call. First token of
  `primary_muscles` is data the row already carries.
- Review happens twenty rows at a time instead of 285.
- The validator can name the correct file when a row is misplaced, so the fix
  is unambiguous.

**Negative / accepted**

- **File size does not equal training importance.** `02_glutes.csv` looks thin because
- **Where it costs most:** `07_back.csv` has few erector rows, because every deadlift is
- Volume accounting happens in the engine off `primary_muscles` + `secondary_muscles`,
- Reordering `primary_muscles` on an existing row moves the row to a different file.

**Review condition**

Revisit if a single file passes ~40 rows and the muscle it owns has a real
internal split (07_back at 37 is the current candidate). Split by pattern
within the muscle, never by re-homing rows to a different owner.
