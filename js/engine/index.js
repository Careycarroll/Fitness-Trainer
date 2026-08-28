/**
 * Engine entry point. Pure: (request, definitions) => program.
 * No clock reads, no Math.random, no I/O. ADR-002.
 */
import { assertCoverage } from './coverage.js';
import { weeklyVolume } from './volume.js';
// schedule.js owns weekday logic and is the ONE definition of a valid weekday.
// Re-checking the rules here is how two copies drift apart (#25).
import { chooseTrainingDays, gapClass } from './schedule.js';
import * as loadDomain from './loadDomain.js';
import * as intervalDomain from './intervalDomain.js';

const GENERATORS = { load: loadDomain, time: intervalDomain };

export class RequestError extends Error {}

export function generate(request, defs) {
  validateRequest(request, defs);

  const style = defs.styles.find((s) => s.id === request.styleId);
  const profile = defs.equipment.find((p) => p.id === request.equipmentProfile);
  const generator = GENERATORS[style.domain];

  const { split, sessionMismatch } = chooseSplit(
    defs.splits, request.daysPerWeek, style.domain, style
  );

  // ADR-014 precondition. Checked ONCE for the whole request rather than
  // per-session: the answer cannot differ between days, and discovering it on
  // day 3 after emitting two sessions is worse than refusing up front.
  //
  // Two narrowings, both deliberate:
  //   - Only patterns the STYLE actually asks for. patternEmphasis 0 means
  //     "this style does not program that", so a powerlifting request must not
  //     fail because the catalog has no monostructural rows.
  //   - Only catalog rows this DOMAIN can use. The generators filter on
  //     `scoring` before selecting; checking coverage against the unfiltered
  //     catalog would pass and then the generator would still find nothing.
  const domainCatalog = defs.exercises.filter((e) =>
    style.domain === 'load'
      ? e.scoring === 'load' || e.scoring === 'both'
      : e.scoring === 'time' || e.scoring === 'both' || e.repsForTime
  );
  const requiredPatterns = [
    ...new Set(split.days.flatMap((d) => d.patterns))
  ].filter((p) => (style.patternEmphasis[p] ?? 0) > 0);

  // Only patterns this domain can actually supply. A conditioning style asking
  // for `hinge` finds no TIME-scored hinge rows, and that is a milestone gap
  // (M7), not something the user can fix -- refusing the whole request for it
  // hands them a dead end. Equipment gaps ARE actionable, so those still refuse.
  // Unsuppliable patterns are reported per-session in omitted[], which is the
  // same honesty mechanism, applied at the level where it means something.
  const suppliable = requiredPatterns.filter((p) =>
    domainCatalog.some((e) => e.pattern === p)
  );

  assertCoverage(profile, suppliable, domainCatalog);

  // Resolved from the SPLIT's session count, not daysPerWeek. Those differ:
  // asking for 7 sessions resolves to ppl-6, so a 7-day schedule would have
  // computed a recovery gap for a day holding no session.
  const schedule = request.availableDays
    ? chooseTrainingDays(request.availableDays, split.days.length)
    : null;

  const weeks = [];

  for (let w = 0; w < request.blockWeeks; w++) {
    // Week-level selection memory (#40). Sessions are generated in split order
    // and each one reads what the earlier days already used, so the same top-
    // scoring row cannot silently lead two days. Reset per week: a new week is
    // allowed to look like the last one.
    const week = { usedIds: new Map(), usedFamilies: new Map() };

    const sessions = split.days.map((day, dayIndex) =>
      generator.generateSession({
        style,
        day,
        catalog: defs.exercises,
        profile,
        request: { ...request, seed: request.seed + w * 31 },
        dayIndex,
        week,
        // Recovery state of this session, or null when no availability was
        // given. ADR-015: the only thing the engine derives from weekdays.
        gap: schedule ? gapClass(schedule, dayIndex) : null,
        compressedAccessoryMultiplier:
          defs.progression?.compressedAccessoryMultiplier ?? 1
      })
    );
    // #44. Weekly sets per muscle against landmarks.json, which until now no
    // generator read at all. Computed HERE because volume is a week-level fact:
    // a session cannot know it, and asking each generator to would put the same
    // rule in two places.
    //
    // REPORTED, never enforced. The landmarks are population estimates -- the
    // file says so -- and truncating a session on a number that may be wrong
    // for this body asserts a precision the data does not have. #67 makes them
    // adjustable; capping an athlete's OWN number is a different argument.
    //
    // Null for the interval domain, which prescribes seconds rather than sets.
    weeks.push({
      week: w + 1,
      sessions,
      volume: weeklyVolume({ sessions }, defs.landmarks)
    });
  }

  return {
    schemaVersion: defs.schemaVersion ?? 1,
    // The RESOLVED training days, chosen from availability for maximum recovery
    // spacing. Carried so the export layer can turn an ordered sequence into
    // concrete dates (#25). Null when no availability was given: the engine
    // never invents a schedule, and ADR-002 forbids it reading a clock.
    schedule,
    styleId: style.id,
    splitId: split.id,
    domain: style.domain,
    seed: request.seed,
    // #51. Carried on the program, not just shown once: an exported plan and a
    // reloaded one must be able to say what was asked for. Null when the
    // request was honoured -- a field permanently reading 'no mismatch' is noise.
    requestedSessions: request.daysPerWeek,
    resolvedSessions: split.daysPerWeek,
    sessionMismatch,
    // #76. Null when the resolved split is one the style asked for AND every
    // day offers something it emphasises. Populated otherwise — chooseSplit()
    // can honour the day count while handing back a split the style never
    // listed, and until now that was reported nowhere.
    splitFit: splitFitOf(style, split),
    weeks
  };
}

