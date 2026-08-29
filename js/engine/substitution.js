/**
 * Substitution: resolve by pattern + equipment, ranked by coefficient-weighted distance.
 *
 * Per-exercise `substitutes: []` arrays were rejected: they are O(n^2) to maintain by hand and
 * silently rot on every catalog addition. Matching on `pattern` and ranking by nearest
 * fatigue/skill/muscle profile scales for free as M4 grows the catalog.
 *
 * ADR-012: the coefficients are data (substitution-weights.json); this ranking is code.
 */

// #41: availability is defined once, in coverage.js. Re-exported here so the two
// generators keep importing it from where they always have.
export { isAvailable } from './coverage.js';
import { isAvailable } from './coverage.js';

/** Lower is better. Infinity-ish scores mean "not a substitute at all". */
export function score(target, candidate, weights, profile) {
  if (candidate.id === target.id) return Number.POSITIVE_INFINITY;

  let s = 0;
  if (candidate.pattern !== target.pattern) s += weights.patternMismatch;
  if (profile && !isAvailable(candidate, profile)) s += weights.equipmentUnavailable;
  if (!domainsCompatible(target.scoring, candidate.scoring)) s += weights.scoringDomainMismatch;

  s += Math.abs(candidate.fatigueCost - target.fatigueCost) * weights.fatigueCostDelta;
  s += Math.abs(candidate.skill - target.skill) * weights.skillDelta;

  for (const m of target.primaryMuscles) {
    if (!candidate.primaryMuscles.includes(m)) s += weights.primaryMuscleMissing;
  }
  for (const m of target.secondaryMuscles) {
    if (!candidate.secondaryMuscles.includes(m) && !candidate.primaryMuscles.includes(m)) {
      s += weights.secondaryMuscleMissing;
    }
  }

  if (candidate.loadType !== target.loadType) s += weights.loadTypeChange;
  if (candidate.unilateral !== target.unilateral) s += weights.unilateralMismatch;

  return s;
}

function domainsCompatible(a, b) {
  if (a === 'both' || b === 'both') return true;
  return a === b;
}

/**
 * Does this candidate train anything the target trains? — #52.
 *
 * rankSubstitutes returned `limit` rows whether or not they were substitutes,
 * so where the pool was thin it padded with whatever scored least badly:
 *
 *     cable-triceps-pushdown -> band-curl       (triceps vs biceps)
 *     standing-calf-raise    -> tibialis-raise  (the antagonist)
 *
 * A score CEILING cannot separate these. band-curl scores 29; back-squat ->
 * leg-press, a good substitute, scores 32. Any threshold that rejects the first
 * rejects the second. The scores overlap, so the instrument is wrong.
 *
 * A shared primary muscle is a RULE rather than a tuned number, and it was
 * measured before being kept: across the whole catalog at commercial-gym it
 * keeps 1378 pairs and drops 157, with ZERO drops on squat, hinge, push_h,
 * push_v, pull_h or core. It fires only on isolation, explosive, locomotion,
 * carry, monostructural and pull_v — exactly the thin pools where score() had
 * run out of real candidates.
 *
 * NOT keyed on exerciseFamily, which was the original proposal and is wrong in
 * both directions: `wall-sit` and `jump-squat` are in the squat family and
 * substitute for nothing, while `leg-press` and `belt-squat` are NOT in it and
 * are exactly what you want when the rack is taken.
 */
const sharesPrimaryMuscle = (target, candidate) =>
  (target.primaryMuscles ?? []).some((m) => (candidate.primaryMuscles ?? []).includes(m));

/**
 * @returns {Array<{exercise: object, score: number}>} ranked ascending
 */
export function rankSubstitutes(target, catalog, weights, profile, limit = 5) {
  return catalog
    .map((c) => ({ exercise: c, score: score(target, c, weights, profile) }))
    .filter((r) => Number.isFinite(r.score))
    // Fewer results beats padding with something that trains a different muscle.
    .filter((r) => sharesPrimaryMuscle(target, r.exercise))
    .sort((a, b) => a.score - b.score || a.exercise.id.localeCompare(b.exercise.id))
    .slice(0, limit);
}
