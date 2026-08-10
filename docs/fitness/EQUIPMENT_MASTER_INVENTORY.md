# Gym Equipment — Master Inventory

Written **independent of the exercise library**. The point is to see what exists,
not what we happened to use in files 01–11. Triage in §17 decides what becomes a
token.

**Confirmed owned (Carey):** `slant_board`. Everything else in §18 is unconfirmed
and needs a yes/no before gym profiles mean anything.

**Changed in v2:** §11 rewritten. Odd objects — sandbags, ammo cans, buckets,
jugs — were previously one skipped line. They are now their own category with
their own triage, because shifting load is a distinct stimulus and the whole
class is low-impact.

---

## 1. Bars

| Item | Notes |
|---|---|
| Standard barbell (20kg / 45lb) | The default. `barbell` |
| Women's / 15kg barbell | Same token, different loading |
| Technique bar (5–10kg) | Same token |
| EZ curl bar | `ez_bar` — genuinely different wrist angle |
| Trap / hex bar | `trap_bar` |
| Safety squat bar | `safety_bar` — changes torso angle and load path |
| Cambered bar | Powerlifting specialty; skip |
| Swiss / football bar | Neutral-grip pressing; useful for shoulders |
| Buffalo bar | Skip — near-duplicate of safety bar |
| Axle bar (fat) | Grip-limited pressing/pulling; strongman |
| Log bar | Strongman; skip |
| Landmine attachment | `landmine` |
| Deadlift bar | Same token as barbell |
| Squat bar (stiff) | Same token as barbell |

## 2. Plates & Loading

| Item | Notes |
|---|---|
| Bumper plates | Drop-safe. **Gates all olympic lifting** |
| Iron/steel plates | Cheaper, not drop-safe |
| Change plates (1.25–2.5lb) | The difference between progressing and stalling |
| Technique plates | Light, bumper-diameter |
| Fractional plates (0.25–1lb) | Upper-body progression |
| Weight collars / clips | Accessory, not a token |
| Plate-loaded pin | Accessory |

`plate` as a token means "a loose plate used as the implement" (weighted push-up,
neck curl, Russian twist), not "the gym has plates."

## 3. Dumbbells & Kettlebells

| Item | Notes |
|---|---|
| Fixed dumbbells | `dumbbell` |
| Adjustable dumbbells | Same token; matters for home |
| Loadable dumbbell handles | Same token |
| Kettlebells | `kettlebell` |
| Adjustable kettlebell | Same token |
| Competition kettlebell | Same token; uniform dimensions |

## 4. Racks, Stands & Benches

| Item | Notes |
|---|---|
| Power rack / cage | `rack` |
| Half rack | `rack` |
| Squat stands | `rack` |
| Wall-mount folding rack | `rack` |
| Flat bench | `bench` |
| Adjustable bench | Derived from `bench` + incline/decline emphasis |
| Decline bench | Same |
| Preacher bench | Own token if preacher work matters |
| Roman chair / 45° hyper | `back_extension_bench` |
| Reverse hyper | Merged into `back_extension_bench` |
| GHD / Nordic bench | Merged into `back_extension_bench` |
| Sit-up / decline ab bench | `bench` |
| Spotter arms / safeties | Capability of `rack`, not a token |
| Jerk blocks / pulling blocks | Skip unless olympic focus |
| Deadlift platform | `platform` |

## 5. Machines — Selectorised & Plate-Loaded

| Item | Proposed token |
|---|---|
| Cable crossover / functional trainer | `cable` |
| Single cable stack | `cable` |
| Lat pulldown station | `cable` |
| Seated row station | `cable` |
| Smith machine | `smith_machine` |
| Leg press (45° / horizontal) | `leg_press` |
| Hack squat | `hack_squat` |
| Pendulum squat | `hack_squat` |
| Belt squat | `belt_squat` |
| Leg extension | `leg_extension_machine` |
| Seated / lying / standing leg curl | `leg_curl_machine` |
| Chest press | `plate_loaded` |
| Shoulder press | `plate_loaded` |
| Machine row / high row | `plate_loaded` |
| Machine lateral raise | `plate_loaded` |
| Machine preacher curl | `plate_loaded` |
| Machine triceps extension | `plate_loaded` |
| Pec deck / rear delt fly | `pec_deck` |
| Hip thrust machine | `plate_loaded` |
| Hip abduction / adduction | `hip_abductor_machine` |
| Calf raise (standing/seated) | `calf_machine` |
| Ab crunch machine | `plate_loaded` |
| Captain's chair / vertical knee raise | `captains_chair` |
| Assisted pull-up / dip machine | `assisted_pullup_machine` |

