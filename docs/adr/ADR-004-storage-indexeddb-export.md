# ADR-004 — Storage: IndexedDB, with JSON export/import

**Status:** ACCEPTED
**Date:** 2026-08-09
**Related:** ADR-011 (persistence gate)

---

## Decision

IndexedDB holds training history. `localStorage` holds lightweight UI preferences only
(theme, last-used style). Backup is JSON export/import, shipped in the same milestone as the
logger.

---

## Context

Training logs grow without bound and need structured querying — "last N sessions for this
exercise" is the single hottest query in the progression engine. That exceeds what
`localStorage` does well, and `localStorage` is synchronous, which blocks the main thread on a
phone.

---

## Consequences

**Positive**

- Indexed queries by exercise and by date; no full-history deserialisation per lookup.

**Negative / accepted**

- Backup is a manual user action. There is no server to fall back on.
- **Browser storage is evictable.** iOS Safari will clear IndexedDB for sites not added to the
  home screen and not recently used. This is the specific risk ADR-011 gates against.
- Every schema change to stored records needs a migration. Storage migrations are code
  (ADR-012), versioned and tested.

**Review condition**

If the export file ever exceeds a size that is awkward to move around by hand, revisit with
compression or chunked export. Not before.
