# Architecture Decision Records

ADRs are **immutable once accepted**. A decision is never edited to reflect a new opinion —
a new ADR is written that supersedes or refines it, and the old record keeps its original text.
That history is the point: it shows what was believed and why it changed.

## Status vocabulary

| Status | Meaning |
|---|---|
| `PROPOSED` | Written, not yet agreed. Not binding. |
| `ACCEPTED` | Binding. Code and data must conform. |
| `SUPERSEDED` | Replaced. Header names the replacement. |
| `WITHDRAWN` | Abandoned before acceptance. Kept for the reasoning. |

---

## By area

Nobody reads these front to back. You arrive with a question — start here.

**Platform, storage, and process**
[001](ADR-001-platform-web-pwa.md) · [004](ADR-004-storage-indexeddb-export.md) · [005](ADR-005-fork-scaffolding.md) · [007](ADR-007-no-deadline-quality-gates.md) · [011](ADR-011-persistence-gate.md)

**Engine and generation**
[002](ADR-002-deterministic-rules-engine.md) · [010](ADR-010-styles-as-data.md) · [013](ADR-013-equipment-profiles-and-first-style.md) · [014](ADR-014-editable-profiles-and-whole-session-conditioning.md) · [015](ADR-015-arbitrary-training-days.md) · [027](ADR-027-block-setgroup-nesting.md)

**Data/code boundary and authoring surface**
[003](ADR-003-content-as-data.md) · [006](ADR-006-hand-authored-catalog.md) · [008](ADR-008-catalog-before-logger.md) · [012](ADR-012-data-code-boundary.md) · [016](ADR-016-catalog-authored-as-split-csv.md) · [017](ADR-017-catalog-file-ownership-rule.md) · [028](ADR-028-conditioning-catalog-ownership.md)

**Catalog vocabularies**
[009](ADR-009-dual-domain-schema.md) · [018](ADR-018-muscle-token-admission-test.md) · [019](ADR-019-isolation-and-explosive-patterns.md) · [020](ADR-020-joint-load-is-descriptive.md) · [021](ADR-021-retire-machine-equipment-token.md) · [022](ADR-022-equipment-substitution-map.md) · [024](ADR-024-odd-objects-excluded.md) · [025](ADR-025-single-joint-pattern-inconsistency.md) · [026](ADR-026-catalog-schema-reconciliation.md)

**Progression and history**
[023](ADR-023-e1rm-from-logged-sets.md)

---

## Index

