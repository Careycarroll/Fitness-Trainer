/**
 * Interval-domain generator: work/rest, rounds, time caps.
 * Serves HIIT, cardio, CrossFit.
 *
 * ADR-009/ADR-010: this exists because conditioning is a different SHAPE, not different
 * numbers. Collapsing it into loadDomain.js behind a mode flag is the failure this project
 * decided against in writing.
 *
 * ADR-027: `stations[]` is RETIRED. A station was a SetGroup described twice —
 * an exercise plus a work/rest prescription — and the parallel array forced every
 * consumer to branch on `session.domain` to find the exercise list. The session
 * now emits ONE `circuit` or `amrap` block whose setGroups are the stations.
 * `rounds` and `timeCapSeconds` live on the block, which is the only place they
 * have ever honestly described: they belong to the group, not to any member.
 */
import { createRng, shuffle } from './rng.js';
import { filterByGates } from './safety.js';
import { isAvailable } from './substitution.js';
import { makeBlock, makeSetGroup } from './blocks.js';

export const DOMAIN = 'time';

export function generateSession({ style, day, catalog, profile, request, dayIndex }) {
  const rng = createRng(request.seed + dayIndex * 104729);
  const ctx = request.athlete ?? { skillLevel: 2, hasCoaching: false, strictReps: {} };

  const available = catalog.filter(
    (e) => isAvailable(e, profile) && (e.scoring === 'time' || e.scoring === 'both')
  );
  const { allowed, blocked } = filterByGates(available, ctx);

  const wr = style.workRest;
  const setGroups = [];
  const omitted = [];
  let fatigueUsed = 0;

  const pool = shuffle(
    rng,
    allowed.filter((e) => (style.patternEmphasis[e.pattern] ?? 0) > 0)
  ).sort((a, b) => (style.patternEmphasis[b.pattern] ?? 0) - (style.patternEmphasis[a.pattern] ?? 0));

  const chosen = new Set();

  for (const pattern of day.patterns) {
    const candidate = pool.find((e) => e.pattern === pattern && !chosen.has(e.id));

    if (!candidate) {
      omitted.push({ pattern, reason: 'no-unused-candidates' });
      continue;
    }
    if (fatigueUsed + candidate.fatigueCost > style.fatigueBudget) {
      omitted.push({
        pattern,
        reason: 'fatigue-budget-exhausted',
        wouldHaveCost: candidate.fatigueCost,
        remaining: style.fatigueBudget - fatigueUsed
      });
      continue;
    }

    // timeDomain is non-null for every time-scored row by ADR-026's derivation
    // (scoring 'both' <=> timeDomain !== null, enforced by check 03). Guarded
    // anyway: relying on an invariant held in another file is how a null
    // dereference reaches a user.
    const td = candidate.timeDomain;
    if (!td) {
      omitted.push({ pattern, reason: 'no-time-domain', exerciseId: candidate.id });
      continue;
    }

    fatigueUsed += candidate.fatigueCost;
    chosen.add(candidate.id);

    setGroups.push(
      makeSetGroup(candidate, {
        role: 'station',
        workSeconds: clamp(wr.workSeconds, td.minSeconds, td.maxSeconds),
        restSeconds: wr.restSeconds,
        roundsCapable: candidate.roundsCapable,
        kipAllowed: candidate.kipAllowed,
        monostructural: candidate.monostructural
      })
    );
  }

  // An AMRAP is one unbroken effort against a cap; intervals are rounds of
  // work/rest. Both are ONE block containing every movement, because the
  // rounds and the cap describe the group and there is nowhere else to put
  // them that means what they need to mean.
  const isAmrap = wr.restSeconds === 0 && wr.rounds === 1;
  const blocks = setGroups.length
    ? [
        makeBlock(isAmrap ? 'amrap' : 'circuit', setGroups, {
          rounds: wr.rounds,
          timeCapSeconds: isAmrap ? wr.workSeconds : null
        })
      ]
    : [];

  const totalSeconds =
    setGroups.reduce((s, sg) => s + sg.workSeconds + sg.restSeconds, 0) * wr.rounds;

  return {
    domain: DOMAIN,
    label: day.label,
    styleId: style.id,
    format: isAmrap ? 'amrap' : 'intervals',
    rounds: wr.rounds,
    capSeconds: wr.workSeconds,
    blocks,
    omitted,
    estimatedSeconds: totalSeconds,
    fatigueUsed,
    fatigueBudget: style.fatigueBudget,
    blockedByGates: blocked.filter((b) => b.reason).map((b) => ({ id: b.exercise.id, reason: b.reason }))
  };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
