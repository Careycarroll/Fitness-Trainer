/**
 * Engine entry point. Pure: (request, definitions) => program.
 * No clock reads, no Math.random, no I/O. ADR-002.
 */
import { assertCoverage } from './coverage.js';
import * as loadDomain from './loadDomain.js';
import * as intervalDomain from './intervalDomain.js';

const GENERATORS = { load: loadDomain, time: intervalDomain };

export class RequestError extends Error {}

export function generate(request, defs) {
  validateRequest(request, defs);

  const style = defs.styles.find((s) => s.id === request.styleId);
  const profile = defs.equipment.find((p) => p.id === request.equipmentProfile);
  const generator = GENERATORS[style.domain];

  const split = chooseSplit(defs.splits, request.daysPerWeek, style.domain, style);

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
        week
      })
    );
    weeks.push({ week: w + 1, sessions });
  }

  return {
    schemaVersion: defs.schemaVersion ?? 1,
    styleId: style.id,
    splitId: split.id,
    domain: style.domain,
    seed: request.seed,
    weeks
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
  if (exactPreferred) return exactPreferred;

  const exact = usable.find((s) => s.daysPerWeek === daysPerWeek);
  if (exact) return exact;

  // No exact day count anywhere: take the closest preferred split if the style
  // named any, else the closest of all. Never invent days to fill a gap -- the
  // UI reports the mismatch instead (ADR-014).
  const closest = (list) =>
    list.reduce((best, s) =>
      Math.abs(s.daysPerWeek - daysPerWeek) < Math.abs(best.daysPerWeek - daysPerWeek) ? s : best
    );

  return preferred.length ? closest(preferred) : closest(usable);
}

function validateRequest(request, defs) {
  if (!Number.isInteger(request.seed)) throw new RequestError('seed is required and must be an integer (ADR-002 determinism)');
  if (!defs.styles.some((s) => s.id === request.styleId)) throw new RequestError(`unknown styleId: ${request.styleId}`);
  if (!defs.equipment.some((p) => p.id === request.equipmentProfile)) throw new RequestError(`unknown equipmentProfile: ${request.equipmentProfile}`);
  if (!(request.blockWeeks >= 1 && request.blockWeeks <= 12)) throw new RequestError('blockWeeks must be 1-12');
  if (!(request.daysPerWeek >= 1 && request.daysPerWeek <= 7)) throw new RequestError('daysPerWeek must be 1-7');
  if (request.exerciseCount !== undefined &&
      !(Number.isInteger(request.exerciseCount) && request.exerciseCount >= 1 && request.exerciseCount <= 14)) {
    throw new RequestError('exerciseCount must be an integer 1-14 when provided');
  }
}

export { loadDomain, intervalDomain };
export { CoverageError } from './coverage.js';
