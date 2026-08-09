/**
 * Load-domain generator: sets x reps x %1RM.
 * Serves powerlifting, bodybuilding, strength, core.
 *
 * ADR-010: this is one of exactly two generators. Styles differ from each other only in the
 * PARAMETERS read from styles.json. If a proposed style needs a branch added here that is
 * specific to that style, it is a different shape and belongs in its own generator.
 */
import { createRng, shuffle } from './rng.js';
import { filterByGates } from './safety.js';
import { isAvailable } from './substitution.js';

export const DOMAIN = 'load';

export function generateSession({ style, day, catalog, profile, request, dayIndex }) {
  const rng = createRng(request.seed + dayIndex * 7919);
  const ctx = request.athlete ?? { skillLevel: 2, hasCoaching: false, strictReps: {} };

  const available = catalog.filter(
    (e) => isAvailable(e, profile) && (e.scoring === 'load' || e.scoring === 'both')
  );
  const { allowed, blocked } = filterByGates(available, ctx);

  const blocks = [];
  let fatigueUsed = 0;
  const usedIds = new Set();

  for (const [i, pattern] of day.patterns.entries()) {
    const emphasis = style.patternEmphasis[pattern] ?? 0;
    if (emphasis === 0) continue;

    const candidates = shuffle(rng, allowed.filter((e) => e.pattern === pattern && !usedIds.has(e.id)))
      .sort((a, b) => b.fatigueCost - a.fatigueCost);
    if (candidates.length === 0) continue;

    const isMain = i === 0 || (i === 1 && emphasis >= 0.8);
    const exercise = isMain ? candidates[0] : candidates[candidates.length - 1];

    if (fatigueUsed + exercise.fatigueCost > style.fatigueBudget) continue;
    fatigueUsed += exercise.fatigueCost;
    usedIds.add(exercise.id);

    blocks.push(prescribe({ exercise, style, isMain, emphasis, rng }));
  }

  return {
    domain: DOMAIN,
    label: day.label,
    styleId: style.id,
    blocks,
    fatigueUsed,
    fatigueBudget: style.fatigueBudget,
    blockedByGates: blocked.filter((b) => b.reason).map((b) => ({ id: b.exercise.id, reason: b.reason }))
  };
}

function prescribe({ exercise, style, isMain, emphasis, rng }) {
  const { min: repMin, max: repMax } = style.repRange;
  const { min: intMin, max: intMax } = style.intensityBand;
  const { min: setMin, max: setMax } = style.setsPerMainLift;

  // Main work sits at the heavy/low-rep end of the style band; accessories at the light end.
  const t = isMain ? 0.15 + rng() * 0.25 : 0.6 + rng() * 0.35;
  const reps = Math.round(repMin + (repMax - repMin) * t);
  const intensity = round(intMax - (intMax - intMin) * t, 2);
  const sets = isMain
    ? Math.round(setMin + (setMax - setMin) * emphasis)
    : Math.max(2, setMin - 1);

  return {
    exerciseId: exercise.id,
    name: exercise.name,
    role: isMain ? 'main' : 'accessory',
    sets,
    reps,
    intensityOf1RM: intensity,
    rir: exercise.defaultRIR,
    restSeconds: isMain ? style.restSeconds.main : style.restSeconds.accessory,
    warmupRequired: exercise.warmupRequired,
    unilateral: exercise.unilateral
  };
}

const round = (n, dp) => Number(n.toFixed(dp));