/**
 * How well the RESOLVED split serves the style — #76.
 *
 * chooseSplit() has two exit paths that return `sessionMismatch: null`. The
 * second matches on day count alone:
 *
 *     const exact = usable.find((s) => s.daysPerWeek === daysPerWeek);
 *     if (exact) return { split: exact, sessionMismatch: null };
 *
 * The session count was honoured, so nothing was reported — but the style may
 * never have listed this split. `ppl-6` is the only 6-day template in the
 * catalog, so core, strength and powerlifting all land on a hypertrophy split
 * at 6 days, and athletic lands on a non-preferred split at four separate day
 * counts. Eight of thirty combinations, all silent.
 *
 * This does NOT change which split is chosen. Ranking cannot help: there is one
 * split per day count, so a guard that rejected the sole candidate would fall
 * through to closest(preferred) and hand athletic at 1 day a 4-day split. The
 * split stays; the mismatch is reported, exactly as #51 did for session count.
 *
 * Returns null when the split is preferred AND every day offers a pattern the
 * style scores at EMPHASIS_FLOOR or better. A field permanently reading "no
 * problem" is noise.
 */
const EMPHASIS_FLOOR = 0.3;

function splitFitOf(style, split) {
  // Only the load domain declares patternEmphasis. A time-domain style has no
  // per-pattern opinion, so there is nothing to measure and nothing to report.
  const emphasis = style?.patternEmphasis;
  if (!emphasis) return null;

  const days = split?.days ?? [];
  const preferred = (style.preferredSplits ?? []).includes(split.id);

  const weakDays = [];
  for (const d of days) {
    const best = Math.max(0, ...(d.patterns ?? []).map((p) => emphasis[p] ?? 0));
    if (best < EMPHASIS_FLOOR) weakDays.push({ label: d.label, best });
  }

  if (preferred && weakDays.length === 0) return null;

  return {
    splitId: split.id,
    preferred,
    emphasisedDays: days.length - weakDays.length,
    totalDays: days.length,
    weakDays,
    prefers: [...(style.preferredSplits ?? [])]
  };
}

