/**
 * Mobility domain generator (#65, ADR-038): yoga, pilates, and flexibility.
 *
 * Pure, deterministic, DOM-free.
 * Emits `flow` blocks with `holdSeconds` and `position` per pose, keeping
 * `fatigueUsed: null` and `fatigueBudget: null` so mobility never corrupts
 * load-domain fatigue budgeting.
 */
import { createRng } from './rng.js';
import { isAvailable } from './substitution.js';
import { filterByGates } from './safety.js';
import { makeBlock, makeSetGroup } from './blocks.js';

const DOMAIN = 'mobility';

/**
 * Code-owned pose-to-pose transition graph (ADR-012).
 * Prevents jarring transitions (e.g. standing -> supine -> standing in 1 step).
 */
export const POSITION_TRANSITIONS = Object.freeze({
  standing: ['standing', 'hinge', 'kneeling', 'plank'],
  hinge: ['standing', 'hinge', 'plank', 'all_fours', 'kneeling'],
  plank: ['plank', 'prone', 'all_fours', 'hinge', 'side_lying'],
  prone: ['prone', 'all_fours', 'plank', 'side_lying', 'hinge', 'kneeling'],
  all_fours: ['all_fours', 'kneeling', 'plank', 'prone', 'seated', 'supine'],
  kneeling: ['kneeling', 'all_fours', 'standing', 'seated', 'side_lying'],
  seated: ['seated', 'supine', 'all_fours', 'kneeling', 'side_lying'],
  side_lying: ['side_lying', 'supine', 'prone', 'all_fours'],
  supine: ['supine', 'seated', 'side_lying', 'all_fours']
});

export function canTransition(fromPosition, toPosition) {
  if (!fromPosition || !toPosition) return true;
  const allowed = POSITION_TRANSITIONS[fromPosition];
  if (!allowed) return false;
  return allowed.includes(toPosition);
}

/**
 * Return all available mobility poses that can feasibly follow `currentPose` (#65).
 */
export function nextFeasiblePoses(currentPose, catalog, profile = null, athlete = null) {
  if (!currentPose) return [];
  const pool = catalog.filter((e) =>
    e.scoring === 'mobility' &&
    e.id !== currentPose.id &&
    (!profile || isAvailable(e, profile))
  );
  const { allowed } = filterByGates(pool, athlete ?? { skillLevel: 5 });
  return allowed.filter((e) => canTransition(currentPose.position, e.position));
}

/**
 * Generate a mobility session from a predefined flow or transition-walk fallback.
 */
export function generateSession({ style, day, catalog, profile, request, dayIndex, mobilityFlows = [] }) {
  const rng = createRng(request.seed + dayIndex * 104729);
  const ctx = request.athlete ?? { skillLevel: 2 };

  const available = catalog.filter((e) => isAvailable(e, profile) && e.scoring === 'mobility');
  const { allowed, blocked } = filterByGates(available, ctx);
  const byId = new Map(allowed.map((e) => [e.id, e]));

  const matchingFlows = (mobilityFlows || []).filter((f) =>
    (f.styles || []).includes(style.id) &&
    f.poses?.length > 0 &&
    f.poses.every((p) => byId.has(p.exerciseId))
  );

  let setGroups = [];
  let flowLabel = day.label;

  if (matchingFlows.length > 0) {
    const chosenFlow = matchingFlows[(Math.abs(request.seed) + dayIndex) % matchingFlows.length];
    flowLabel = `${day.label}: ${chosenFlow.name}`;
    setGroups = chosenFlow.poses.map((p) => {
      const ex = byId.get(p.exerciseId);
      return makeSetGroup(ex, {
        role: 'flow',
        holdSeconds: p.holdSeconds ?? style.workRest?.workSeconds ?? 40,
        restSeconds: style.workRest?.restSeconds ?? 5,
        position: ex.position ?? null
      });
    });
  } else if (allowed.length > 0) {
    // Transition-graph walk fallback (e.g. when joint constraints filter out a predefined flow)
    const targetCount = Math.min(allowed.length, style.exercisesPerSession?.min ?? 5);
    const start = allowed[Math.floor(rng() * allowed.length)];
    const sequence = [start];
    const used = new Set([start.id]);

    while (sequence.length < targetCount) {
      const prev = sequence[sequence.length - 1];
      const candidates = allowed.filter((e) => !used.has(e.id) && canTransition(prev.position, e.position));
      const pool = candidates.length ? candidates : allowed.filter((e) => !used.has(e.id));
      if (!pool.length) break;
      const pick = pool[Math.floor(rng() * pool.length)];
      sequence.push(pick);
      used.add(pick.id);
    }

    setGroups = sequence.map((ex) => makeSetGroup(ex, {
      role: 'flow',
      holdSeconds: style.workRest?.workSeconds ?? 40,
      restSeconds: style.workRest?.restSeconds ?? 5,
      position: ex.position ?? null
    }));
  }

  const blocks = setGroups.length ? [makeBlock('flow', setGroups)] : [];

  return {
    domain: DOMAIN,
    label: flowLabel,
    styleId: style.id,
    blocks,
    omitted: blocks.length ? [] : [{ pattern: 'mobility', reason: 'no-unused-candidates' }],
    fatigueUsed: null,
    fatigueBudget: null,
    blockedByGates: blocked.filter((b) => b.reason).map((b) => ({ id: b.exercise.id, reason: b.reason }))
  };
}
