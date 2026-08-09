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
| [002](ADR-002-deterministic-rules-engine.md) | Planner is a deterministic rules engine, not an LLM | ACCEPTED | 003 |
| [003](ADR-003-content-as-data.md) | Content as data | ACCEPTED | 010, 012 |
| [004](ADR-004-storage-indexeddb-export.md) | Storage: IndexedDB with JSON export/import | ACCEPTED | 011 |
| [005](ADR-005-fork-scaffolding.md) | Fork existing web scaffolding; do not extract a package yet | ACCEPTED | — |
| [006](ADR-006-hand-authored-catalog.md) | Exercise library is hand-authored against our own schema | ACCEPTED | 009 |
| [007](ADR-007-no-deadline-quality-gates.md) | No deadline; quality gates replace dates | ACCEPTED | — |
| [008](ADR-008-catalog-before-logger.md) | Exercise catalog is authored before the logger | ACCEPTED | 011 |
| [009](ADR-009-dual-domain-schema.md) | Schema is dual-domain from record one | ACCEPTED | 006, 010 |
| [010](ADR-010-styles-as-data.md) | Workout styles become data; scoring domains stay code | ACCEPTED | 003, 012 |
| [011](ADR-011-persistence-gate.md) | No real training is logged until the persistence gate passes | ACCEPTED | 004, 008 |
| [012](ADR-012-data-code-boundary.md) | The data/code boundary | ACCEPTED | 003, 010 |

## Writing a new one

Copy `_TEMPLATE.md`. Number sequentially. Never renumber.