| # | Title | Status | Refines | In one line |
|---|---|---|---|---|
| [001](ADR-001-platform-web-pwa.md) | Platform: Vite + vanilla JS PWA, phone-first | ACCEPTED | — | The gym has bad signal and a phone in your hand. |
| [002](ADR-002-deterministic-rules-engine.md) | Planner is a deterministic rules engine, not an LLM | ACCEPTED | 003 | If a session is wrong we can find the rule and fix it. |
| [003](ADR-003-content-as-data.md) | Content as data | ACCEPTED | 010, 012 | Exercises, styles, and progressions are definition files, not code. |
| [004](ADR-004-storage-indexeddb-export.md) | Storage: IndexedDB with JSON export/import | ACCEPTED | 011 | Local-first. Export is the backup story. |
| [005](ADR-005-fork-scaffolding.md) | Fork existing web scaffolding; do not extract a package yet | ACCEPTED | — | One consumer does not justify a shared package. |
| [006](ADR-006-hand-authored-catalog.md) | Exercise library is hand-authored against our own schema | ACCEPTED | 009 | Imported catalogs carry someone else's taxonomy. |
| [007](ADR-007-no-deadline-quality-gates.md) | No deadline; quality gates replace dates | ACCEPTED | — | Milestones close on passing checks, not on calendar. |
| [008](ADR-008-catalog-before-logger.md) | Exercise catalog is authored before the logger | ACCEPTED | 011 | The generator is bounded by catalog quality, so it comes first. |
| [009](ADR-009-dual-domain-schema.md) | Schema is dual-domain from record one | ACCEPTED | 006, 010 | Load and time are both first-class; retrofitting time is a migration. |
| [010](ADR-010-styles-as-data.md) | Workout styles become data; scoring domains stay code | ACCEPTED | 003, 012 | A style is a config; the scorer that reads it is not. |
| [011](ADR-011-persistence-gate.md) | No real training is logged until the persistence gate passes | ACCEPTED | 004, 008 | Losing real logged history is unrecoverable. |
| [012](ADR-012-data-code-boundary.md) | The data/code boundary | ACCEPTED | 003, 010 | Promotion test for what becomes a definition file. Safety logic fails closed. |
| [013](ADR-013-equipment-profiles-and-first-style.md) | Equipment profiles and the first validated style | ACCEPTED | 010 | `general-strength`, full body, profile-gated. |
| [014](ADR-014-editable-profiles-and-whole-session-conditioning.md) | Editable equipment profiles; conditioning as whole sessions | ACCEPTED | 013 | Presence, not quantity. Conditioning is a session, not a finisher. |
| [015](ADR-015-arbitrary-training-days.md) | Arbitrary training days: sequence is the plan, dates are a view | ACCEPTED | 014 | Missing Wednesday shifts a sequence, not a calendar. |
| [016](ADR-016-catalog-authored-as-split-csv.md) | Catalog authored as split CSV; JSON stays the build artifact | ACCEPTED | 003, 006, 012 | Cross-row calibration is a spreadsheet operation. |
| [017](ADR-017-catalog-file-ownership-rule.md) | An exercise lives in one file, by its first primary muscle | ACCEPTED | 016 | Duplicate authoring produces three ratings and a silent winner. |
| [018](ADR-018-muscle-token-admission-test.md) | A muscle token must be programmable in isolation from its parent | ACCEPTED | 006 | Delts pass. `upper_chest` and the tricep heads do not. |
| [019](ADR-019-isolation-and-explosive-patterns.md) | `isolation` and `explosive` added as movement patterns | ACCEPTED | 006 | Calf raises were counting as trunk volume. |
| [020](ADR-020-joint-load-is-descriptive.md) | `joint_load` is descriptive, not a safety rating | ACCEPTED | 019 | One column, opposite uses: avoid it or prioritise it. |
| [021](ADR-021-retire-machine-equipment-token.md) | `machine` retired and split into 12 specific tokens | ACCEPTED | 013 | The only hard filter had one honest mode: full commercial gym. |
| [022](ADR-022-equipment-substitution-map.md) | Equipment substitution map instead of duplicate implement rows | ACCEPTED | 021 | Kettlebell-only goes from 1 usable exercise to ~45. |
| [023](ADR-023-e1rm-from-logged-sets.md) | `ExerciseMax` is append-only; e1RM computed from logged sets | ACCEPTED | 009 | Two-tier confidence so a hypertrophy block does not go blind. |
| [024](ADR-024-odd-objects-excluded.md) | Odd objects and strongman implements excluded until owned | ACCEPTED | 021 | Invented ratings corrupt calibration for every row rated against them. |
| [025](ADR-025-single-joint-pattern-inconsistency.md) | Single-joint pattern rule is inconsistent for flies and trunk work | PROPOSED | 019 | Recorded unresolved rather than rediscovered in three months. |
| [026](ADR-026-catalog-schema-reconciliation.md) | Catalog schema reconciled with the engine vocabulary | ACCEPTED | 016 | The 285-row catalog and the engine disagreed on every vocabulary. |
| [027](ADR-027-block-setgroup-nesting.md) | A block holds an ordered list of setGroups; both domains emit one shape | ACCEPTED | 002, 009 | Consumers stopped branching on `session.domain`. |
| [028](ADR-028-conditioning-catalog-ownership.md) | Conditioning modalities own a file; prescription stays duration and intensity | PROPOSED | 017, 009 | A rower is a rower; a burpee is a movement conditioning happens to select. |

---

## Writing a new one

Copy `_TEMPLATE.md`. Number sequentially. Never renumber.

Add the record to **both** tables above — the area grouping and the index. The
one-line summary is the part people actually read; write it as the claim, not
the topic.
