# Interchange formats

Versioned contracts this app owns. FitNotes formats are read and written at the
edges by adapters; they are never the internal model (#26).

Three separate things, deliberately not one:

| Format | Direction | Read by |
| --- | --- | --- |
| **Backup JSON** | out and back in | this app only |
| **Normalised set record** | internal store shape | the engine, via `exerciseId` |
| **Generic CSV** | out | spreadsheets, other tools |
| **FitNotes 2 CSV** | out | FitNotes (adapter, #25) |

---

## 1. Backup JSON — `formatVersion: 1`

Shipped in #35. `js/storage/state.js` owns it; `tests/storage.test.js` asserts
the round trip.

```json
{
  "formatVersion": 1,
  "exportedAt": "2026-08-19T12:00:00.000Z",
  "state": { "version": 1, "meta": {}, "plans": [], "importedSets": [], "exerciseMax": [] }
}
```

`exportedAt` sits in the **envelope**, never inside `state`. A timestamp in the
state would make export → import → export differ on every run, and ADR-011's
gate could never be asserted byte-wise.

**Fails loudly, never partially.** A `formatVersion` newer than this build
throws; so does a bad envelope, a missing `state`, a duplicate plan id, or an
unknown `exerciseMax` source. Twelve rejection cases are asserted. Export files
upgrade on import and never downgrade (MIGRATIONS.md rule 2).

---

## 2. Normalised completed-set record

One row per completed set, in `importedSets`. **This is the shape #24 must write
and nothing else may invent.** Today `state.js` validates `importedSets` only as
"an array", so whatever the first importer writes becomes the format by accident.
That is what this section exists to prevent.

```js
{
  id: 'fn:205:2026-08-01:1',   // stable, deterministic — see below
  source: 'fitnotes-import',

  // --- identity -----------------------------------------------------------
  exerciseId: 'barbell-bench-press',   // catalog slug, or NULL if unresolved
  sourceExerciseId: 205,               // FitNotes numeric id — survives renames
  sourceExerciseName: 'Flat Barbell Bench Press',

  // --- when ---------------------------------------------------------------
  date: '2026-08-01',          // LOCAL calendar date. Never a UTC timestamp.
  setIndex: 1,                 // order within that exercise on that date

  // --- what was done. every field nullable ---------------------------------
  weight: 100,
  weightUnit: 'kg',            // 'kg' | 'lb' — as logged, never converted
  reps: 3,
  seconds: null,
  distance: null,
  distanceUnit: null,          // 'km' | 'mi' | 'm'
  rpe: null,
  notes: null
}
```

### `exerciseId` is nullable, and that is the review mechanism

An unmapped FitNotes exercise **imports anyway**. It lands with
`exerciseId: null`, keeps both source identity fields, and appears in the review
queue. #24 requires this: *"unmatched exercises remain reviewable and are not
silently discarded."*

The consequence has to be stated because it is invisible: **ADR-023 computes
e1RM from `exerciseId`, so a null row contributes nothing to progression.** That
is correct — a set that cannot be attributed to a lift must not influence what
the athlete is told to lift — but it means an unresolved backlog quietly starves
the maxes. **The review count must be visible in the UI**, not discoverable.

### Resolutions live in the manifest, not on the rows

ADR-031 ruling 2: each import **replaces** imported history in full. So a
resolution recorded on an imported row is destroyed by the next import.

Resolutions therefore belong in `data/fitnotes/fitnotes-mapping.csv`, which is
authored and durable. Resolve `Shoulder Curl` once and every future import
applies it. This is already how #38's seven judgement calls were handled: the
mapping carries `authorised_by: #38` and the basis for each.

Getting this backwards means losing the review work on every import — the kind of
defect that only shows up on the second import, weeks later.

### `id` is derived, not assigned

`fn:{sourceExerciseId}:{date}:{setIndex}`

Deterministic, so re-importing an unchanged export produces identical ids and the
replacement is a genuine no-op — #24's no-duplicates criterion satisfied by
construction rather than by a dedupe table (ADR-031).

Keyed on the FitNotes **numeric id**, not the name, because FitNotes lets the
athlete rename any row. A name-keyed id would change under a rename and read as
a different set. This is why `fitnotes_id` was added to the manifest.

### Units are stored as logged

No conversion on import. Converting means the number displayed is not the number
recorded, and a rounding drift would propagate into e1RM via ADR-023. Conversion
is a display concern.

### Which fields are populated

Determined by the exercise's tracking type. The manifest records one for all 311
rows.

| `tracking` | Populated | In this export |
| --- | --- | --- |
| `weight_reps` | `weight`, `weightUnit`, `reps` | 69 rows, 636 sets |
| `reps_only` | `reps` | 17 rows, 57 sets |
| `time` | `seconds` | 12 rows, 4 sets |
| `time_load` | `seconds`, `weight`, `weightUnit` | no mapped row |
| `weight_distance` | `weight`, `distance`, `distanceUnit` | no mapped row |

The last two have **no FitNotes definition in this athlete's export** — they are
loaded carries and sled work, which live only in the Trainer catalog today.

**Do not read that as unreachable.** FitNotes' own schema carries distance and
duration columns whatever this table happens to contain, and #24's scope requires
normalising distance and units from the source. If the athlete creates a Sled
Push in FitNotes and logs it, it arrives — unmapped, reviewable, with `distance`
populated. The parse path for these fields is required, not optional.

This does **not** conflict with ADR-030. That decision says the app will not
*prescribe* distance or pace. Recording a distance already covered is history,
not planning.

### `notes` is carried, never parsed

Stored verbatim if present. Nothing reads it. Deriving prescription meaning from
free text is the kind of inference ADR-002 exists to keep out of the engine.

---

## 3. Generic CSV export

Flat, one row per set, for spreadsheets and migration. Same field names as the
record above, in this order:

```csv
id,source,exerciseId,sourceExerciseId,sourceExerciseName,date,setIndex,weight,weightUnit,reps,seconds,distance,distanceUnit,rpe,notes
```

- Empty string for null, not `0` and not `NULL`.
- `date` is `YYYY-MM-DD`, local. No timezone conversion, ever.
- Units are columns, never suffixes on the value. `100,kg` — not `100kg`.
- Unresolved rows are **included**, with `exerciseId` empty. Omitting them would
  make the CSV disagree with the store.
- Ascending by `date`, then `exerciseId`, then `setIndex`. Deterministic output
  for the same reason generation is (ADR-002): a diffable file.

---

## 4. FitNotes identity stays at the boundary

**`fitnotes_id` and FitNotes names never reach the engine.** They live in the
manifest and in `sourceExerciseId` / `sourceExerciseName` on imported rows. The
engine addresses exercises by catalog slug only.

This currently holds by construction: no code path addresses an exercise by a
FitNotes name or number. The word does appear in the app — a status line in
`app.js` and doc comments in `state.js` — but as prose about provenance, never as
an identifier.

That distinction is why the invariant needs a TEST rather than a grep. The test
to write before #24 lands asserts that no `exerciseId` reaching the engine came
from a FitNotes field, not that the string is absent from the source.

---

## Versioning

`EXPORT_FORMAT` (`js/storage/state.js`) governs the backup envelope.
`STATE_VERSION` governs the record shapes above. They move independently, and
both are logged in `docs/MIGRATIONS.md`.

A change to the normalised set record is a **stored-shape change**: it bumps
`STATE_VERSION`, adds a case to `migrate()`, and gets a MIGRATIONS.md entry.
Adding a nullable field is the cheap case. Renaming or removing one is not, and
`importedSets` is replaced on every import anyway — so a migration there may
legitimately choose to discard rather than transform, which is a decision to
record rather than assume.
