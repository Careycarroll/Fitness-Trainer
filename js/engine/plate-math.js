/**
 * Loadable increment rounding (#17) and per-side plate math (#73).
 *
 * Pure, deterministic, DOM-free.
 */

export const DEFAULT_PLATES_LB = [45, 35, 25, 10, 5, 2.5];
export const DEFAULT_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

/**
 * Return plate inventory appropriate for a given total bar increment (#112).
 * Supports standard 5 lb / 2.5 lb per-side plates down to 0.25 lb micro plates.
 */
export function platesForIncrement(increment = 5, unit = 'lb') {
  const base = unit === 'kg' ? [...DEFAULT_PLATES_KG] : [...DEFAULT_PLATES_LB];
  const perSide = Number(increment) / 2;
  const extras = unit === 'kg'
    ? [1.25, 0.5, 0.25]
    : [1.25, 0.5, 0.25];
  for (const p of extras) {
    if (perSide <= p + 1e-6 && !base.includes(p)) base.push(p);
  }
  return base.sort((a, b) => b - a);
}

const BAR_WEIGHTS_LB = {
  safety_bar: 65,
  barbell: 45,
  trap_bar: 45,
  ez_bar: 25
};

const BAR_WEIGHTS_KG = {
  safety_bar: 25,
  barbell: 20,
  trap_bar: 20,
  ez_bar: 10
};

const PLATE_LOADED_TOKENS = new Set(['barbell', 'ez_bar', 'safety_bar', 'trap_bar', 'plate_loaded']);

/**
 * True only for plate-loaded barbell/specialty-bar implements.
 * Dumbbells, cables, machines, and bodyweight return false.
 */
export function isPlateLoaded(exercise) {
  if (!exercise) return false;
  if (PLATE_LOADED_TOKENS.has(exercise.loadType)) return true;
  return (exercise.equipment || []).some((tok) => PLATE_LOADED_TOKENS.has(tok));
}

/**
 * Determine bar weight from exercise equipment tokens.
 */
export function barWeightFor(exercise, { unit = 'lb', barWeight = null, barWeights = null } = {}) {
  if (barWeight !== null && barWeight !== undefined && Number(barWeight) > 0) {
    return Number(barWeight);
  }
  const defaults = unit === 'kg' ? BAR_WEIGHTS_KG : BAR_WEIGHTS_LB;
  const table = barWeights ? { ...defaults, ...barWeights } : defaults;
  for (const tok of exercise?.equipment || []) {
    if (table[tok] !== undefined && Number(table[tok]) > 0) return Number(table[tok]);
  }
  if (exercise?.loadType && table[exercise.loadType] !== undefined && Number(table[exercise.loadType]) > 0) {
    return Number(table[exercise.loadType]);
  }
  return Number(table.barbell ?? (unit === 'kg' ? 20 : 45));
}

/**
 * Round a prescribed weight to the nearest loadable increment (#17).
 *
 * @param {number} targetWeight
 * @param {object} [options]
 * @param {number} [options.increment] smallest total jump (e.g. 5 lb = 2.5 lb/side)
 * @param {number} [options.minWeight] floor weight (e.g. bar weight)
 * @returns {number}
 */
export function roundToLoadable(targetWeight, { increment = 5, minWeight = 0 } = {}) {
  const w = Number(targetWeight);
  const inc = Math.max(0.25, Number(increment || 5));
  if (!Number.isFinite(w) || w <= 0) return minWeight;
  const rounded = Math.round(w / inc) * inc;
  return Math.max(minWeight, Number(rounded.toFixed(2)));
}

/**
 * Decompose a target barbell weight into per-side plates (#73).
 * Fails explicitly (`achievable: false`) if the weight cannot be built from
 * the available plates rather than silently rounding.
 */
export function computePlateLoad(targetWeight, {
  barWeight = 45,
  plates = DEFAULT_PLATES_LB,
  unit = 'lb'
} = {}) {
  const target = Number(targetWeight);
  const bar = Number(barWeight);
  if (!Number.isFinite(target) || target <= 0) {
    return { achievable: false, reason: 'No target weight', barWeight: bar, perSide: [], total: 0, formatted: '' };
  }
  if (target < bar - 1e-6) {
    return {
      achievable: false,
      reason: `Target ${target} ${unit} is below bar weight (${bar} ${unit})`,
      barWeight: bar,
      perSide: [],
      total: target,
      formatted: ''
    };
  }
  if (Math.abs(target - bar) < 1e-6) {
    return {
      achievable: true,
      barWeight: bar,
      perSide: [],
      total: bar,
      formatted: `${bar} ${unit} bar only`
    };
  }

  let rem = (target - bar) / 2;
  const sortedPlates = [...plates].map(Number).filter((p) => p > 0).sort((a, b) => b - a);
  const perSide = [];

  for (const plate of sortedPlates) {
    if (rem + 1e-6 >= plate) {
      const count = Math.floor((rem + 1e-6) / plate);
      if (count > 0) {
        perSide.push({ plate, count });
        rem -= count * plate;
      }
    }
  }

  if (Math.abs(rem) > 1e-4) {
    return {
      achievable: false,
      reason: `Cannot load ${target} ${unit} evenly on a ${bar} ${unit} bar with available plates`,
      barWeight: bar,
      perSide: [],
      total: target,
      remainderPerSide: Number(rem.toFixed(3)),
      formatted: ''
    };
  }

  const parts = [];
  for (const { plate, count } of perSide) {
    for (let i = 0; i < count; i++) parts.push(String(plate));
  }

  return {
    achievable: true,
    barWeight: bar,
    perSide,
    total: target,
    formatted: `${bar} bar + ${parts.join(', ')} /side`
  };
}
