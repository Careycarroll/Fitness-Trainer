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

/**
 * A reps-for-time row has no timeDomain of its own (#37): its rep columns hold
 * REPS, not seconds, so it takes the style's work window unmodified. That was
 * fine at HIIT's 40s and indefensible at CrossFit's 720s, which prescribed
 * twelve minutes of unbroken push-ups. Above this ceiling the row is omitted
 * with a reason rather than dressed up as a prescription (#29).
 *
 * 90s is a judgement, not a measurement. It is the point past which "as many
 * good reps as you can" stops describing anything an athlete would recognise.
 */
export const REPS_FOR_TIME_MAX_SECONDS = 90;

/**
 * In an interval style `workSeconds` is a PER-STATION window. In an AMRAP it is
 * the cap on the WHOLE block, and feeding it to a station handed one movement
 * the entire session: crossfit prescribed Elliptical Trainer 720s beside Wall
 * Sit 90s and a 45s plank - an 855s round against a 720s cap, so the athlete
 * never reached station two (#42).
 *
 * An AMRAP round must fit inside the cap several times over. Three is a
 * judgement, not a measurement: below it the block stops being "as many rounds
 * as possible" and becomes one long effort with decoration attached.
 */
export const AMRAP_MIN_ROUNDS = 3;

/** The window ONE station may occupy, derived from the cap for round-based work. */
function stationWindowFor(style, wr, isAmrap) {
  if (!isAmrap) return wr;
  const stations = Math.max(1, style.exercisesPerSession?.min ?? 1);
  const perStation = Math.floor(wr.workSeconds / (AMRAP_MIN_ROUNDS * stations));
  return { ...wr, workSeconds: Math.max(1, perStation) };
}

/** Why this candidate cannot serve this style's window, or null if it can. */
function rejection(candidate, wr) {
  if (!candidate.timeDomain && !candidate.repsForTime) return 'no-time-domain';
  if (!candidate.timeDomain && wr.workSeconds > REPS_FOR_TIME_MAX_SECONDS) {
    return 'reps-for-time-window-too-long';
  }
  return null;
}

/**
 * Can this row serve the style's window without being clamped down to a
 * fraction of it? Battle Ropes caps at 120s, so cardio's 600s interval
 * collapsed to a two-minute training day — legal, and useless (#29).
 */
function servesFullWindow(candidate, wr) {
  const td = candidate.timeDomain;
  return td ? td.maxSeconds >= wr.workSeconds : true;
}

/**
 * A time-SCORED row carries honest bounds and is clamped to them. A
 * reps-for-time row has none, so it takes the style window as-is — already
 * bounded by REPS_FOR_TIME_MAX_SECONDS above.
 */
function workWindow(candidate, wr) {
  const td = candidate.timeDomain;
  return td ? clamp(wr.workSeconds, td.minSeconds, td.maxSeconds) : wr.workSeconds;
}

