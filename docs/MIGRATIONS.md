# Schema Migrations

Two independent version lines. Do not conflate them.

| Line | Governs | Current |
|---|---|---|
| **Definition-file schema** (`SPEC.md`) | Shipped JSON in `js/data/` | 1 |
| **Stored-record schema** (`js/storage/db.js`) | User data in IndexedDB and export files | 1 (unimplemented, gated to M6) |

## Rules

1. Any change to `SPEC.md` bumps the definition-file schema version and gets an entry below.
2. Any change to a stored record shape bumps `DB_VERSION` **and** the export-format version,
   and ships with a forward migration. There is no backward migration; export files are
   upgraded on import, never downgraded.
3. An exercise `id` is immutable once shipped. Renaming one orphans every logged set that
   references it. To retire a record, mark it inactive — never delete or rename.
4. ADR-012 consequence: every field promoted from code to data joins this file permanently.
   That recurring cost is the reason the promotion test exists.

## Log

### v1 — 2026-08-09 — initial

Exercises (dual-domain per ADR-009), styles, landmarks, splits, equipment, substitution
weights, progression coefficients. No migration required; nothing previously shipped.

### v1 — 2026-08-11 — ADR-027 session shape (NO migration required)

`schemaVersion` stays **1**. Nothing is persisted yet (ADR-011), so there is no
stored data to migrate — which is the entire reason this change was made now
rather than at M9.

What changed in the emitted shape:

- `session.blocks[i]` was one exercise. It is now
  `{ blockType, setGroups[], rounds, timeCapSeconds }`.
- `session.stations[]` is **removed**. A conditioning session emits one
  `circuit`/`amrap` block whose `setGroups` are the stations.

**Consequence for M6:** the IndexedDB schema is written from this shape, not from
the flat one. Anything already sketched against `blocks[i].reps` or `stations[]`
is stale. Read `js/engine/SPEC.md` and `js/engine/blocks.js` for the contract.

**The first real migration will be the first change AFTER M6 lands.** From that
point a shape change is a migration function keyed on `schemaVersion`, per ADR-004.