## 6. Cables & Attachments

Attachments do **not** gate exercise selection — any gym with a cable stack has a
rope and a straight bar. Not tokens.

Straight bar · EZ attachment · rope · single D-handle · V-bar · lat bar ·
tricep V · ankle strap · belt attachment · row handle

## 7. Bodyweight & Suspension

| Item | Token | Notes |
|---|---|---|
| Pull-up bar | `pullup_bar` | |
| Dip bars / station | `dip_bar` | |
| Parallettes | `parallettes` | Low, floor-level |
| Gymnastic rings | `rings` | **Two independent anchors, free rotation** |
| Suspension trainer (TRX) | `suspension_trainer` | **Single anchor, straps stay together** |
| Dip belt | `dip_belt` | Renamed to avoid collision with lifting belt |
| Weight vest | `weight_vest` | |
| Ab wheel | `ab_wheel` | |
| Push-up handles | Skip — accessory | |
| Sliders / valslides | `sliders` | Or a towel |
| Plyo box | `box` | |
| Step platform | `box` | |
| Bench/chair (improvised) | `box` | |

**Rings vs. suspension trainer are not the same token.** A ring dip is a
categorically harder movement than a TRX dip — free rotation at two anchors
versus a fixed single point.

## 8. Bands & Elastic

| Item | Token |
|---|---|
| Loop / power bands (long) | `bands` |
| Mini bands (short loop) | `bands` |
| Tube bands with handles | `bands` |
| Therapy bands (flat) | `bands` |
| Band anchor / door anchor | Accessory |
| Hip circle | `bands` |

One token. The distinction between a mini band and a power band is load, which is
a prescription concern.

## 9. Balls

| Item | Token | Notes |
|---|---|---|
| Medicine ball | `med_ball` | Bounces; rotational throws |
| Slam ball | `slam_ball` | Sand-filled, no bounce, floor slams |
| Wall ball | `wall_ball` | Oversized, soft, 14–20lb |
| Stability / swiss ball | `stability_ball` | |
| Bosu ball | Skip | |
| Lacrosse / massage ball | Skip — recovery | |

**Three different implements.** A med ball is wrong for slams (it bounces back at
you), a slam ball is wrong for wall balls (too dense, too small).

## 10. Ropes

Four unrelated pieces of equipment that share a word.

| Item | Token | Use |
|---|---|---|
| Battle ropes | `battle_rope` | Anchored, undulating, conditioning |
| Climbing rope | `climbing_rope` | Vertical pull, grip |
| Jump rope | `jump_rope` | Locomotion, plyometric |
| Sled/pulling rope | `sled` | Horizontal drag |

## 11. Odd Objects, Carries & Strongman

**Rewritten in v2.** Previously one skipped line. This category was
under-weighted and it shouldn't have been.

### 11.1 Why odd objects are their own class

Every other implement in this document has a **fixed** center of mass. A dumbbell
weighs the same in every position and doesn't move in your hands. Odd objects
don't:

- **The load shifts mid-rep.** Sand settles, water sloshes, a keg's contents move
  a beat behind you.
- **The limiter moves off the prime mover.** A 100lb sandbag front squat is
  limited by your trunk and your arms, not your quads. That's a feature, not a
  deficiency — it's the reason a sandbag isn't just a cheap barbell.
- **There are no good handles, or the handles are wrong.** Grip and awkwardness
  are part of the stimulus.
- **They're almost all low-impact.** Carries, drags, bear-hug squats, shouldering.
  No loaded eccentric at the knee. This matters given the knee-resilience goal —
  the whole class is trainable on days when deep-flexion work isn't.

None of that is captured by `dumbbell` or `sandbag`-as-a-skip.

### 11.2 The implements