export function generateSession({ style, day, catalog, profile, request, dayIndex }) {
  const rng = createRng(request.seed + dayIndex * 104729);
  const ctx = request.athlete ?? { skillLevel: 2, hasCoaching: false, strictReps: {} };

  const available = catalog.filter(
    // ADR-009 counts reps-for-time as a time-domain mode, so compound
    // reps_only rows belong here even though they stay load-SCORED. Without
    // them the pool is 19 rows of planks and carries (#37).
    (e) => isAvailable(e, profile) && (e.scoring === 'time' || e.scoring === 'both' || e.repsForTime)
  );
  const { allowed, blocked } = filterByGates(available, ctx);

  const wr = style.workRest;
  const isAmrap = wr.restSeconds === 0 && wr.rounds === 1;
  const stationWindow = stationWindowFor(style, wr, isAmrap);
  const setGroups = [];
  const omitted = [];
  let fatigueUsed = 0;

  const pool = shuffle(
    rng,
    allowed.filter((e) => (style.patternEmphasis[e.pattern] ?? 0) > 0)
  ).sort((a, b) => (style.patternEmphasis[b.pattern] ?? 0) - (style.patternEmphasis[a.pattern] ?? 0));

  const chosen = new Set();
  const usedPatterns = new Set();

  /** Common admission path: fatigue, window legality, bookkeeping. */
  function place(candidate) {
    if (fatigueUsed + candidate.fatigueCost > style.fatigueBudget) return 'fatigue-budget-exhausted';

    const why = rejection(candidate, stationWindow);
    if (why) return why;

    fatigueUsed += candidate.fatigueCost;
    chosen.add(candidate.id);
    usedPatterns.add(candidate.pattern);

    setGroups.push(
      makeSetGroup(candidate, {
        role: 'station',
        workSeconds: workWindow(candidate, stationWindow),
        // The prescription is "as many good reps as you can inside the window",
        // not a rep count. A consumer needs to be able to say that rather than
        // rendering a work timer identical to a plank's.
        repsForTime: candidate.repsForTime === true,
        restSeconds: wr.restSeconds,
        roundsCapable: candidate.roundsCapable,
        kipAllowed: candidate.kipAllowed,
        monostructural: candidate.monostructural
      })
    );
    return null;
  }

  // Pass 1 — the split's required patterns. Scan for the first candidate that
  // can actually serve the window rather than taking the first by emphasis and
  // omitting the whole pattern when it happens to be inadmissible.
  for (const pattern of day.patterns) {
    // A style that scores this pattern at 0 does not want it, which is not the
    // same as the catalog being unable to supply it. `pool` is already filtered
    // to emphasis > 0, so without this branch the pattern arrives here with an
    // empty candidate list and gets reported as `no-unused-candidates` - a
    // claim about the catalog. cardio scores hinge, core, squat and push_h at 0
    // while `conditioning-3` declares them for hiit and crossfit, so every
    // cardio session asserted a gap that does not exist (#43).
    //
    // loadDomain.js has emitted this code since it was written. Same reason,
    // same spelling: one vocabulary across both generators.
    if ((style.patternEmphasis[pattern] ?? 0) === 0) {
      omitted.push({ pattern, reason: 'style-emphasis-zero' });
      continue;
    }

    // Rows that can hold the whole window come first; a clamped row is a
    // fallback, not an equal option. Stable within each tier, so the seeded
    // emphasis order still decides between equals (ADR-002).
    const candidates = pool
      .filter((e) => e.pattern === pattern && !chosen.has(e.id))
      .sort((a, c) => Number(servesFullWindow(c, stationWindow)) - Number(servesFullWindow(a, stationWindow)));

    if (!candidates.length) {
      omitted.push({ pattern, reason: 'no-unused-candidates' });
      continue;
    }

    let lastReason = null;
    let placed = false;
    for (const candidate of candidates) {
      lastReason = place(candidate);
      if (!lastReason) { placed = true; break; }
    }
    if (!placed) omitted.push({ pattern, reason: lastReason, exerciseId: candidates[0].id });
  }

  // Pass 2 — fill toward the style's own exercisesPerSession.
  //
  // This block did not exist. The loop above placed exactly one station per
  // split pattern, so `exercisesPerSession` was never read and HIIT declared
  // min 6 while emitting 3. Every "circuit" of one station traced back to a
  // split day with one pattern, not to a selector giving up. Same failure the
  // load domain had before 539f900: a style knob that did nothing.
  const target = style.exercisesPerSession?.min ?? 1;
  const ceiling = style.exercisesPerSession?.max ?? target;

  for (const candidate of pool) {
    if (setGroups.length >= Math.min(target, ceiling)) break;
    if (chosen.has(candidate.id)) continue;
    if (!style.allowPatternRepeat && usedPatterns.has(candidate.pattern)) continue;
    place(candidate);
  }

  // A session that cannot reach its own declared minimum is reported rather
  // than quietly handed over as a complete workout.
  if (setGroups.length < target) {
    omitted.push({
      pattern: null,
      reason: 'session-under-filled',
      placed: setGroups.length,
      target
    });
  }

  // An AMRAP is one unbroken effort against a cap; intervals are rounds of
  // work/rest. Both are ONE block containing every movement, because the
  // rounds and the cap describe the group and there is nowhere else to put
  // them that means what they need to mean.
  const blocks = setGroups.length
    ? [
        makeBlock(isAmrap ? 'amrap' : 'circuit', setGroups, {
          // An AMRAP's round count is what the athlete PRODUCES against the
          // cap, so prescribing `rounds: 1` stated a target that does not
          // exist. Null says "not prescribed"; the cap carries the intent.
          rounds: isAmrap ? null : wr.rounds,
          timeCapSeconds: isAmrap ? wr.workSeconds : null
        })
      ]
    : [];

  // An AMRAP lasts exactly its cap, however many rounds the athlete produces.
  const roundSeconds = setGroups.reduce((s, sg) => s + sg.workSeconds + sg.restSeconds, 0);
  const totalSeconds = isAmrap ? wr.workSeconds : roundSeconds * wr.rounds;

  return {
    domain: DOMAIN,
    label: day.label,
    styleId: style.id,
    format: isAmrap ? 'amrap' : 'intervals',
    // Consistent with the block: an AMRAP's rounds are produced, not prescribed.
    rounds: isAmrap ? null : wr.rounds,
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
