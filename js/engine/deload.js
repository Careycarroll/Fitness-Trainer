/**
 * Deload trigger evaluation (#70, ADR-012).
 *
 * Thresholds live in data/progression.json (`deloadTriggers`); this module
 * holds the trigger logic and FAILS CLOSED: an unevaluable trigger reports
 * `status: 'unevaluable'` with an explicit reason rather than `triggered: false`.
 */

/**
 * Evaluate all three deload triggers from `progression.deloadTriggers`.
 *
 * @param {object} deloadConfig `defs.progression.deloadTriggers`
 * @param {object} [inputs]
 * @param {Array<{ muscle: string, sets: number, mrv: number }>} [inputs.weeklyVolume]
 * @param {Array<number>} [inputs.recentRirs] RIR values from recent completed sets
 * @param {Array<{ exerciseId: string, exerciseName: string, values: number[] }>} [inputs.liftSeries]
 *        chronological session-best values within the active epoch
 * @returns {{ anyTriggered: boolean, triggers: Array<object> }}
 */
export function evaluateDeloadTriggers(deloadConfig, inputs = {}) {
  if (!deloadConfig || typeof deloadConfig !== 'object') {
    throw new Error('deloadTriggers config is required (fail closed)');
  }

  const triggers = [];

  // 1. weeklyVolumeOverMrvFraction
  const mrvFrac = deloadConfig.weeklyVolumeOverMrvFraction;
  if (typeof mrvFrac !== 'number') {
    triggers.push({
      id: 'weeklyVolumeOverMrvFraction',
      status: 'unevaluable',
      triggered: null,
      reason: 'Missing numeric weeklyVolumeOverMrvFraction threshold in progression.json.'
    });
  } else if (!Array.isArray(inputs.weeklyVolume) || inputs.weeklyVolume.length === 0) {
    triggers.push({
      id: 'weeklyVolumeOverMrvFraction',
      status: 'unevaluable',
      triggered: null,
      reason: 'No weekly muscle volume data available to compare against MRV.'
    });
  } else {
    const over = inputs.weeklyVolume
      .filter((m) => m.mrv > 0 && m.sets > m.mrv * mrvFrac)
      .map((m) => `${m.muscle} (${m.sets} > ${Number((m.mrv * mrvFrac).toFixed(1))})`);
    triggers.push({
      id: 'weeklyVolumeOverMrvFraction',
      status: 'evaluated',
      triggered: over.length > 0,
      reason: over.length > 0
        ? `Weekly sets exceed ${Math.round(mrvFrac * 100)}% MRV on: ${over.join(', ')}.`
        : `All muscles are within ${Math.round(mrvFrac * 100)}% of MRV.`
    });
  }

  // 2. averageRirBelow
  const rirFloor = deloadConfig.averageRirBelow;
  if (typeof rirFloor !== 'number') {
    triggers.push({
      id: 'averageRirBelow',
      status: 'unevaluable',
      triggered: null,
      reason: 'Missing numeric averageRirBelow threshold in progression.json.'
    });
  } else {
    const rirs = (inputs.recentRirs || []).filter((r) => typeof r === 'number' && Number.isFinite(r));
    if (rirs.length === 0) {
      triggers.push({
        id: 'averageRirBelow',
        status: 'unevaluable',
        triggered: null,
        reason: 'No RIR values have been logged on recent sets.'
      });
    } else {
      const avg = rirs.reduce((a, b) => a + b, 0) / rirs.length;
      const fired = avg < rirFloor;
      triggers.push({
        id: 'averageRirBelow',
        status: 'evaluated',
        triggered: fired,
        averageRir: Number(avg.toFixed(2)),
        reason: fired
          ? `Recent average RIR (${avg.toFixed(2)}) is below ${rirFloor}.`
          : `Recent average RIR (${avg.toFixed(2)}) is at or above ${rirFloor}.`
      });
    }
  }

  // 3. consecutiveStallSessions
  const stallLimit = deloadConfig.consecutiveStallSessions;
  if (typeof stallLimit !== 'number' || stallLimit < 1) {
    triggers.push({
      id: 'consecutiveStallSessions',
      status: 'unevaluable',
      triggered: null,
      reason: 'Missing valid consecutiveStallSessions threshold in progression.json.'
    });
  } else {
    const series = (inputs.liftSeries || []).filter((l) => Array.isArray(l.values) && l.values.length > stallLimit);
    if (series.length === 0) {
      triggers.push({
        id: 'consecutiveStallSessions',
        status: 'unevaluable',
        triggered: null,
        reason: `Need more than ${stallLimit} logged sessions on at least one lift to assess stalling.`
      });
    } else {
      const stalled = [];
      for (const lift of series) {
        let bestSoFar = lift.values[0];
        let streak = 0;
        for (let i = 1; i < lift.values.length; i++) {
          if (lift.values[i] <= bestSoFar) {
            streak += 1;
          } else {
            bestSoFar = lift.values[i];
            streak = 0;
          }
        }
        if (streak >= stallLimit) {
          stalled.push(`${lift.exerciseName || lift.exerciseId} (${streak} sessions)`);
        }
      }
      triggers.push({
        id: 'consecutiveStallSessions',
        status: 'evaluated',
        triggered: stalled.length > 0,
        reason: stalled.length > 0
          ? `Performance stalled for ${stallLimit}+ sessions on: ${stalled.join(', ')}.`
          : `No lift has stalled for ${stallLimit}+ consecutive sessions.`
      });
    }
  }

  return {
    anyTriggered: triggers.some((t) => t.triggered === true),
    triggers
  };
}
