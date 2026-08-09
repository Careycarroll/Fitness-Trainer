# ADR-005 — Fork the existing web scaffolding; do not extract a shared package yet

**Status:** ACCEPTED
**Date:** 2026-08-09

---

## Decision

Copy the settings panel, theme handling and base-path logic from the existing web apps into
this repo. Do not extract them into a shared, versioned package.

---

## Context

This is the third copy of this infrastructure. Extraction is the textbook answer, and it is
wrong here: it converts a copy-paste into a versioned dependency with release coordination,
across a set of repos maintained by one person. The coupling cost exceeds the duplication
cost at n=3.

---

## Consequences

**Positive**

- No cross-repo release coordination. Each app can diverge freely.

**Negative / accepted**

- Three copies of the same theme toggle. Fixes must be applied per repo, or not at all.
- Recorded here so the debt is deliberate rather than accidental.

**Review condition**

A fourth web app. **An open-ended timeline is explicitly *not* a reason to reverse this** —
the cost of extraction is coordination overhead, and time does not reduce coordination
overhead.
