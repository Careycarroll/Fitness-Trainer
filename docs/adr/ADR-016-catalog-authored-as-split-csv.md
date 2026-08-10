# ADR-016 — The exercise catalog is authored as split CSV; JSON stays the build artifact

**Status:** ACCEPTED
**Date:** 2026-08-10
**Supersedes:** nothing
**Refines:** ADR-003 (content as data), ADR-006 (hand-authored catalog), ADR-012 (data/code boundary)
**Related:** —

---

## Decision

The catalog is authored as twelve CSV files under `data/exercises/NN_*.csv`, one per
muscle group, with an identical header row. A validator concatenates them, enforces
the controlled vocabularies, and emits `js/data/exercises.seed.json` as a generated
artifact.

`exercises.seed.json` is no longer hand-edited. It is regenerated.

```
data/exercises/*.csv  ->  tools/validate_exercise_seed.py  ->  js/data/exercises.seed.json
     (authored)                    (CI gate)                        (generated)
```

---

## Context

ADR-003 and ADR-012 established content-as-data with JSON definition files. That is
correct for the *machine* surface and stays. This ADR concerns only the *authoring*
surface, and JSON is the wrong tool for it.

The dominant activity when building a 285-row catalog is **cross-row comparison, not
per-row authoring**. Rating a new movement's `fatigue_cost` means sorting by that
column and checking the new 3 against every existing 3. That is a spreadsheet
operation. In JSON those values are forty lines apart and calibration drift is
invisible until the generator's fatigue budget has silently stopped meaning anything.

CSV also produces one-line diffs. Changing one rating should be one readable line in
review, not a multi-line hunk.

JSON's real advantages — types, arrays, schema enforcement — are delivered by the
validator instead of by the authoring format. Nothing is lost.

The split into twelve files is for review ergonomics: twenty rows at a time rather
than 285. The cost is that a single sort across the whole library is no longer
possible in the editor, which is mitigated by the validator concatenating before it
checks, so drift is still caught globally — at validation time rather than at
authoring time.

### Rejected alternatives

**Authoring directly in JSON.** Correct machine format, wrong human format. Would have
made calibration drift undetectable across 285 rows.

**One CSV for the whole library.** Retains global sort, but a 285-row file is not
reviewable and merge conflicts on it are unpleasant.

**A spreadsheet as source of truth (Google Sheets, xlsx).** Better authoring UX than
CSV, but not diffable, not reviewable in a PR, and not readable by CI without an
export step that becomes the real source of truth anyway.

---

## Consequences

**Positive**

- Calibration drift is visible while authoring. Sorting 285 rows by
  `fatigue_cost` is a spreadsheet operation; in JSON those values are forty
  lines apart and drift is undetectable until the fatigue budget is meaningless.
- One-line diffs. Changing a single rating is one readable line in review
  rather than a multi-line JSON hunk.
- Types, arrays, and schema enforcement are not lost — they move from the
  authoring format to the validator, which enforces them harder than a JSON
  parser would.
- The generated artifact is reproducible from source. `exercises.seed.json`
  can be deleted at any time and rebuilt byte-identically.

**Negative / accepted**

- `js/data/exercises.seed.json` must be gitignored or clearly marked generated.
- CI must run the validator on every push, or the two surfaces diverge.
- A contributor who edits JSON and not CSV loses their work on the next build.
- Python is now a build dependency for a project that is otherwise pure JS. The

**Review condition**

Revisit if a second contributor joins, or if an exercise ever needs nested
data (per-goal rep schemes, weighted substitution groups, contraindication
rules). Flat metadata belongs in CSV; nested metadata is a second table, not a
format migration.
