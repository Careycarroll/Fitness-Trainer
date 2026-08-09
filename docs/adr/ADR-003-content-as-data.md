# ADR-003 — Content as data

**Status:** ACCEPTED
**Date:** 2026-08-09
**Refined by:** ADR-010, ADR-012

---

## Decision

Exercises, progression coefficients, split templates, periodization curves and style
definitions are JSON definition files consumed by a domain-agnostic engine.
`js/engine/SPEC.md` is the authoritative schema contract. A schema validator runs in CI and
must pass before deploy.

---

## Context

The same pattern is load-bearing in two existing apps in this portfolio. Adding content should
never require writing page code — that is the property that makes a content-heavy app scale
past the first fifty records.

---

## Consequences

**Positive**

- Adding an exercise, a template or a whole training style is a data edit.
- The engine has one code path exercised by every record, so defects surface early.

**Negative / accepted**

- The schema is a public commitment as soon as export ships (ADR-004). Data is expensive to
  change in a way code is not.
- Requires a validator suite to be worth anything. Unvalidated data is worse than code.

**Review condition**

This ADR states *that* content is data. It deliberately does not state *where the boundary
is* — that was left open and is now closed by **ADR-012**. Read them together.