| Item | Token | Typical load | Notes |
|---|---|---|---|
| Sandbag (with handles) | `sandbag` | 25–150lb | The anchor of this category. Home-viable, cheap, adjustable by filler |
| Sandbag (no handles / "bulldog") | `sandbag` | 50–200lb | Bear-hug and shouldering only |
| **Ammo can** | `sandbag` | 20–40lb ea. | Steel, hard edges, bad handle position. Pairs well for carries |
| Bucket (sand/water-filled) | `sandbag` | 20–80lb | The improvised version. Water sloshes more than sand |
| Water jug / jerry can | `sandbag` | 20–50lb | Maximum slosh; hardest to stabilize per pound |
| Duffel bag + plates | `sandbag` | Any | The free option |
| Farmer's handles | `farmers_handles` | Loadable | Fixed load, but the length and grip are unique |
| Trap bar (as a carry tool) | `trap_bar` | Loadable | Already tokenized |
| Sled (push/drag/rope) | `sled` | Loadable | §11.4 below |
| Keg | Skip | 50–200lb | Slosh is extreme, but you don't have one |
| Atlas stones | Skip | 80–300lb | Needs tacky, a platform, and instruction |
| Yoke | Skip | Heavy | Gym-specific, spinal-compression heavy |
| Tire (flip) | Skip | Heavy | Injury-prone, hard to scale, needs outdoor space |
| Log bar | Skip | Loadable | Pressing implement, not a carry |
| Heavy dummy / grappling bag | Skip | 60–150lb | Sport-specific |

### 11.3 Movements this class unlocks

None of these exist anywhere in files 01–11, and none are duplicates of a row
that does exist:

| Movement | Pattern | Why it isn't a dumbbell row |
|---|---|---|
| Sandbag bear-hug squat | `squat` | Anterior load held with no handles; trunk-limited |
| Sandbag shouldering | `explosive` | Ground-to-shoulder with a shifting load; alternating sides |
| Sandbag over-shoulder throw | `explosive` | Full triple extension, no eccentric to catch |
| Sandbag clean | `explosive` | Different bar path and grip from a barbell or KB clean |
| Sandbag Zercher carry | `carry` | Elbow-crook load; erectors and trunk |
| Bear-hug carry | `carry` | Anterior, compresses breathing |
| Ammo can / suitcase carry | `carry` | Unilateral, anti-lateral-flexion. Already partly served by dumbbell suitcase carry |
| Ammo can double carry | `carry` | Bilateral, hard edges, low handle position |
| Sandbag drag | `locomotion` | Concentric-only, same low-shear logic as the sled |
| Sandbag get-up | `explosive` | Floor to standing under a shifting load |

Roughly **8–10 rows**, and they'd land in `12_fullbody.csv` — every one is either
`carry`, `explosive`, or multi-group by pattern, which is exactly the file 12
exemption to the ownership rule.

### 11.4 Sleds — already resolved

`sled` is already in the vocabulary and three rows are live in `01_quads.csv`
(backward drag, forward push, forward drag). Sled rope is the same token. No
change.

## 12. Grip

| Item | Token |
|---|---|
| Wrist roller | `wrist_roller` |
| Grippers (COC) | `gripper` |
| Pinch blocks | `plate` (pinch two plates) |
| Fat grips | Accessory |
| Hand grip towel | Skip |

## 13. Conditioning Machines

| Item | Token |
|---|---|
| Assault / air bike | `air_bike` |
| Rowing erg | `rower` |
| SkiErg | `ski_erg` |
| Treadmill | `treadmill` |
| Stair climber | `stair_climber` |
| Elliptical | Skip |
| Curved manual treadmill | `treadmill` |
| Spin bike | `bike` |

## 14. Mobility & Prep

| Item | Token |
|---|---|
| **Slant board** | `slant_board` ✅ **owned** |
| Foam roller | `foam_roller` |
| Massage gun | Skip |
| Yoga mat | Skip |
| Yoga blocks | Skip |
| Stretching strap | `bands` |
| Hurdles (mobility) | `hurdle` |
| Agility ladder | `agility_ladder` |
| Balance pad | Skip |

## 15. Specialty / Rehab

| Item | Token |
|---|---|
| Reverse hyper | `back_extension_bench` |
| Nordic bench / GHD | `back_extension_bench` |
| Tib bar | `tib_bar` |
| Knee/ankle wraps | Not equipment — attire |
| Blood flow restriction cuffs | `bfr_cuffs` |
| Neck harness | `neck_harness` |

