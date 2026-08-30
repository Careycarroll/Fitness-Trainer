/**
 * Controlled vocabularies. ADR-026: these widened to the CATALOG's vocabulary
 * rather than the catalog being downcast to these.
 *
 * The catalog is 285 hand-calibrated rows; this file is five arrays. Widening
 * moves the cost to the cheap side, and it preserves the distinctions ADR-018
 * (muscle admission test) and ADR-021 (machine split) were written to create.
 */

// snake_case, matching data/exercises/*.csv.
//
// RETIRED: `gymnastic` — no catalog rows; returns with M9 if CrossFit lands.
//          `olympic`   — the catalog files Olympic lifts as `explosive`.
// DEFERRED: `monostructural` is listed here because splits.json references it,
//          but it has zero rows until M7. See _deferred.js.
export const PATTERNS = [
  'squat', 'lunge', 'hinge',
  'push_h', 'push_v', 'pull_h', 'pull_v',
  'carry', 'core', 'isolation', 'explosive', 'locomotion',
  'monostructural'
];

export const LOAD_TYPES = [
  'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable',
  'bodyweight', 'band', 'implement', 'none'
];

export const SCORING = ['load', 'time', 'both'];

// 22 tokens. `back` -> lats/mid_back/upper_back (+ traps, erectors, which were
// already separate); `shoulders` -> three delt heads; `lowerBack` -> erectors.
//
// Every one of these passes ADR-018: you would program it while deliberately
// excluding its parent. Collapsing them back would double-count volume and
// leave the generator unable to know that overhead pressing does nothing for
// rear delts.
export const MUSCLES = [
  // lower
  'quads', 'hamstrings', 'glutes', 'adductors', 'abductors', 'calves',
  'hip_flexors',
  // posterior chain / back
  'erectors', 'lats', 'mid_back', 'upper_back', 'traps',
  // push
  'chest', 'triceps', 'front_delts', 'side_delts', 'rear_delts',
  // arms / trunk / other
  'biceps', 'forearms', 'abs', 'obliques', 'neck',
  // engine-only: whole-body cost with no catalog rows of its own
  'systemic'
];

export const DOMAINS = ['load', 'time'];

/**
 * EQUIPMENT — the declared vocabulary (#58).
 *
 * The only vocabulary in this project that had no enum. Validation was
 * circular: check 06 asserts every CATALOG token appears in some PROFILE, and
 * nothing asserted the reverse, so profiles WERE the vocabulary. A typo in
 * data/exercises/*.csv became legitimate the moment the same typo reached
 * equipment.json, and build_seed.py does not validate the column at all --
 * split_tokens() splits on `|` and passes the pieces through.
 *
 * `rings` is the proof: owned by home-garage, used by no exercise, and neither
 * direction of validation looked.
 *
 * Check 13 enforces both subset relations. Declared-but-unused is LEGAL and
 * REPORTED, never failed -- it lets the vocabulary name equipment the catalog
 * has not caught up with without pretending those tokens do anything yet.
 *
 * THIS LIST GROWS WITH THE ROWS THAT USE IT. A speculative token is
 * unenforceable: it cannot be checked for reachability, and ticking its box
 * changes nothing. The bulk import adds a token in the same commit as the
 * exercises that need it.
 */
