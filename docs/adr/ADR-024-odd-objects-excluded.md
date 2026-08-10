# ADR-024 — Odd objects, strongman implements, and rucking excluded from v1

**Status:** ACCEPTED
**Date:** 2026-08-10
**Supersedes:** nothing
**Refines:** ADR-013, ADR-014 (equipment profiles)
**Related:** —

---

## Decision

Excluded from the catalog and the equipment vocabulary:

- **Rucking** — excluded on user instruction.
- **Sandbag, ammo can, bucket, water jug** — the token `sandbag` is specified and
  documented but **no rows are authored**, because the equipment is not owned.
- **Yoke, atlas stone, log, keg, tire, axle** — excluded. Not owned, and the metadata
  would be invented.

The `sandbag` token and its 8–10 candidate rows (bear-hug squat, shouldering, over-shoulder
throw, sandbag clean, Zercher carry, bear-hug carry, sandbag drag, sandbag get-up) are
recorded in `docs/fitness/EQUIPMENT_MASTER_INVENTORY.md` §11 as a ready-to-author block.

---

## Context

Odd objects were initially dismissed in one line, which under-weighted them. They are a
genuinely distinct class, for reasons worth recording since the exclusion may be revisited:

- **The load shifts mid-rep.** Every other implement in the inventory has a fixed centre of
  mass. Sand settles; water sloshes a beat behind you.
- **The limiter moves off the prime mover.** A 100lb sandbag front squat is limited by
  trunk and arms, not quads. That is the stimulus, not a deficiency.
- **The class is almost entirely low-impact** — carries, drags, bear-hug squats,
  shouldering. No loaded eccentric at the knee, which is relevant to the knee-resilience
  goal: it is trainable on days when deep-flexion work is not.

None of that is captured by `dumbbell`.

The exclusion is therefore about **ownership, not merit**. Authoring rows for equipment the
single user does not have produces a catalog that fails its own profile checks and
prescribes movements that cannot be performed.

### Rejected alternatives

**Authoring the rows now, gated behind an equipment profile.** They would be unverifiable
— the ratings would be guesses about implements nobody has handled — and profile coverage
checks would pass on movements that cannot actually be performed.

---

## Consequences

**Positive**

- The library contains no rows for equipment that is not owned, so every
  generated session is performable as written.
- The metadata that would have been required — fatigue and technical ratings
  for implements never handled — would have been invention, and invented
  ratings corrupt calibration for every row rated against them.
- The category is documented in EQUIPMENT_MASTER_INVENTORY §11 rather than
  forgotten, so admitting it later is authoring rows, not rediscovering the
  argument.

**Negative / accepted**

- The low-impact loaded-carry space is currently served only by `12_fullbody.csv`'s
- If a sandbag is acquired, this is a ~10-row addition to `12_fullbody.csv` plus one
- Ammo cans, buckets, and jugs are specified to fold into the `sandbag` token rather than
- A duffel bag plus plates is the zero-cost path to this category if it is ever wanted.

**Review condition**

Revisit on acquisition. A sandbag is the cheapest entry and unlocks 8-10 rows
that duplicate nothing in the library; a duffel bag loaded with plates is the
zero-cost version of the same stimulus.
