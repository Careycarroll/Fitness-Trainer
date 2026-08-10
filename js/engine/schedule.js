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
