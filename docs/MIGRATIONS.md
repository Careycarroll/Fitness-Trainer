# Schema Migrations

Two independent version lines. Do not conflate them.

Three constants, not two, because the store LAYOUT and the record SHAPE move
independently:

- `STATE_VERSION` (`js/storage/state.js`) — the shape of a stored record. A field
  added inside a plan bumps this and gets a migration in `migrate()`.
- `EXPORT_FORMAT` (`js/storage/state.js`) — the export envelope. Kept separate
  because an envelope change need not imply a record change, or the reverse.
- `DB_VERSION` (`js/storage/db.js`) — the object-store layout. A new store or index
  bumps this and adds a case to `upgrade()`.

Conflating the record shape with the store layout is how a migration runs
twice or not at all.

| Line | Governs | Current |
|---|---|---|
| **Definition-file schema** (`SPEC.md`) | Shipped JSON in `js/data/` | 1 |
| **Stored-record schema** (`js/storage/state.js`) | User data in IndexedDB and export files | 1 |

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

### v1 — 2026-08-19 — storage implemented (#35, ADR-031)

`STATE_VERSION` is **1** and no migration is required: this is the first
implementation, so there is no earlier stored shape to migrate from.

Stores, per ADR-031 rather than the retired sketch:

| Store | Holds | Lifecycle |
| --- | --- | --- |
| `meta` | `lastImportAt` | one row |
| `plans` | request + program + edit flag | durable; the app is the only copy |
| `importedSets` | normalised FitNotes history | **replaced in full** per import (ruling 2) |
| `exerciseMax` | e1RM rows | append-only (ADR-023) |

The previous sketch declared `sessions`, `sets` and `programs`. A `sets` store
keyed on `sessionId` is a LOGGER's schema, which ADR-031 ruling 1 excludes.
There is deliberately no store for a raw FitNotes database (ruling 3), and a
test asserts its absence.

**From here, a stored-shape change is a real migration.** The next one bumps
`STATE_VERSION`, adds a case to `migrate()` in `state.js`, and gets an entry
below. Export files are upgraded on import and never downgraded (rule 2), so a
file written by an older build must keep opening in a newer one.

---

## v1 -> v2 — user-authored equipment profiles (#8)

`STATE_VERSION` 1 -> 2, `DB_VERSION` 1 -> 2. `EXPORT_FORMAT` unchanged at 1.

Adds `equipmentProfiles: []` to state and an `equipmentProfiles` object store.

**Migration:** `1: (s) => ({ ...s, version: 2, equipmentProfiles: [] })`. Purely
additive — a v1 state has no profiles, so the empty array is the whole change.
No stored value is reinterpreted and nothing can be lost.

**Why the export format did not move.** The envelope did not change, and
`fromImport()` runs `migrate()` on the state inside it. So a v1 export still
opens here, and a file written here still opens in a build that predates this.
Bumping `EXPORT_FORMAT` would have refused both for no gain.

**Why profiles are stored state and not a preference.** ADR-004 assigns the
*selected* profile to localStorage and that is unchanged. A profile's *contents*
are authored: the athlete built it, the app holds the only copy, and losing it to
a cleared browser store is the failure ADR-011 exists to prevent. That is why #8
was moved out of M5 in the first place.

Shipped profiles stay in `js/data/equipment.json` and are **not** copied into
user state. Copying them would fork the catalog's own data, where a later fix to
a shipped profile could never reach the copy.

`db.js` needed no `upgrade()` case body: the loop creates any store named in
`STORES` that does not exist yet.

---

## v2 -> v3 — day-level notes (#50)

`STATE_VERSION` 2 -> 3, `DB_VERSION` 2 -> 3. `EXPORT_FORMAT` unchanged at 1.

Adds `importedDayNotes: []` and `sessionNotes: []`, plus a store for each.

**Migration:** `2: (s) => ({ ...s, version: 3, importedDayNotes: [], sessionNotes: [] })`.
Additive — imported notes arrive with the next import, authored ones start empty.

**Why two slices and not one.** `importedDayNotes` is FitNotes' data: replaced
wholesale on every import, exactly like `importedSets` (ADR-031 ruling 2).
`sessionNotes` is the app's own output — an instruction written for a session,
durable, and the only copy. Sharing one store would mean every import destroyed
the athlete's own writing. A test asserts an import leaves authored notes intact.

Both are date-keyed `{date, note}` on a `YYYY-MM-DD` date, the same shape set
records are validated against, so a note always joins to a day sets can share.
Nothing parses the text (ADR-002): a note is displayed, never interpreted.
