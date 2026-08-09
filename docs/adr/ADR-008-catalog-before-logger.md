# ADR-008 — Exercise catalog is authored before the logger

**Status:** ACCEPTED
**Date:** 2026-08-09
**Related:** ADR-011 (persistence gate), ADR-006

---

## Decision

Full catalog authoring is promoted to **M4**, ahead of the workout logger and the IndexedDB
layer, which move to **M6**. Two milestones remain in front of it and are not negotiable: a
24-record seed catalog (M2) and the load-domain generator (M3).

---

## Context

PM identified catalog authoring as the long pole and asked for it to move earlier. Two reasons
support it, one given and one stronger:

1. *(PM's reason)* It is the slowest task and should start earliest.
2. *(The stronger reason)* The catalog is the **only artefact in this project that is
   expensive to redo.** Generator code is an afternoon. UI is a weekend. Two hundred
   hand-authored records are not recoverable.

**Why the seed catalog and generator stay in front of it.** Authoring 200 records against a
schema that no generator has ever consumed is the worst outcome available here — schema
defects are found *after* the expensive investment, not before. Twenty-four records is enough
to find those defects; two hundred is enough to make fixing them hurt. Sequence is therefore:
prove the schema cheaply, then author expensively.

**Completeness definition.** "All possible exercises" has no exit condition, which is exactly
the drift ADR-007 forbids. M4 is done when **every (pattern × loadType × equipment-profile)
cell holds at least two options** — roughly 180–220 records. Beyond that, additional exercises
add variety but zero generator capability: the engine cannot distinguish an eleventh chest
movement from a tenth. Variety is appended to Backlog indefinitely and never blocks a gate.

---

## Consequences

**Positive**

- The expensive artefact is authored once, against a schema proven by a working generator.
- M4 has a mechanical, checkable exit criterion.

**Negative / accepted**

- **No persistence until M6.** Sessions generated in M3–M5 render and are then lost. This is
  protective rather than harmful — training data that cannot be stored cannot be lost — but it
  means the app is not usable for real logging until M6. Formalised as ADR-011.

**Review condition**

None.
