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
