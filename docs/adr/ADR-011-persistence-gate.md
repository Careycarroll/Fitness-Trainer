# ADR-011 — No real training is logged until the persistence gate passes

**Status:** ACCEPTED
**Date:** 2026-08-09
**Related:** ADR-004, ADR-008

---

## Decision

M6 ships the logger, the IndexedDB layer and JSON export/import **in one milestone**. The
milestone's exit criterion is a full round trip:

> export → wipe browser storage → import → **byte-identical state**

No later milestone begins until that passes. The app is not to be used for real training logs
before it does.

---

## Context

ADR-008 defers persistence to M6. That is safe only while nothing is stored. The dangerous
configuration is a logger that works with no backup path — six weeks of logged training is one
Safari storage eviction away from being gone, and ADR-004 notes that eviction is a documented
behaviour, not a hypothetical.

Shipping the logger and export in separate milestones creates exactly that window. So they are
one milestone.

---

## Consequences

**Positive**

- There is no point in the project's history at which unbacked-up training data exists.

**Negative / accepted**

- M6 is larger than the surrounding milestones and cannot be split. This is intentional.

**Review condition**

None. This gate does not move.
