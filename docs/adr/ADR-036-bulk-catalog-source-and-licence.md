# ADR-036 — Bulk catalog import source, licence, and column policy

**Status:** ACCEPTED
**Date:** 2026-11-25
**Supersedes:** nothing
**Refines:** ADR-006 (hand-authored catalog), ADR-012 (data/code boundary), ADR-016 (split CSV authoring), ADR-026 (schema reconciliation)
**Related:** #63, #55

---

## Decision

1. **Approved external source & licence:** `free-exercise-db` (`yuhonas/free-exercise-db`), dedicated to the public domain under the **Unlicense**, is the sole approved external source for bulk exercise instructions, images (`public/exercise-images/`), and reference rows.
   - `wger` (mixed per-exercise licences) and unattributed sources without recorded provenance were rejected.
2. **Column & calibration policy:**
   - Imported candidates map to all 19 authored CSV columns in `data/exercises/*.csv` via `tools/build_seed.py`; `fatigue_cost` and `technical_demand` are hand-calibrated rather than silently defaulted.
   - Duplicate names resolve to existing canonical slugs (ADR-017) or are rejected by Check 02.
   - Equipment tokens and `LOAD_TYPE_PRECEDENCE` stay in sync (Check 13); FitNotes mappings stay green (`build_fitnotes_manifest.py --check`, Check 12).
   - Every imported instruction file carries `<!-- source: free-exercise-db -->` for provenance.

## Consequences

- The 533-exercise catalog, 485 instruction files, and exercise thumbnails ship offline with clear public-domain provenance.
