/**
 * Derived warm-up ramp prescription (#72).
 *
 * Warm-ups are derived purely from the working setGroup and never added as
 * extra setGroups so they do not inflate session volume or fatigue budget.
 */

import { roundToLoadable } from './plate-math.js';

/**
 * Derive a warm-up ramp for a setGroup when `warmupRequired` is true.
 *
 * @param {object} setGroup
 * @param {object} [options]
 * @param {number|null} [options.workingWeight] resolved working load if 1RM is known
 * @param {number} [options.barWeight]
 * @param {number} [options.increment]
 * @param {'lb'|'kg'} [options.unit]
 * @returns {{ steps: Array<{ label: string, reps: number, weight: number|null }>, text: string }|null}
 */
export function prescribeWarmup(setGroup, {
  workingWeight = null,
  barWeight = 45,
  increment = 5,
  unit = 'lb'
} = {}) {
  if (!setGroup?.warmupRequired) return null;

  const w = Number(workingWeight);
  if (Number.isFinite(w) && w > barWeight) {
    const candidates = [
      { weight: barWeight, reps: 8 },
      { weight: roundToLoadable(w * 0.5, { increment, minWeight: barWeight }), reps: 5 },
      { weight: roundToLoadable(w * 0.7, { increment, minWeight: barWeight }), reps: 3 }
    ];
    if (w >= barWeight * 2.2) {
      candidates.push({
        weight: roundToLoadable(w * 0.85, { increment, minWeight: barWeight }),
        reps: 1
      });
    }

    // Deduplicate adjacent identical weights
    const steps = [];
    for (const c of candidates) {
      if (c.weight >= w) continue;
      if (!steps.length || steps[steps.length - 1].weight !== c.weight) {
        steps.push({ weight: c.weight, reps: c.reps, label: `${c.weight} ${unit} × ${c.reps}` });
      }
    }

    if (steps.length > 0) {
      return {
        steps,
        text: `Warm-up: ${steps.map((s) => s.label).join(' → ')}`
      };
    }
  }

  // Fallback when no working weight / 1RM is known (#72 + #47)
  const steps = [
    { weight: null, reps: 8, label: 'Light / Bar × 8 (RIR 6+)' },
    { weight: null, reps: 5, label: 'Moderate × 5 (RIR 5)' },
    { weight: null, reps: 3, label: 'Medium-Heavy × 3 (RIR 4)' }
  ];
  return {
    steps,
    text: `Warm-up: ${steps.map((s) => s.label).join(' → ')}`
  };
}
