/**
 * Interval-domain generator: work/rest, rounds, time caps.
 * Serves HIIT, cardio, CrossFit.
 *
 * ADR-009/ADR-010: this exists because conditioning is a different SHAPE, not different
 * numbers. Collapsing it into loadDomain.js behind a mode flag is the failure this project
 * decided against in writing.
 */
import { createRng, shuffle } from './rng.js';
import { filterByGates } from './safety.js';
import { isAvailable } from './substitution.js';

export const DOMAIN = 'time';

export function generateSession({ style, day, catalog, profile, request, dayIndex }) {
  const rng = createRng(request.seed + dayIndex * 104729);
  const ctx = request.athlete ?? { skillLevel: 2, hasCoaching: false, strictReps: {} };

  const available = catalog.filter(
    (e) => isAvailable(e, profile) && (e.scoring === 'time' || e.scoring === 'both')
  );
  const { allowed, blocked } = filterByGates(available, ctx);

  const wr = style.workRest;
  const stations = [];
  let fatigueUsed = 0;

  const pool = shuffle(
    rng,
    allowed.filter((e) => (style.patternEmphasis[e.pattern] ?? 0) > 0)
  ).sort((a, b) => (style.patternEmphasis[b.pattern] ?? 0) - (style.patternEmphasis[a.pattern] ?? 0));

  for (const pattern of day.patterns) {
    const candidate = pool.find(
      (e) => e.pattern === pattern && !stations.some((s) => s.exerciseId === e.id)
    );
    if (!candidate) continue;
    if (fatigueUsed + candidate.fatigueCost > style.fatigueBudget) continue;
    fatigueUsed += candidate.fatigueCost;

    const work = clamp(wr.workSeconds, candidate.timeDomain.minSeconds, candidate.timeDomain.maxSeconds);
    stations.push({
      exerciseId: candidate.id,
      name: candidate.name,
      workSeconds: work,
      restSeconds: wr.restSeconds,
      roundsCapable: candidate.roundsCapable,
      kipAllowed: candidate.kipAllowed,
      monostructural: candidate.monostructural
    });
  }

  const totalSeconds = stations.reduce((s, st) => s + st.workSeconds + st.restSeconds, 0) * wr.rounds;

  return {
    domain: DOMAIN,
    label: day.label,
    styleId: style.id,
    format: wr.restSeconds === 0 && wr.rounds === 1 ? 'amrap' : 'intervals',
    rounds: wr.rounds,
    capSeconds: wr.workSeconds,
    stations,
    estimatedSeconds: totalSeconds,
    fatigueUsed,
    fatigueBudget: style.fatigueBudget,
    blockedByGates: blocked.filter((b) => b.reason).map((b) => ({ id: b.exercise.id, reason: b.reason }))
  };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
