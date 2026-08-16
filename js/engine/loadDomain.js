/**
 * Load-domain generator: sets x reps x %1RM.
 * Serves powerlifting, bodybuilding, strength, core.
 *
 * ADR-010: this is one of exactly two generators. Styles differ from each other only in the
 * PARAMETERS read from styles.json. If a proposed style needs a branch added here that is
 * specific to that style, it is a different shape and belongs in its own generator.
 *
 * ADR-027: emits blocks holding an ordered list of setGroups.
 *
 * Selection changed here, and the reason is worth stating plainly: the previous
 * rule was `sort by fatigueCost, take candidates[0] for main and
 * candidates[last] for everything else`. With 123 catalog rows at fatigueCost 1,
 * "last" always resolved to a cost-1 row — so a powerlifting day came out at
 * 5+1+1+1 = 8 of a 22 budget. The budget could not bind, and accessory choice
 * carried no information: a band shrug and a Romanian deadlift were
 * interchangeable to it, because only the cost was ever consulted.
 *
 * Two changes replace it:
 *
 *   1. SCORED selection. Candidates are ranked by style emphasis, how well the
 *      cost fits the budget still to spend, and penalties for repeating a family
 *      or pattern. An accessory is now chosen because the style weights its
 *      pattern, not because it is the cheapest row that matched.
 *
 *   2. An accessory FILL pass. Pass 1 covers the split's patterns; pass 2 keeps
 *      adding work until `exercisesPerSession` is met or the budget is spent.
 *      `accessoryRatio` — declared in styles.json since M3 and read by nothing —
 *      is what steers which patterns pass 2 returns to.
 *
 * Both passes call the same `pick()`. A session is not two kinds of thing.
 *
 * A split day may also declare `muscles`. Patterns alone cannot express a
 * body-part split: "Chest & Triceps" and "Shoulders & Arms" are both
 * `push_h, push_v, isolation`, so the engine drew them from one pool and they
 * differed only by seed. The same defect sat in ppl-6, where Push A and Push B
 * were identical days under different labels.
 *
 * `muscles` WEIGHTS selection, it does not filter it. A thin equipment profile
 * must still produce a session rather than an empty day, which is the same
 * reasoning the substitution map follows (ADR-022). The field is optional, and
 * a day without it scores exactly as before — the term is +0 for every
 * candidate, so existing splits are provably unchanged.
 */
import { createRng, shuffle } from './rng.js';
import { filterByGates } from './safety.js';
import { isAvailable } from './substitution.js';
import { straightBlock } from './blocks.js';

export const DOMAIN = 'load';

/** Used when a style omits exercisesPerSession. */
const DEFAULT_COUNT = { min: 4, max: 6 };

/**
 * At most one exercise this expensive per session. Squat at 5 plus deadlift at 5
 * passes a 22-point budget arithmetically, and no competent coach programs it.
 * The real constraint is recovery ACROSS days, which needs logged history and is
 * M8 — until then this is the honest stand-in. It lives in code rather than
 * styles.json because it is a safety-adjacent rule that must fail closed
 * (ADR-012), not a style parameter.
 */
const MAX_TOP_COST = 5;
const MAX_TOP_COST_COUNT = 1;