function chooseSplit(splits, daysPerWeek, domain, style) {
  const conditioning = domain === 'time';
  const pool = splits.filter((s) =>
    conditioning ? s.id.startsWith('conditioning') : !s.id.startsWith('conditioning')
  );
  const usable = pool.length ? pool : splits;

  // A style's preferred splits come first, in declared order. Without this,
  // matching on daysPerWeek alone routed a powerlifting request to full-body-3 --
  // a general-strength session wearing a powerlifting rep range. The style's
  // STRUCTURE is as much a part of it as its numbers.
  const preferred = (style?.preferredSplits ?? [])
    .map((id) => usable.find((s) => s.id === id))
    .filter(Boolean);

  const exactPreferred = preferred.find((s) => s.daysPerWeek === daysPerWeek);
  if (exactPreferred) return { split: exactPreferred, sessionMismatch: null };

  const exact = usable.find((s) => s.daysPerWeek === daysPerWeek);
  if (exact) return { split: exact, sessionMismatch: null };

  // No exact day count anywhere. Never invent days to fill a gap -- but the
  // mismatch is now RETURNED rather than assumed to be someone else's problem.
  // The previous comment said "the UI reports the mismatch instead (ADR-014)".
  // The UI could not: nothing was handed to it, so a 7-session request became a
  // 5-session program in silence (#51).
  const list = preferred.length ? preferred : usable;
  const split = closest(list, daysPerWeek);

  return {
    split,
    sessionMismatch: {
      requested: daysPerWeek,
      resolved: split.daysPerWeek,
      splitId: split.id,
      // What the athlete can actually pick, so the notice says something more
      // useful than "not that". Domain-filtered: a conditioning style must not
      // be offered load-domain day counts it cannot have.
      available: [...new Set(list.map((s) => s.daysPerWeek))].sort((a, b) => a - b),
      reason: `no ${daysPerWeek}-session split template exists`
    }
  };
}

/**
 * Closest split by day count, with every tie broken EXPLICITLY -- #51.
 *
 * `reduce` kept the first of a tie, so a 7-session request chose between
 * body-part-5 and ppl-6 (|5-7| = |6-7| = 2) on splits.json FILE ORDER. Stable,
 * but an accident rather than a decision.
 *
 * Decided: nearer day count wins; on a tie the GREATER count wins, because
 * under-delivering sessions is the harm being reported and losing one beats
 * losing two; on a full tie, lexicographic id, so no domain-filtered subset can
 * depend on authoring order.
 *
 * Sorting a COPY. An in-place sort of `splits` would reorder the caller's
 * definitions and make generation depend on call order, breaking ADR-002.
 */
function closest(list, want) {
  return list.slice().sort((a, b) => {
    const byDistance = Math.abs(a.daysPerWeek - want) - Math.abs(b.daysPerWeek - want);
    if (byDistance !== 0) return byDistance;
    if (a.daysPerWeek !== b.daysPerWeek) return b.daysPerWeek - a.daysPerWeek;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

function validateRequest(request, defs) {
  if (!Number.isInteger(request.seed)) throw new RequestError('seed is required and must be an integer (ADR-002 determinism)');
  if (!defs.styles.some((s) => s.id === request.styleId)) throw new RequestError(`unknown styleId: ${request.styleId}`);
  if (!defs.equipment.some((p) => p.id === request.equipmentProfile)) throw new RequestError(`unknown equipmentProfile: ${request.equipmentProfile}`);
  if (!(request.blockWeeks >= 1 && request.blockWeeks <= 12)) throw new RequestError('blockWeeks must be 1-12');
  if (!(request.daysPerWeek >= 1 && request.daysPerWeek <= 7)) throw new RequestError('daysPerWeek must be 1-7');

  // OPTIONAL, and availability is NOT frequency. `availableDays` is when the
  // athlete COULD train; `daysPerWeek` is how many sessions they want. Both are
  // true at once, and conflating them made the athlete solve the spacing puzzle
  // by hand. When present, the engine picks the best-spaced subset.
  //
  // Absent means the program carries no weekdays, so #25 cannot compute dates
  // for it - a missing capability rather than a fault. Every caller written
  // before this field existed omits it and must keep working.
  if (request.availableDays !== undefined) {
    try {
      chooseTrainingDays(request.availableDays, request.daysPerWeek);
    } catch (err) {
      throw new RequestError(`availableDays: ${err.message}`);
    }
  }
  if (request.exerciseCount !== undefined &&
      !(Number.isInteger(request.exerciseCount) && request.exerciseCount >= 1 && request.exerciseCount <= 14)) {
    throw new RequestError('exerciseCount must be an integer 1-14 when provided');
  }
}

export { loadDomain, intervalDomain };
export { CoverageError } from './coverage.js';
