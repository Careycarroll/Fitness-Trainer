/**
 * schedule.js — weekday preference -> gap classification.
 *
 * ADR-015: a plan is an ordered sequence of sessions. Weekdays are a
 * presentation concern. The ONLY thing the engine derives from weekdays is the
 * recovery gap preceding each session, because ADR-013's full-body split means
 * every session trains every pattern.
 *
 * This module is CODE, not data (ADR-012): it is control flow. The multiplier it
 * enables is data (progression.json).
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const INDEX = new Map(WEEKDAYS.map((d, i) => [d, i]));

export class ScheduleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScheduleError';
  }
}

/**
 * Validate a weekday preference.
 * @param {string[]} days
 * @returns {string[]} days sorted into weekday order (mon..sun)
 */
export function normalizeDays(days) {
  if (!Array.isArray(days) || days.length === 0) {
    throw new ScheduleError('Schedule must be a non-empty array of weekday tokens.');
  }
  if (days.length > 7) {
    throw new ScheduleError(`Schedule has ${days.length} days; maximum is 7.`);
  }
  const seen = new Set();
  for (const d of days) {
    if (typeof d !== 'string' || !INDEX.has(d)) {
      throw new ScheduleError(
        `Unknown weekday token ${JSON.stringify(d)}. Expected one of: ${WEEKDAYS.join(', ')}.`
      );
    }
    if (seen.has(d)) {
      throw new ScheduleError(`Duplicate weekday "${d}". A day may appear at most once.`);
    }
    seen.add(d);
  }
  return [...days].sort((a, b) => INDEX.get(a) - INDEX.get(b));
}

/**
 * Days elapsed since the previous training day, wrapping across the week.
 * A single training day per week yields 7.
 * @param {string[]} days  normalized
 * @param {number} i       position within the normalized week
 */
function gapDays(days, i) {
  if (days.length === 1) return 7;
  const prev = days[(i - 1 + days.length) % days.length];
  const raw = INDEX.get(days[i]) - INDEX.get(prev);
  const gap = ((raw % 7) + 7) % 7;
  return gap === 0 ? 7 : gap;
}

/**
 * Classify the recovery state of the nth session of a block.
 *
 * `index` is the absolute session index (0-based) within the block, NOT the
 * weekday. Sessions cycle through the weekday list, which is what makes the
 * sequence model of ADR-015 work: skip a session and the next one you perform
 * simply takes the next slot.
 *
 * @param {string[]} days   e.g. ['tue','fri','sat'] (any order accepted)
 * @param {number} index    absolute session index within the block
 * @returns {'recovered'|'compressed'}
 */
export function gapClass(days, index) {
  const norm = normalizeDays(days);
  if (!Number.isInteger(index) || index < 0) {
    throw new ScheduleError(`Session index must be a non-negative integer, got ${index}.`);
  }
  return gapDays(norm, index % norm.length) >= 2 ? 'recovered' : 'compressed';
}

/**
 * Choose the best-spaced `count` days from the days the athlete is AVAILABLE.
 *
 * Availability and frequency are different facts (#25). "I can train six days a
 * week" and "I want four sessions" are both true at once, and forcing them to be
 * the same number made the athlete solve the spacing puzzle by hand -- and made
 * a 7-day request silently resolve to a 5-day split, because no 7-day template
 * exists.
 *
 * EXHAUSTIVE, not greedy. At most C(7,k) combinations, so 35 in the worst case.
 * A greedy rule would be faster and would need an argument for why its choices
 * are good; enumerating removes the question.
 *
 * SCORED ON THE MINIMUM GAP, not the average. Average is gamed by clustering:
 * mon/tue/thu and mon/wed/fri have the same mean gap across a week, but the
 * first contains a one-day gap. Recovery cares about the worst case.
 *
 * Ties break on total gap, then on weekday order, so the result is stable for a
 * given input (ADR-002).
 */
export function chooseTrainingDays(available, count) {
  const pool = normalizeDays(available);
  if (!Number.isInteger(count) || count < 1) {
    throw new ScheduleError(`Session count must be a positive integer, got ${count}.`);
  }
  if (count > pool.length) {
    throw new ScheduleError(
      `${count} sessions requested but only ${pool.length} day(s) available ` +
      `(${pool.join(', ')}). Add availability or reduce sessions.`
    );
  }
  if (count === pool.length) return pool;

  const combos = [];
  const walk = (start, picked) => {
    if (picked.length === count) { combos.push([...picked]); return; }
    for (let i = start; i < pool.length; i += 1) {
      picked.push(pool[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);

  // Compared LEXICOGRAPHICALLY on the sorted gap list: maximise the smallest
  // gap, then the next smallest, and so on. This is a maximin comparison and it
  // is not the obvious one.
  //
  // The obvious one was wrong. Scoring on (min gap, then total) picked
  // mon/tue/wed/thu for 4-of-7 -- four consecutive days then a four-day break.
  // Gaps around a weekly cycle ALWAYS sum to 7 whichever days are chosen, so
  // `total` never discriminated and the tie fell through to weekday order,
  // which favours the earliest cluster. Both candidates also share a minimum
  // gap of 1, so `min` alone could not separate them either:
  //
  //   mon/tue/wed/thu   gaps 1,1,1,4   sorted [1,1,1,4]
  //   mon/wed/fri/sun   gaps 2,2,2,1   sorted [1,2,2,2]
  //
  // Lexicographic comparison prefers the second, correctly.
  const sortedGaps = (days) =>
    days.map((_, i) => gapDays(days, i)).sort((x, y) => x - y);

  return combos
    .map((days) => ({ days, gaps: sortedGaps(days) }))
    .sort((a, c) => {
      for (let i = 0; i < a.gaps.length; i += 1) {
        if (c.gaps[i] !== a.gaps[i]) return c.gaps[i] - a.gaps[i];
      }
      // Identical gap profiles: earliest weekday wins, so the result is stable
      // for a given input (ADR-002).
      return INDEX.get(a.days[0]) - INDEX.get(c.days[0]);
    })[0].days;
}

/**
 * Map a session index to its display weekday. Presentation only — nothing in
 * the generator may branch on this.
 */
export function weekdayForSession(days, index) {
  const norm = normalizeDays(days);
  return norm[index % norm.length];
}

/** Full per-session schedule view for a block. Presentation helper. */
export function scheduleView(days, sessionCount) {
  const norm = normalizeDays(days);
  return Array.from({ length: sessionCount }, (_, i) => ({
    index: i,
    ordinal: i + 1,
    weekday: norm[i % norm.length],
    week: Math.floor(i / norm.length) + 1,
    gap: gapDays(norm, i % norm.length),
    gapClass: gapClass(norm, i)
  }));
}
