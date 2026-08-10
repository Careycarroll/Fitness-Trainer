# ADR-021 — `machine` retired and split into twelve specific tokens

**Status:** ACCEPTED
**Date:** 2026-08-10
**Supersedes:** nothing
**Refines:** ADR-013, ADR-014 (equipment profiles)
**Related:** —

---

## Decision

`machine` is **removed from the equipment vocabulary** and split into twelve tokens:

```
leg_press              hack_squat             belt_squat
leg_extension_machine  leg_curl_machine       smith_machine
plate_loaded           pec_deck               back_extension_bench
calf_machine           hip_abductor_machine   captains_chair
```

`machine` is listed in `RETIRED_EQUIPMENT` so using it produces an error naming its
replacement, rather than a generic unknown-token error.

`belt` was renamed `dip_belt` in the same sweep, to avoid collision with a lifting belt
(which is attire and gates nothing).

---

## Context

`machine` appeared on 35 rows and stood for eleven physically different units — leg
press, hack squat, Smith machine, pec deck, seated leg curl, hip thrust machine, GHD,
captain's chair, calf machine, abduction unit, plate-loaded press.

`equipment` is the engine's **only hard filter**. Every other column is a preference. A
filter whose largest token means "some machine, somewhere" has exactly one correct mode —
full commercial gym — and lies in every other profile. Requesting a quad session on the
garage profile would cheerfully return a hack squat.

The split was originally scoped at nine tokens. Three rows had nowhere legal to land:
standing/seated calf raise, hip adduction/abduction, and captain's chair. Folding them
into `plate_loaded` would have been false — plenty of gyms have a chest press and no calf
machine. Hence twelve.

Grouping rules:
- `plate_loaded` covers plate- and stack-loaded pressing/rowing units (chest press,
  shoulder press, machine row, machine lateral, machine preacher curl, machine triceps).
  These cluster because a gym with one has most of them.
- `back_extension_bench` covers 45° hyper, reverse hyper, and GHD/GHR — same corner of
  the same gyms.
- `pec_deck` is separate from `plate_loaded` because many home setups have a press station
  and no fly station.

### Rejected alternatives

**Keep `machine`, add only `smith_machine` and `leg_press`.** The two that most often
exist without the rest. Cheaper, and leaves the filter lying in nine other cases.

**`bench_adjustable` as a token.** Not needed — any row with `bench` in `equipment` and
`incline` or `decline` in `emphasis` requires adjustability. One derived rule, zero new
tokens, zero rows edited. Gym profiles declare `bench_adjustable` as a *capability*.

---

## Consequences

**Positive**

- The equipment filter becomes true rather than merely present. `equipment` is
  the generator's only hard filter, and its largest token previously meant
  "some machine, somewhere" — one useful mode, full commercial gym, and a lie
  everywhere else.
- Gym profiles produce honest survivor counts: garage 69%, minimal 49%,
  hotel 19%. Those numbers were meaningless while `machine` existed.
- Retiring the token rather than deprecating it prevents drift back into it.
  Using `machine` now errors and names its replacement.
- The split came out at 12 tokens, not the 9 proposed — calf, hip
  abductor/adductor, and captain's chair rows had nowhere legal to land, and
  folding them into `plate_loaded` would have been false.

**Negative / accepted**

- 35-row sweep across eleven files, done. Cost was roughly half what it would have been
- Profile survivor counts became meaningful: commercial 285, garage 198 (69%),
- Leaving `machine` as a legal fallback would have guaranteed drift back into it. Removal

**Review condition**

Revisit if a token in the split never distinguishes a real gym profile —
i.e. if no profile is ever authored that has one and not the others. That
would mean the split went one level too fine.
