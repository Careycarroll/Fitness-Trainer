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
 * @returns {Array<{exercise: object, score: number}>} ranked ascending
 */
export function rankSubstitutes(target, catalog, weights, profile, limit = 5) {
  return catalog
    .map((c) => ({ exercise: c, score: score(target, c, weights, profile) }))
    .filter((r) => Number.isFinite(r.score))
    .sort((a, b) => a.score - b.score || a.exercise.id.localeCompare(b.exercise.id))
    .slice(0, limit);
}
