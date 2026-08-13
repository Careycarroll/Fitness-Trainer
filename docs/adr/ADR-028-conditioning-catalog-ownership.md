# ADR-028 — Conditioning modalities own a file; prescription stays duration and intensity

**Status:** PROPOSED
**Date:** 2026-08-13
**Supersedes:** nothing
**Refines:** ADR-017, ADR-009
**Related:** ADR-012, ADR-013, ADR-014, ADR-021, ADR-026, #37

---

## Decision

> An exercise whose **primary identity is a cyclic or round-based conditioning modality**
> lives in `data/exercises/13_conditioning.csv`. An exercise that is an ordinary muscular
> movement — even one routinely performed for time in a circuit — stays in the file ADR-017
> assigns it.

The test is what the movement *is*, not where it gets used. A rower is a rower. A burpee is
a full-body movement that conditioning sessions happen to select.

Three further rulings, each of which the first release depends on:

**Prescription is duration, work/rest, rounds, and an intensity token — nothing else.**
`intensity` takes one of `easy | moderate | hard | all_out`. Distance, pace, incline,
resistance level, and stroke rate are **not** authored, not stored, and not prescribed.

**Outdoor modalities carry no equipment token.** Walking, Running — Outdoor, Cycling —
Outdoor, and Swimming are treated exactly as `bodyweight` is: performable under every
profile, including an empty one.

**Machine tokens are owned by profile, and the gaps are real.** `commercial-gym` is
`assumesAll`, so it acquires every new token automatically. `home-garage` gains `treadmill`
and nothing else — no rower, no bike, no erg. A session that needs a machine the profile
does not own is reported in `omitted[]` and explained on screen. It is never quietly
back-filled with a substitute from a different modality.

---

## Context

After #37, 55 of 286 rows are time-eligible and `hiit` and `crossfit` build genuine
multi-station circuits. **`cardio` still emits zero blocks in all three of its sessions**,
and the reason is not the candidate pool:

```text
cardio.workRest.workSeconds = 600
cardio.patternEmphasis      = { monostructural: 1, locomotion: 0.6, isolation: 0.2, ...rest 0 }
```

A ten-minute work interval cannot be satisfied by any row in the catalog. Time-scored rows
are bounded near 60s and get rejected by the clamp; reps-for-time rows take the style
window unmodified, which would prescribe ten unbroken minutes of push-ups. The style is
asking for a rower and the catalog has never contained one. No derivation rule can close
that — #37 proved it by widening the pool 23 → 55 and moving `cardio` not at all.

So the file is not a convenience. It is the only thing standing between a shipped style
and a permanently empty session.

### Why a new file rather than `12_fullbody.csv`

ADR-017 exempts `12_fullbody.csv` because its rows are defined by **pattern** rather than
by an owning muscle, and checks its rows against `{explosive, carry, locomotion}`.
Monostructural rows are defined by neither: a rower has no owning muscle worth naming and
`monostructural` is not in that pattern set. Adding them to the fullbody file would mean
widening its admission test until it no longer tests anything, which is how the sole
exemption becomes the default.

A second exemption with its own narrow admission test — `{monostructural, locomotion}` —
keeps both files checkable.

### Why burpees and mountain climbers stay put

They are the boundary case, and the boundary has to fall somewhere defensible. Mountain
Climber is `crawl` / `locomotion` / `bodyweight`, authored in `12_fullbody.csv` on
2026-08-13. It is a full-body movement that conditioning selects; a rower is a machine you
cannot use for anything else. Moving it would mean the rule is "things that appear in
conditioning sessions", which is a usage rule, and usage rules put the same movement in two
files the moment a style changes its emphasis.

### Rejected alternatives

**Author distance and pace now.** ADR-009's stated review condition is a third
distance/pace scoring domain, and its own answer is that this would be a code refactor
rather than a data change. Authoring `distance_meters` into CSV rows ahead of that refactor
puts a value in data whose *shape* the engine cannot yet consume — a column that validates
and does nothing. Deferred to #30, on the evidence of a real prescription that duration and
intensity cannot express.

**A numeric intensity percentage.** `intensity: 65` implies a percentage of something the
engine cannot compute without heart-rate or pace data, neither of which exists and both of
which ADR-009 rules out. A four-token vocabulary claims exactly as much as is known. This
is the same trap #37 refused when it declined to fabricate a `timeDomain` window out of
`default_rest_sec`.

**Give `home-garage` a rower so cardio always generates.** This would make the catalog
assert equipment the athlete does not own in order to keep a style from looking broken.
The honest failure — cardio explains that it needs a machine this profile lacks — is
better than a plausible prescription for a machine that is not in the garage. ADR-014
already establishes profiles as editable; an athlete who buys a rower adds the token.

**Substitute across modalities when a machine is missing.** Swapping a rower for
kettlebell swings is not a substitution, it is a different session. ADR-022's substitution
map is within-pattern by design and monostructural has no within-pattern alternative on a
profile that owns no machines.

---

## Consequences

**Positive**

- `cardio` becomes generable on both shipped profiles: `commercial-gym` through machines,
  `home-garage` through the treadmill and the four outdoor rows.
- Outdoor rows carrying no equipment token means the empty profile is not a dead end —
  the same property that makes `bodyweight` rows the floor of every load session.
- The prescription model stays inside the existing time domain. No schema migration, no
  new scoring domain, no change to `Block → SetGroup` (ADR-027).
- Both catalog exemptions keep a narrow, enforceable admission test rather than one broad
  one.

**Negative / accepted**

- **Two exemptions to ADR-017 now exist.** The rule is no longer "one exception"; it is
  "muscle-owned unless the row is pattern-defined, and there are two such files". Accepted
  because the alternative is a fullbody file whose admission test admits everything.
- **`home-garage` cannot run machine-based conditioning.** This is a true statement about a
  garage, and the UI states it. It is a visible gap by design.
- **`intensity` is subjective.** `hard` means what the athlete decides it means. The
  planner cannot verify effort and does not claim to — the same position ADR-023 takes on
  e1RM being computed from what was logged rather than measured.
- **Outdoor rows are prescribable but unverifiable.** Nothing stops the engine prescribing
  40 minutes easy running to someone with no route. Accepted: this is the athlete's call,
  and it is the same latitude every bodyweight row already carries.
- Every new equipment token needs profile ownership or check 06 fails. That is the check
  doing its job, but it is real work per token.

**Review condition**

Revisit when a prescription is genuinely blocked by the absence of distance or pace —
concretely, when a style needs to express "5k" or "2:00/500m split" and cannot be honestly
served by duration plus intensity. That is ADR-009's own review trigger and the answer
there is a code refactor, so it warrants a new ADR rather than an edit to this one.

Revisit sooner if `13_conditioning.csv` passes ~40 rows, per ADR-017's file-size condition.
