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

## Index

| # | Title | Status | Relates to |
|---|---|---|---|
| [001](ADR-001-platform-web-pwa.md) | Platform: Vite + vanilla JS PWA, phone-first | ACCEPTED | — |
| [002](ADR-002-deterministic-rules-engine.md) | Planner is a deterministic rules engine, not an LLM | ACCEPTED | — |
| [003](ADR-003-content-as-data.md) | Content as data | ACCEPTED | — |
| [004](ADR-004-storage-indexeddb-export.md) | Storage: IndexedDB, with JSON export/import | ACCEPTED | — |
| [005](ADR-005-fork-scaffolding.md) | Fork the existing web scaffolding; do not extract a shared package yet | ACCEPTED | — |
| [006](ADR-006-hand-authored-catalog.md) | Exercise library is hand-authored against our own schema | ACCEPTED | — |
| [007](ADR-007-no-deadline-quality-gates.md) | No deadline; quality gates replace dates | ACCEPTED | — |
| [008](ADR-008-catalog-before-logger.md) | Exercise catalog is authored before the logger | ACCEPTED | — |
| [009](ADR-009-dual-domain-schema.md) | Schema is dual-domain (load and time) from record one | ACCEPTED | — |
| [010](ADR-010-styles-as-data.md) | Workout styles become data; scoring domains stay code | ACCEPTED | 3 |
| [011](ADR-011-persistence-gate.md) | No real training is logged until the persistence gate passes | ACCEPTED | — |
| [012](ADR-012-data-code-boundary.md) | The data/code boundary: what becomes a definition file and what stays in the engine | ACCEPTED | 3, 10 |
| [013](ADR-013-equipment-profiles-and-first-style.md) | Equipment profiles and the first validated style | ACCEPTED | 6, 8, 10 |
| [014](ADR-014-editable-profiles-and-whole-session-conditioning.md) | Editable equipment profiles, and conditioning as whole sessions | ACCEPTED | 13, 10, 12 |
| [015](ADR-015-arbitrary-training-days.md) | Arbitrary training days: sequence is the plan, dates are a view | ACCEPTED | 13, 14 |
| [016](ADR-016-catalog-authored-as-split-csv.md) | The exercise catalog is authored as split CSV; JSON stays the build artifact | ACCEPTED | 3, 6, 12 |
| [017](ADR-017-catalog-file-ownership-rule.md) | An exercise lives in exactly one file, decided by its first primary muscle | ACCEPTED | 16 |
| [018](ADR-018-muscle-token-admission-test.md) | A muscle token must be programmable in isolation from its parent | ACCEPTED | — |
| [019](ADR-019-isolation-and-explosive-patterns.md) | `isolation` and `explosive` added as movement patterns | ACCEPTED | 25 |
| [020](ADR-020-joint-load-is-descriptive.md) | `joint_load` is descriptive, not a safety rating | ACCEPTED | — |
| [021](ADR-021-retire-machine-equipment-token.md) | `machine` retired and split into twelve specific tokens | ACCEPTED | 13, 14 |
| [022](ADR-022-equipment-substitution-map.md) | Equipment substitution map instead of duplicate implement rows | ACCEPTED | 21 |
| [023](ADR-023-e1rm-from-logged-sets.md) | Working maxes are append-only and computed from logged sets | ACCEPTED | 4, 11, 8 |
| [024](ADR-024-odd-objects-excluded.md) | Odd objects, strongman implements, and rucking excluded from v1 | ACCEPTED | 13, 14 |
| [025](ADR-025-single-joint-pattern-inconsistency.md) | The single-joint pattern rule is inconsistent for flies and trunk work | PROPOSED | 19 |

## Writing a new one

Copy `_TEMPLATE.md`. Number sequentially. Never renumber.
