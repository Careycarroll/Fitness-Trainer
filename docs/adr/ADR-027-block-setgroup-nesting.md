# ADR-027 — A session block holds an ordered list of SetGroups, not a single exercise

**Status:** ACCEPTED
**Date:** 2026-08-11
**Supersedes:** nothing
**Refines:** ADR-002, ADR-009
**Related:** ADR-010, ADR-012, ADR-026

---

## Decision

A generated session emits **blocks that contain an ordered list of `setGroups`**, where a
`SetGroup` is one exercise plus its prescription. Every block carries a `blockType`.

```js
blocks: [
  { blockType: 'straight',  setGroups: [ {...backSquat} ] },
  { blockType: 'superset',  setGroups: [ {...bench}, {...fly} ] },
  { blockType: 'amrap', timeCapSeconds: 900,
                            setGroups: [ {...deadlift}, {...hangClean}, {...pushJerk} ] }
]
```

`blockType` is one of `straight | superset | circuit | emom | amrap`. A straight set is a
one-element `setGroups` — there is no special case for the common shape.

`intervalDomain.js`'s parallel `stations[]` array is retired. A station is a `SetGroup`
inside a `circuit` block. Both generators emit the same container, and the renderer stops
branching on domain to decide which array to read.

This is not a new design. It is the `Program → Mesocycle → PlanWeek → Session → Block →
SetGroup → Set` tree already accepted in the technical plan. M3 shipped a flattened
`blocks[]` where each entry *is* an exercise, which was adequate for one generator and is
not adequate for three.

---

## Context

### What a flat block list cannot express

Three ordinary training structures — not edge cases, not CrossFit exotica — have no
representation in a one-exercise block:

| Structure | Shape | Occurs in |
|---|---|---|
| Superset | 2 exercises, alternating, one rest | bodybuilding, most accessory work |
| Circuit round | 5–8 exercises, timed, repeated | HIIT, conditioning |
| AMRAP | 3 exercises, scored as one unit | CrossFit |

An AMRAP is the clearest case. "12 deadlifts / 9 hang cleans / 6 push jerks, as many rounds
as possible in 15 minutes" is **one prescription**. Emitting it as three blocks loses the
thing that makes it a workout — the rounds and the cap belong to the group, not to any
member. There is nowhere to put `timeCapSeconds` that means what it needs to mean.

The superset case is what surfaced this. Pairing was going to be a post-pass that annotated
adjacent blocks with a shared label, and the labels would then have to be kept consistent by
every consumer that reordered, removed, or substituted a block. That is a nesting
relationship being simulated with sibling metadata, which is the failure mode ADR-012 names
in a different context: structure smuggled into fields because the container is wrong.

### Why now rather than at M9

The cost of this change is proportional to how much depends on the shape, and today that is:
two generators, one renderer, two test files, zero persisted sessions.

At M6 it also includes an IndexedDB schema and a migration. At M9 it includes every session
ever logged. ADR-011 gates persistence precisely so that shape mistakes stay cheap — this is
the case that gate exists for, and spending it now is what it is for.

The change is also nearly free in the load domain, which is the only generator in use: every
block it emits becomes a one-element `setGroups`, and no selection or prescription logic
moves.

### The modularity question, answered honestly

The block shape *is* the interface between the engine and its consumers. No abstraction hides
it, because any layer's output is a shape too. What limits the blast radius of a future
change is narrower and less satisfying:

- **Purity.** `generate(request, defs) → program` with no I/O (ADR-002) means changing what
  comes out never cascades into how it is produced.
- **`schemaVersion` on the program.** Already emitted. After M6 a shape change is a migration
  function, not data loss.
- **One constructor, one reader.** Block construction moves to a single `makeBlock()` helper;
  rendering dispatches on `blockType` through one table. The next shape change then touches
  two files rather than six.
- **Tests that assert behavior, not shape.** `assert.equal(top.exercise.pattern, 'squat')`
  survives a restructure; `assert.equal(blocks[0].name, ...)` does not.

Doing the nesting while there are 75 tests and no stored data is the actual protection. The
abstraction that would have prevented it does not exist.

### Rejected alternatives

**Annotate adjacent blocks with a shared `pairId`.** Cheapest possible superset support, and
it works until something reorders or removes a block. Then the invariant "a pairId appears
exactly twice, adjacently" has to be re-established by every consumer that mutates the list —
including the UI editor, which already splices blocks. Nesting makes the invariant structural
instead of conventional.

**A separate `Circuit` or `Amrap` entity alongside `Block`.** Reintroduces the parallel-shape
problem `intervalDomain`'s `stations[]` already demonstrates: the renderer branches on which
array exists, the editor needs two code paths, and substitution has to know which container
it is addressing. One container with a discriminant is the same information with one code
path.

**Defer until M9 when CrossFit actually needs it.** M9 is explicitly "last, and first to cut"
(MILESTONES). Deferring a structural decision to a milestone that may never ship means either
the structure never lands, or it lands as a migration across persisted sessions. It also
leaves supersets — which are wanted now, in M5 — with no honest representation in the
meantime.

**Keep `stations[]` for the time domain.** Retaining it costs one branch in the renderer
today and one branch in every consumer forever. A station has an exercise, a work duration,
and a rest duration; a `SetGroup` has an exercise and a prescription. They are the same thing
described twice.

---

## Consequences

**Positive**

- Supersets, circuits, EMOMs, and AMRAPs all become expressible without further structural
  change. M9 becomes "write a generator," not "migrate every session."
- The load and time domains emit the same container, so the renderer, the editor, and
  substitution stop branching on `session.domain` to find the exercise list.
- `timeCapSeconds`, `rounds`, and future group-level fields have an obvious home. Today they
  sit on the session and describe something narrower than the session.
- The emitted shape matches the accepted data model, so M6's IndexedDB schema can be written
  from the plan rather than from whatever the engine happens to produce.
- Pairing becomes a structural operation — move two `setGroups` into one block — rather than
  metadata two consumers must agree to interpret identically.

**Negative / accepted**

- Every consumer gains one level of indirection. `block.name` becomes
  `block.setGroups[0].name`, and the UI editor's `(week, session, block)` addressing becomes
  `(week, session, block, setGroup)`.
- Two test files assert on the flat shape and must be rewritten. That is the correct signal:
  they were asserting on structure rather than behavior, which is why they are the ones that
  break.
- The common case — a straight set — is now one element in a list, which reads as ceremony
  for the 90% path. Accepted deliberately: the alternative is a special case, and special
  cases are what make the 10% path expensive.
- One more field (`blockType`) that is `straight` on every row the load generator currently
  emits, and therefore carries no information today. It carries all of it later.

**Review condition**

Revisit if a block ever needs to contain another block — a superset nested inside a circuit,
or a complex inside an AMRAP. That is a tree rather than a two-level list, and it is a
different decision, not a wider version of this one. Nothing in powerlifting, bodybuilding,
HIIT, or standard CrossFit programming requires it.