## 16. Attire & Support (never tokens)

Belt (lifting) · knee sleeves · wrist wraps · straps · shoes · chalk · singlet

These change performance, not exercise availability. A belt does not gate any
exercise. **Exception:** `belt` as a *dip belt* is a real token — different item,
unfortunate collision. Renamed to `dip_belt`, a two-row fix in files 06 and 07.

---

## 17. Triage — what becomes a token

**A token earns its place if a gym plausibly has it while lacking others, AND its
absence removes exercises from the library that nothing else replaces.**

Both halves matter. A rope attachment fails the first test — every cable stack
has one. A yoke fails the second — nothing in the library needs it.

### 17.1 Core strength library — 35 tokens

Everything files 01–12 need. This is the set the validator should enforce today.

```
barbell      dumbbell      kettlebell    trap_bar      ez_bar
safety_bar   plate         landmine      platform      cable
rack         bench         box           slant_board   sled
sandbag      pullup_bar    dip_bar       dip_belt      parallettes
rings        suspension_trainer          bands         ab_wheel
stability_ball             med_ball      bodyweight
smith_machine              leg_press     hack_squat    belt_squat
leg_extension_machine      leg_curl_machine
plate_loaded               pec_deck      back_extension_bench
```

Changes from v1 of this document: `sandbag` promoted from skip to core (§11),
`belt` renamed `dip_belt`, `rings` and `parallettes` confirmed in.

### 17.2 Conditioning — 9 tokens, when files 13–14 land

```
air_bike     rower        ski_erg      treadmill    bike
stair_climber             battle_rope  jump_rope    wall_ball
```

Rucking excluded per Carey. `slam_ball` folds into `med_ball` unless slams get
their own rows.

### 17.3 Buy-dependent — 8 tokens, only if owned

```
farmers_handles   climbing_rope   sliders      weight_vest
wrist_roller      gripper         neck_harness tib_bar
```

### 17.4 Deliberately excluded

| Item | Why |
|---|---|
| Yoke, atlas stones, tire, keg, log | Don't own them; metadata would be invented |
| Cambered bar, buffalo bar, axle | Near-duplicates of tokens already present |
| Cable attachments (all) | Don't gate selection |
| Bosu, balance pad | No exercise in the library needs one |
| Foam roller, massage gun, mats, blocks | Recovery, not training |
| Lifting belt, sleeves, wraps, straps, chalk | Attire — changes performance, not availability |
| `machine` | Retired. Meant eleven things; see EQUIPMENT_VOCABULARY.md §1 |

**Total if everything lands: 52 tokens.** 35 now, 9 with conditioning, 8 on
purchase.

---

## 18. Ownership checklist — needs your yes/no

Gym profiles are guesses until this is answered, and the profiles are what the
validator uses to fail the build when a muscle group drops to zero survivors.

### 18.1 Home

| Item | Own? |
|---|---|
| Slant board | ✅ **yes** |
| Barbell + plates | ? |
| Rack or squat stands | ? |
| Adjustable bench | ? |
| Dumbbells (adjustable or fixed) | ? |
| Kettlebell(s) — and what weights | ? |
| Bands | ? |
| Pull-up bar | ? |
| Dip bars / parallettes | ? |
| Rings or suspension trainer — **which one** | ? |
| **Sandbag** | ? |
| **Ammo cans** — and what weight | ? |
| Sled | ? |
| Ab wheel | ? |
| Stability ball | ? |
| Box or step | ? |
| Med ball | ? |

### 18.2 Commercial gym — the four that change the most

| Item | Available? |
|---|---|
| Reverse hyper | ? |
| GHD / Nordic bench | ? |
| Belt squat | ? |
| Hack squat | ? |

Also useful: leg press, pec deck, Smith machine, captain's chair, cable
crossover, seated + standing calf machines.

### 18.3 What each answer decides

- **Rings vs. suspension trainer** — different rows, not different loads
- **Sandbag / ammo can** — gates the entire §11.3 movement list, ~8–10 rows in file 12
- **Kettlebell weights** — decides whether KB rows are prescribable or decorative
- **GHD / reverse hyper** — three Nordic-family rows currently claim `bodyweight|bench`, which is optimistic
- **Sled** — three live rows in `01_quads.csv` depend on it, and it's the best low-shear quad loading available