export function generateSession({ style, day, catalog, profile, request, dayIndex }) {
  const rng = createRng(request.seed + dayIndex * 7919);
  const ctx = request.athlete ?? { skillLevel: 2, hasCoaching: false, strictReps: {} };

  const available = catalog.filter(
    (e) => isAvailable(e, profile) && (e.scoring === 'load' || e.scoring === 'both')
  );
  const { allowed, blocked } = filterByGates(available, ctx);

  // Optional (see header). Empty set => every muscle term below is +0.
  const dayMuscles = new Set(day.muscles ?? []);

  const count = style.exercisesPerSession ?? DEFAULT_COUNT;
  // An explicit request wins over the style default, clamped to something a
  // session can hold. Asking for 20 does not make 20 appear — omitted[] will say
  // the budget stopped it.
  const target = clamp(request.exerciseCount ?? count.max, 1, 14);

  const state = {
    blocks: [],
    omitted: [],
    fatigueUsed: 0,
    usedIds: new Set(),
    usedFamilies: new Map(),   // family  -> times used
    usedPatterns: new Map(),   // pattern -> times used
    topCostUsed: 0
  };

  // -----------------------------------------------------------------------
  // Pass 1 — pattern coverage. The split is the skeleton (ADR-015): every
  // pattern the day asks for gets a slot before anything else is added.
  // -----------------------------------------------------------------------
  for (const [i, pattern] of day.patterns.entries()) {
    const emphasis = style.patternEmphasis[pattern] ?? 0;
    if (emphasis === 0) {
      state.omitted.push({ pattern, reason: 'style-emphasis-zero' });
      continue;
    }

    // "Main" is positional: first slot, or second when the style leans hard on
    // that pattern. A style that allows pattern repeats treats the repeat as
    // main too — back squat then pause squat is main + variation, not an
    // accessory that happens to squat.
    const repeated = (state.usedPatterns.get(pattern) ?? 0) > 0;
    const isMain = i === 0
      || (i === 1 && emphasis >= 0.8)
      || (repeated && style.allowPatternRepeat === true);

    const chosen = pick({
      pool: allowed, pattern, style, state, rng, isMain, dayMuscles,
      slotsLeft: Math.max(1, target - state.blocks.length)
    });

    if (!chosen) {
      state.omitted.push({
        pattern,
        reason: cheapestCost(allowed, pattern, state) === null
          ? 'no-unused-candidates'
          : 'fatigue-budget-exhausted',
        remaining: style.fatigueBudget - state.fatigueUsed
      });
      continue;
    }

    commit(state, chosen, style, { isMain, emphasis, rng });
  }

  // -----------------------------------------------------------------------
  // Pass 2 — accessory fill. Pass 1 leaves roughly a third of the budget
  // unspent, because a split names 4 patterns and a real session holds more
  // work than that. This is where accessoryRatio finally means something.
  // -----------------------------------------------------------------------
  let guard = 40;   // pick() is monotonic and the pool is finite; still, never spin
  while (state.blocks.length < target && guard-- > 0) {
    const pattern = nextAccessoryPattern(style, state, allowed, dayMuscles, day.patterns);
    if (!pattern) break;

    const chosen = pick({
      pool: allowed, pattern, style, state, rng, isMain: false, dayMuscles,
      slotsLeft: Math.max(1, target - state.blocks.length)
    });

    if (!chosen) {
      // Report the COUNT shortfall once. The split's own patterns were already
      // covered or already explained in pass 1.
      state.omitted.push({
        pattern: null,
        reason: 'count-not-reachable',
        requested: target,
        placed: state.blocks.length,
        remaining: style.fatigueBudget - state.fatigueUsed
      });
      break;
    }

    commit(state, chosen, style, {
      isMain: false,
      emphasis: style.patternEmphasis[pattern] ?? 0,
      rng
    });
  }

  return {
    domain: DOMAIN,
    label: day.label,
    styleId: style.id,
    blocks: state.blocks,
    omitted: state.omitted,
    exercisesRequested: target,
    exercisesPlaced: state.blocks.length,
    fatigueUsed: state.fatigueUsed,
    fatigueBudget: style.fatigueBudget,
    blockedByGates: blocked.filter((b) => b.reason).map((b) => ({ id: b.exercise.id, reason: b.reason }))
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Score every legal candidate for one slot; return the best, or null when
 * nothing fits. Returning null rather than relaxing a constraint is deliberate:
 * a session short one movement that says why beats one that quietly substituted
 * something the style does not program (ADR-014).
 */
function pick({ pool, pattern, style, state, rng, isMain, slotsLeft, dayMuscles }) {
  const remaining = style.fatigueBudget - state.fatigueUsed;

  const legal = pool.filter((e) => {
    if (e.pattern !== pattern) return false;
    if (state.usedIds.has(e.id)) return false;
    if (e.fatigueCost > remaining) return false;
    if (e.fatigueCost >= MAX_TOP_COST && state.topCostUsed >= MAX_TOP_COST_COUNT) return false;
    return true;
  });
  if (legal.length === 0) return null;

  // Shuffle before scoring so equal scores break by seed rather than by catalog
  // order — otherwise every strength session opens with whichever squat row sits
  // earliest in 01_quads.csv.
  let best = null;
  let bestScore = -Infinity;
  for (const e of shuffle(rng, legal)) {
    const s = score({ exercise: e, pattern, style, state, isMain, remaining, slotsLeft, dayMuscles });
    if (s > bestScore) { bestScore = s; best = e; }
  }
  return best;
}

/**
 * Deliberately few terms. This is the function to tune when output looks wrong,
 * and one with fifteen weights cannot be reasoned about from a generated session.
 */
function score({ exercise, pattern, style, state, isMain, remaining, slotsLeft, dayMuscles }) {
  const emphasis = style.patternEmphasis[pattern] ?? 0;
  const muscles = muscleFit(exercise, dayMuscles);

  // Main work wants the heaviest legal thing: it is the point of the session.
  // The muscle term is weighted to outrank ONE step of fatigueCost, so a chest
  // day opens with a bench rather than whichever push_h row happens to cost
  // most. Two steps still win, because a body-part label must not turn the
  // main lift into an isolation movement.
  if (isMain) {
    return exercise.fatigueCost * 10 + emphasis * 2 + muscles * 8
      - familyPenalty(state, exercise) * 3;
  }

  // Accessories aim to SPEND the remaining budget across the remaining slots
  // rather than minimise cost. Without this term the fill pass stacks cost-1 rows
  // and finishes at half budget — the exact bug this rewrite exists to fix.
  const targetCost = clamp(remaining / slotsLeft, 1, 4);
  const fatigueFit = 1 - Math.abs(exercise.fatigueCost - targetCost) / 4;

  return (
    emphasis * 4 +
    muscles * 5 +
    fatigueFit * 3 -
    familyPenalty(state, exercise) * 3 -
    patternPenalty(state, pattern, style) * 2 +
    // A nudge toward compounds among accessories, not a filter: an isolation row
    // is a legitimate accessory.
    ((exercise.primaryMuscles?.length ?? 0) > 1 ? 0.5 : 0)
  );
}

/**
 * How well this row serves the day's declared muscles: the share of its primary
 * muscles the day named, plus a quarter-credit for secondaries. Zero when the
 * day declares none, which is what makes the field inert where unused.
 */
function muscleFit(exercise, dayMuscles) {
  if (!dayMuscles || dayMuscles.size === 0) return 0;
  const primary = exercise.primaryMuscles ?? [];
  if (primary.length === 0) return 0;
  const secondary = exercise.secondaryMuscles ?? [];
  const hitPrimary = primary.filter((m) => dayMuscles.has(m)).length / primary.length;
  const hitSecondary = secondary.length
    ? secondary.filter((m) => dayMuscles.has(m)).length / secondary.length
    : 0;
  return clamp(hitPrimary + hitSecondary * 0.25, 0, 1);
}

/**
 * Repeating a family prescribes the same movement twice under different names —
 * goblet squat and heels-elevated goblet squat are one exercise with a wedge
 * under the heels. This is what exercise_family was authored for (ADR-026).
 */
const familyPenalty = (state, exercise) =>
  state.usedFamilies.get(exercise.exerciseFamily ?? exercise.id) ?? 0;

/**
 * Repeating a PATTERN is a real programming choice, not an error: back squat then
 * pause squat is how powerlifting trains a weak position. So it is a cost a style
 * can afford rather than a prohibition, and styles that should not do it pay double.
 */
const patternPenalty = (state, pattern, style) => {
  const used = state.usedPatterns.get(pattern) ?? 0;
  if (used === 0) return 0;
  return style.allowPatternRepeat === true ? used : used * 2;
};

/**
 * Which pattern the fill pass reaches for next: highest style emphasis,
 * discounted by how much of the session already trains it. `accessoryRatio`
 * scales the discount — bodybuilding at 0.60 keeps returning to its emphasised
 * patterns for volume, powerlifting at 0.30 spreads out instead of adding a
 * fourth squat.
 */
function nextAccessoryPattern(style, state, pool, dayMuscles, dayPatterns) {
  const ratio = style.accessoryRatio ?? 0.4;
  // The fill may only choose patterns THE DAY DECLARES (SPEC.md: muscles weight
  // selection within the day's own patterns; they never filter). Ranking all of
  // style.patternEmphasis let an unused 0.9 pattern outscore a declared one that
  // pass 1 had already used, so a posterior-chain day filled with cable rows and
  // every leg day picked up sled drags. Missing dayPatterns yields no fill rather
  // than a silent widening — the shortfall is reported as count-not-reachable.
  const patterns = [...new Set(dayPatterns ?? [])]
    .filter((p) => (style.patternEmphasis[p] ?? 0) > 0)
    .filter((p) => pool.some((e) => e.pattern === p && !state.usedIds.has(e.id)));

  // Among declared patterns, muscle fit still decides: what matters is whether
  // the pattern's REMAINING candidates serve the day, not whether the pattern
  // sounds related.
  let best = null;
  let bestScore = -Infinity;
  for (const p of patterns) {
    const used = state.usedPatterns.get(p) ?? 0;
    const fit = dayMuscles && dayMuscles.size
      ? Math.max(0, ...pool
          .filter((e) => e.pattern === p && !state.usedIds.has(e.id))
          .map((e) => muscleFit(e, dayMuscles)))
      : 0;
    const s = (style.patternEmphasis[p] ?? 0) - used * (1 - ratio) * 1.5 + fit * 1.5;
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}

/** Cheapest cost still available for a pattern, or null when nothing is unused. */
function cheapestCost(pool, pattern, state) {
  const costs = pool
    .filter((e) => e.pattern === pattern && !state.usedIds.has(e.id))
    .map((e) => e.fatigueCost);
  return costs.length ? Math.min(...costs) : null;
}

function commit(state, exercise, style, { isMain, emphasis, rng }) {
  state.fatigueUsed += exercise.fatigueCost;
  state.usedIds.add(exercise.id);
  if (exercise.fatigueCost >= MAX_TOP_COST) state.topCostUsed++;

  const family = exercise.exerciseFamily ?? exercise.id;
  state.usedFamilies.set(family, (state.usedFamilies.get(family) ?? 0) + 1);
  state.usedPatterns.set(exercise.pattern, (state.usedPatterns.get(exercise.pattern) ?? 0) + 1);

  state.blocks.push(straightBlock(exercise, prescribe({ exercise, style, isMain, emphasis, rng })));
}

// ---------------------------------------------------------------------------
// Prescription — unchanged by this rewrite.
// ---------------------------------------------------------------------------

/**
 * The prescription half of a SetGroup. Returns fields only — exercise identity
 * is attached by makeSetGroup, so this function cannot disagree with the catalog
 * about what it is prescribing for.
 */
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
    role: isMain ? 'main' : 'accessory',
    sets,
    reps,
    intensityOf1RM: intensity,
    rir: exercise.defaultRIR,
    restSeconds: isMain ? style.restSeconds.main : style.restSeconds.accessory
  };
}

const round = (n, dp) => Number(n.toFixed(dp));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
