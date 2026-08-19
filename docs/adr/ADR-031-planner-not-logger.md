# ADR-031 — Fitness Trainer is a planner; FitNotes is the system of record

**Status:** PROPOSED
**Date:** 2026-08-19
**Supersedes:** nothing
**Refines:** ADR-011, ADR-004, ADR-023
**Related:** ADR-001, ADR-012, ADR-014, #23, #24, #35, #13, #11, #12

---

## Decision

> Fitness Trainer owns what it **prescribes**. FitNotes owns what was
> **performed**. The app persists authored planner state durably, and treats
> imported completed history as a **replaceable projection** of the most recent
> FitNotes export.

Three rulings follow, each checkable against code:

1. **No in-app set logger.** There is no screen on which the athlete records a
   completed set. #13 stays deferred beyond M7 and is not a hidden dependency of
   any M7 issue.
2. **Imported history is replaced, not merged.** Each import supersedes the
   previously imported history in full. The newest export is authoritative.
3. **The raw database is never retained.** It is parsed in-browser, in memory,
   and discarded. No copy is written to IndexedDB, and nothing is transmitted.

---

## Context

#23 asked whether this app becomes a workout logger. Everything already written
answered it; the answer had simply never been recorded.

`js/storage/db.js` is a deliberate stub that throws on `open()`. `js/ui/app.js`
states that nothing is persisted in three separate places. #35 scopes itself
"without prematurely building a full workout logger." #24 says "import only
trustworthy completed data" — the language of a consumer, not an owner. ADR-023
already computes e1RM from logged sets rather than storing profile fields, which
works identically whether those sets came from an import or from in-app entry.

### Two systems of record is the failure being avoided

If both applications accept set entry, they disagree, and nothing resolves the
disagreement. Which one is right about last Tuesday's squat? A merge rule can be
written, but every such rule encodes a guess about intent, and ADR-023 propagates
that guess into future prescriptions rather than leaving it inert — a wrong
answer changes what the athlete is told to lift.

Declining to log removes the question rather than answering it.

### Why replacement, rather than diffing

The first design kept a per-set fingerprint and imported only unseen sets. It
handles duplicates but not corrections: a set edited in FitNotes after import
arrives with a new fingerprint, so it reads as an additional set rather than a
revision, and the old row survives beside it.

Replacement is both simpler and more correct, and it is safe for exactly one
reason: **the app does not own this data.** Discarding every imported row costs
nothing, because FitNotes still holds them. Under replacement, an edit is a new
value, a deletion is an absence, and a re-import of an unchanged export is a
no-op. No diff logic, no fingerprint store, no reconciliation table.

This is only sound while ruling 1 holds. An in-app logger would put athlete-
authored sets in the same store, and replacement would then destroy data with no
other copy.

### The retention line

| Data | Retained | Rationale |
| --- | --- | --- |
| Raw FitNotes `.db` export | **No** | Parsed in memory, discarded. Never written, never transmitted (ADR-001 is offline-only regardless). |
| Normalised completed sets | Yes, as a replaceable projection | ADR-023 needs logged sets to compute e1RM, and #20's deload triggers need recent history. |
| Derived `ExerciseMax` rows | Yes, append-only | ADR-023 already specifies this store and its supersession rule. |
| Authored planner state | Yes, durable | Profile, equipment, schedule, generated plans, substitutions, mapping approvals. The app is the only copy. |

`ExerciseMax` is the one place imported data crosses into something the app owns.
Rows are append-only per ADR-023, so a replacement import does not delete
history — it appends newer estimates and supersedes older ones by the existing
rule.

### ADR-011's milestone reference has drifted

ADR-011 reads: "M6 ships the logger, the IndexedDB layer and JSON export/import
in one milestone" and "no later milestone begins until that passes." The
milestones renumbered after it was accepted. M6 shipped conditioning expansion;
persistence is M7. Read literally, M6 should not have happened.

ADR-011 is ACCEPTED and therefore immutable, so this ADR restates its gate with
the reference corrected:

> **M7** ships the IndexedDB layer and JSON export/import in one milestone. Its
> exit criterion is: export → wipe browser storage → import → identical
> canonical state.

Two things change and one does not. The milestone number is corrected. The word
"logger" is struck, because ruling 1 removes it — the gate now governs planner
state and imported history rather than athlete-entered sets. **The gate itself
does not move**, and its reason is unchanged: ADR-004 records that iOS Safari
evicts IndexedDB, so durable state with no export path is one eviction from
gone.

### Options rejected

**Full in-app logging.** Rejected as a scope and correctness decision, not a
capability judgement. It roughly doubles M7 — set entry UI, prescribed-versus-
performed reconciliation (#13), and a merge rule against imported history — and
it creates the two-systems-of-record problem above. The athlete already logs in
FitNotes during a session and has no stated need to log twice.

**Cache the raw `.db` for re-reconciliation.** Rejected. It retains the athlete's
complete training database to solve a problem replacement already solves, and
"no source database is retained as a raw file" is an explicit #24 criterion.

**Fingerprint-and-diff imports.** Rejected as described above: it cannot
distinguish a correction from an addition, which is the common case, since
editing a set after logging it is ordinary use.

**Derived metrics only, discarding normalised sets.** Rejected. ADR-023's e1RM
resolution needs the last eight weeks of qualifying sets, and #20's deload
triggers need per-session RIR. Storing only summaries means recomputing them is
impossible when the rule changes, and the rule has already changed once — the
rep cap moved from ≤10 to ≤3 in review.

---

## Consequences

**Positive**

- One system of record for performed work. No merge rule, no disagreement.
- Import is idempotent by construction: re-importing an unchanged export is a
  no-op, satisfying #24's no-duplicates criterion without a dedupe table.
- Deletions and corrections in FitNotes propagate without special handling.
- M7 stays a persistence milestone. #13 is genuinely deferred rather than
  implicitly required.
- The athlete's training database is never stored by this app, which is a
  stronger privacy position than encrypting it would be.

**Negative / accepted**

- **No mid-session logging.** The athlete uses FitNotes during a workout, as
  today. This app is read at planning time.
- **Planning is always one export behind.** Progression reflects the last
  import, not this morning's session. Acceptable because deload and e1RM
  decisions operate on weeks, not hours.
- **A forgotten import silently stales the plan.** The UI must show the date of
  the last import wherever progression-derived numbers appear, or the athlete
  cannot tell current advice from stale advice. Carried as an M7 UI requirement.
- Imported history is not backed up by this app in any independent sense. The
  JSON export includes it, but FitNotes remains its origin.

**Review condition**

Revisit if the athlete wants to record a set that FitNotes cannot represent —
the `Shoulder Curl` combo lift in #38 is the existing example — or if FitNotes
ceases to be usable on the athlete's phone. Wanting to log in one app instead of
two is not sufficient: that is the convenience this ADR trades away deliberately.
