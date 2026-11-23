# ADR-032 — Workout of the Day (WOD) as date-seeded generation and preset benchmarks

**Status:** PROPOSED  
**Date:** 2026-11-23  
**Supersedes:** nothing  
**Refines:** ADR-002, ADR-010, ADR-012, ADR-014, ADR-027  
**Related:** ADR-001, ADR-015, ADR-031  

---

## Decision

> "Workout of the Day" (WOD) provides single-session training via two
> complementary paths:
>
> 1. **Daily Full-Body HIIT** is dynamically generated using the integer calendar
>    date as seed (`YYYYMMDD`), producing an offline, deterministic,
>    equipment-tailored whole-body conditioning circuit.
> 2. **CrossFit Challenge** provides classic named benchmark WODs ("The Girls",
>    Hero WODs) authored as static preset data in `data/programs/`, with dynamic
>    date-seeded AMRAP generation available as an alternative.
>
> Both paths emit standard `Program → Week → Session → Block → SetGroup`
> structures (ADR-027) and are exposed across two UI surfaces: a dedicated
> "Workout of the Day" top-level tab and within the "Style" selector when
> viewing "One day at a time".

---

## Context

Athletes frequently want a focused, high-intensity workout today without
configuring or committing to a multi-week periodized mesocycle. Two primary
archetypes address this:

- **CrossFit Challenge:** CrossFit culture revolves around recognized,
  standardized benchmark workouts (*Cindy*, *Fran*, *Helen*, *Annie*) scored by
  time or rounds against fixed prescriptions. Randomly assembling movements
  from pattern rules does not produce recognizable CrossFit benchmarks.
- **Daily Full-Body HIIT:** General fitness athletes seek a balanced,
  time-efficient interval session combining cardio, upper push/pull, lower
  push/pull, and core into a fast 20–30 minute station circuit.

### Offline & Deterministic Constraints

Pulling live daily WODs from external websites (such as CrossFit.com) over the
network violates ADR-001 (offline-first PWA, no server) and introduces CORS
failures and network latency in gym settings. Furthermore, parsing unconstrained
natural language text into structured `SetGroup` records requires fuzzy matching
that risks misclassifying movements and weights.

Date seeding (`seed = YYYYMMDD`) solves this for the HIIT generator: anyone
opening the app on the same date with the same equipment profile receives the
exact same balanced circuit, requiring zero network access and zero manual seed
entry.

### Presets vs. Generator Boundary

Per ADR-012 (*Data holds values, code holds shapes*), named benchmark WODs
belong in data presets rather than procedural code. A preset in `data/programs/`
encodes the exact movements, reps, and time caps of classic benchmarks. The
generator handles the variable, equipment-constrained HIIT circuits.

### Options Rejected

**Fetching live external WODs over the network.** Rejected. Violates ADR-001
(offline-first, no server); external feeds require backend proxies to bypass
CORS and fail in airplane mode or basement gyms. External prose is also
unstructured, creating catalog mapping errors.

**Generating CrossFit benchmarks dynamically.** Rejected. Iconic benchmarks have
exact, immutable structures (e.g., *Fran* is 21-15-9 Thrusters and Pull-ups;
*Cindy* is a 20-minute AMRAP of 5 Pull-ups, 10 Push-ups, 15 Squats). A dynamic
rules generator cannot reliably synthesize these exact historical workouts
without fragile special-case rules. Authoring them as presets is honest and
maintainable.

**Introducing a bespoke WOD data container.** Rejected. Emitting anything other
than the standard `Program → Week → Session → Block → SetGroup` hierarchy would
force the UI renderer, IndexedDB persistence, and FitNotes exporter to branch.
Emitting standard blocks means WODs immediately support set/rep editing,
instruction disclosures, and FitNotes CSV export with zero new plumbing.

---

## Consequences

**Positive**

- One-tap access to daily training without configuring a mesocycle.
- 100% offline and deterministic (ADR-001, ADR-002).
- Named CrossFit benchmarks are preserved accurately as authored data presets.
- Full compatibility with the FitNotes CSV export and date preview (ADR-031).
- Accessible both from a focused top-level WOD tab and within the existing
  planner sidebar when viewing one day at a time.

**Negative / accepted**

- Does not automatically pull today's official CrossFit.com mainsite workout
  over the wire. Official WODs must be added as presets or imported explicitly.
- A date-seeded daily workout does not account for yesterday's fatigue until
  M8's cross-day history tracking is connected.

**Review condition**

Revisit when M9 (CrossFit skill gates and benchmark-WOD tracking) begins, or if
an offline-safe interchange format for importing external daily workouts is
specified.
