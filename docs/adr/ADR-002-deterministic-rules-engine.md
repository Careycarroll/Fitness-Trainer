# ADR-002 — Planner is a deterministic rules engine, not an LLM

**Status:** ACCEPTED
**Date:** 2026-08-09
**Related:** ADR-003 (content as data), ADR-012 (validators are code)

---

## Decision

All program and session generation is rule-based and runs locally. No model inference, no
network call, in the generation path.

---

## Context

"Personal trainer" invites a chat-model implementation. It is the wrong tool here, for four
reasons in descending order of importance:

1. **Output cannot be validated.** An LLM produces plausible programs. Plausible is not
   checkable. A rules engine's output can be machine-verified against volume landmarks,
   movement-pattern balance and fatigue budget *before it is ever rendered*. This is the
   decisive reason.
2. **Strength programming is already a well-specified rule system.** Volume landmarks,
   progression models, fatigue cost, pattern balance, deload triggers. There is no latent
   ambiguity for a model to resolve.
3. **Offline-first (ADR-001)** forbids a network dependency in the core path.
4. Cost per generation is non-zero and recurring, for a single user.

---

## Consequences

**Positive**

- Output is reproducible: same inputs, same program, forever. This makes regression testing
  possible at all.
- Every generated block is machine-verifiable pre-render.

**Negative / accepted**

- Programming knowledge must be explicitly encoded rather than assumed. That authoring cost
  is real and lands mostly in ADR-006 and M4.
- No natural-language input. The generation request is a structured contract (see SPEC.md).

**Review condition**

A model could later be used *outside* the generation path — e.g. free-text notes
summarisation — without disturbing this ADR. It may never be used *inside* it.
