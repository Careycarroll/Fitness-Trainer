# ADR-006 — Exercise library is hand-authored against our own schema

**Status:** ACCEPTED
**Date:** 2026-08-09
**Related:** ADR-001 (offline-first), ADR-009 (dual-domain)

---

## Decision

Author the exercise catalog by hand against our schema. Do not import, vendor or wrap a
public exercise dataset or API.

---

## Context

Public options were evaluated:

| Source | Coverage | Disqualifying problem |
|---|---|---|
| wger REST API | Large, open-licensed | Runtime network dependency — violates ADR-001 |
| ExerciseDB (RapidAPI) | ~1,300 exercises + GIFs | Keyed, rate-limited, paid tier; unusable offline |
| free-exercise-db (static JSON) | ~870 exercises, images | Closest fit; see below |

Every public dataset models an exercise as **reference content**: name, muscle group,
instructions, image. The engine needs **planning primitives**: `pattern`, `fatigueCost`,
`skill`, `defaultRIR`, `restSeconds`, `loadType`, `warmupRequired`. None of those fields exist
in any public source, and they are precisely the fields the generator reads.

An import therefore supplies the ~20% that is trivially obtainable anyway, none of the 80%
the engine consumes, and leaves several hundred unused records to reconcile against our schema
in perpetuity.

**Permitted use:** free-exercise-db may be consulted as a *human reference* while authoring —
name normalisation, muscle-attribution sanity checks. It is not a dependency, not vendored,
and not in the build. **Verify its current licence before use even in that capacity** — this
has not been checked.

---

## Consequences

**Positive**

- Every record is engine-ready by construction. No adapter layer, no field reconciliation.
- Catalog size is chosen by us (ADR-008 defines completeness), not inherited.

**Negative / accepted**

- ~180–220 records of manual authoring. This is the long pole of the project and is the
  reason ADR-008 resequences milestones around it.
- No exercise images or demo media. Link out instead (§1 non-goals).

**Review condition**

Reinforced, not weakened, by ADR-009: no public dataset carries interval-domain metadata
(`scoring`, `timeDomain`, `roundsCapable`, `kipAllowed`) at all, so the share of fields we
must author ourselves went *up*. Revisit only if a dataset appears that models planning
primitives natively.
