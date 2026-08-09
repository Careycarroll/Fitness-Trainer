/**
 * Progression ALGORITHMS. Coefficients come from data/progression.json (ADR-012).
 *
 * Deload triggers live here rather than in data because they are a safety control: a dropped
 * key in JSON would silently disable them.
 */

/** Estimated 1RM from a logged set, adjusted for reps left in reserve (Epley-style). */
export function estimate1RM(weight, reps, rir, coefficient) {
  const effectiveReps = reps + Math.max(0, rir);
  return weight * (1 + coefficient * effectiveReps);
}

/** Best estimate across a history slice for one exercise. */
export function best1RM(history, exerciseId, coefficient) {
  const sets = history.filter((s) => s.exerciseId === exerciseId);
  if (sets.length === 0) return null;
  return Math.max(...sets.map((s) => estimate1RM(s.weight, s.reps, s.rir ?? 0, coefficient)));
}

/**
 * @returns {{action: 'increase'|'hold'|'deload', delta: number, reason: string}}
 */
export function nextLoad({ exercise, model, recentSessions, deloadTriggers }) {
  const stalls = countStalls(recentSessions);

  if (stalls >= deloadTriggers.consecutiveStallSessions) {
    return { action: 'deload', delta: model.deloadFraction ?? 0.9, reason: `${stalls} consecutive stalled sessions` };
  }
  const avgRir = mean(recentSessions.flatMap((s) => s.sets.map((x) => x.rir ?? 0)));
  if (recentSessions.length > 0 && avgRir < deloadTriggers.averageRirBelow) {
    return { action: 'deload', delta: model.deloadFraction ?? 0.9, reason: `average RIR ${avgRir.toFixed(2)} below floor` };
  }
  if (stalls >= (model.stallThresholdSessions ?? 2)) {
    return { action: 'hold', delta: 0, reason: 'stall threshold reached; repeat load' };
  }

  const lowerBody = ['squat', 'hinge', 'lunge'].includes(exercise.pattern);
  const increment = model.lowerBodyIncrementKg
    ? (lowerBody ? model.lowerBodyIncrementKg : model.upperBodyIncrementKg)
    : null;

  if (increment !== null) return { action: 'increase', delta: increment, reason: 'linear progression' };
  return { action: 'increase', delta: model.loadIncrementFraction ?? 0.025, reason: 'double progression: rep ceiling met' };
}

function countStalls(sessions) {
  let n = 0;
  for (let i = sessions.length - 1; i > 0; i--) {
    const cur = totalVolume(sessions[i]);
    const prev = totalVolume(sessions[i - 1]);
    if (cur <= prev) n++;
    else break;
  }
  return n;
}

const totalVolume = (s) => s.sets.reduce((acc, x) => acc + x.weight * x.reps, 0);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