export const EQUIPMENT = [
  // free weights and bars
  'barbell', 'dumbbell', 'kettlebell', 'ez_bar', 'trap_bar', 'safety_bar',
  'plate', 'med_ball',
  'bodyweight',              // the null-equipment token; never remove

  // supports and structures
  'bench',                   // flat/incline/decline all ride on this: one
                             // adjustable bench does every angle, so the
                             // distinction is exercise identity, not ownership
  'rack', 'platform', 'box', 'pullup_bar', 'dip_bar', 'dip_belt',
  'back_extension_bench',    // 45-degree hyperextension bench
  'captains_chair',          // vertical knee-raise station
  'slant_board', 'stability_ball', 'ab_wheel', 'suspension_trainer',
  'rings',                   // owned by home-garage, used by nothing yet.
                             // The reason this file exists.
  'parallettes',             // declared because build_seed.py's
  'sandbag',                 // LOAD_TYPE_PRECEDENCE already names these two,
                             // and two lists that disagree is the defect this
                             // enum exists to prevent

  // resistance
  'bands',                   // ONE token. Type, size and resistance are all
                             // quantity, which ADR-014 excludes outright.
  'cable',                   // an adjustable column or crossover, NOT a
                             // catch-all for every stack-loaded machine

  // machines, named by function
  'smith_machine', 'leg_press', 'hack_squat', 'belt_squat',
  'leg_curl_machine', 'leg_extension_machine', 'calf_machine',
  'hip_abductor_machine', 'pec_deck', 'landmine', 'sled',

  // Stations. `plate_loaded` was removed here: it named a loading mechanism
  // rather than an implement, so it could not answer "can you perform this?".
  // A pulldown is a pulldown whether the stack is pin- or plate-loaded --
  // micro-loading is quantity, which ADR-014 excludes. Under isPerformable()'s
  // AND semantics there was no way to write "cable OR plate-loaded" on one row
  // anyway, so a station token is the only expressible answer.
  'lat_pulldown', 'seated_row', 'chest_supported_row',
  'chest_press_machine',
  'incline_press_machine',   // SPLIT from chest_press_machine deliberately. An
                             // adjustable bench does every angle, so `bench`
                             // stays one token -- but a flat-only machine
                             // genuinely cannot do incline, and merging the two
                             // would prescribe incline to a gym that has no
                             // machine for it.
  'shoulder_press_machine', 'lateral_raise_machine', 'preacher_curl_machine',
  'triceps_extension_machine', 'ab_crunch_machine', 'hip_thrust_machine',

  // conditioning
  'treadmill', 'stationary_bike', 'air_bike', 'rower', 'ski_erg', 'elliptical',
  'stair_climber', 'jump_rope', 'heavy_bag', 'battle_ropes'
];

/**
 * A rename in flight. MIGRATION TOOL, NOT A COMPATIBILITY LAYER.
 *
 * Each entry names the issue that removes it. Check 13 enforces the properties
 * that keep an alias temporary: the key must not also be canonical, the target
 * must be declared, and no catalog row or profile may still carry the key.
 *
 * EMPTY TODAY, so those rules are unexercised -- check 13 says so on every run
 * rather than passing quietly. The first use is the bulk import, where
 * pullup_bar -> pull_up_bar becomes a declared, migrated, verified change
 * instead of eight silently stranded exercises.
 *
 * `plate_loaded` is NOT aliased and cannot be: an alias is 1:1 and that token
 * maps to nine different stations depending on the row. It is retagged row by
 * row and then deleted from EQUIPMENT.
 */
export const EQUIPMENT_ALIASES = {};

/**
 * VARIANT AXES (#63) — what makes one variation of a movement different from
 * another.
 *
 * These replace the single `emphasis` column, which carried FIVE unrelated axes
 * in one string: ROM position, press angle, muscle head, bar position and grip
 * width. Nothing read it, and nothing could: `flat` and `stretch_bias` are both
 * true of different rows and are not comparable, so no scoring term could rank
 * them. It was lossy too — an incline curl is long-head biased AND
 * stretch-biased, and one field held one value.
 *
 * NULL MEANS NOT ASSESSED, never "neutral". A row with no `angle` is not a flat
 * press; it is a row where angle does not apply or has not been judged. Any
 * consumer must treat null as "no opinion" rather than as a value.
 *
 * Same growth rule as EQUIPMENT: these lists grow with the rows that use them.
 * A speculative value is unenforceable.
 */
export const ROM_BIAS = ['stretch', 'shortened'];
export const ANGLE = ['flat', 'incline', 'decline', 'overhead'];
export const GRIP = ['close', 'wide'];
export const HEAD_BIAS = ['long', 'short'];

/**
 * STABILITY is an ORDINAL 1-5, DERIVED in build_seed.py rather than authored.
 *
 *   1 fixed_path · 2 guided · 3 free · 4 independent · 5 unstable
 *
 * Ordinal because `emphasis` proved the cost of categorical: five values on
 * five axes could not be ranked, so nothing read them. A scale can be ranked.
 */
export const STABILITY_MIN = 1;
export const STABILITY_MAX = 5;
