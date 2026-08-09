/**
 * Engine entry point. Pure: (request, definitions) => program.
 * No clock reads, no Math.random, no I/O. ADR-002.
 */
import * as loadDomain from './loadDomain.js';
import * as intervalDomain from './intervalDomain.js';

const GENERATORS = { load: loadDomain, time: intervalDomain };

export class RequestError extends Error {}

export function generate(request, defs) {
  validateRequest(request, defs);

  const style = defs.styles.find((s) => s.id === request.styleId);
  const profile = defs.equipment.find((p) => p.id === request.equipmentProfile);
  const generator = GENERATORS[style.domain];

  const split = chooseSplit(defs.splits, request.daysPerWeek, style.domain);
  const weeks = [];

  for (let w = 0; w < request.blockWeeks; w++) {
    const sessions = split.days.map((day, dayIndex) =>
      generator.generateSession({
        style,
        day,
        catalog: defs.exercises,
        profile,
        request: { ...request, seed: request.seed + w * 31 },
        dayIndex
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

function chooseSplit(splits, daysPerWeek, domain) {
  const conditioning = domain === 'time';
  const pool = splits.filter((s) => (conditioning ? s.id.startsWith('conditioning') : !s.id.startsWith('conditioning')));
  const usable = pool.length ? pool : splits;
  return (
    usable.find((s) => s.daysPerWeek === daysPerWeek) ??
    usable.reduce((best, s) =>
      Math.abs(s.daysPerWeek - daysPerWeek) < Math.abs(best.daysPerWeek - daysPerWeek) ? s : best
    )
  );
}

function validateRequest(request, defs) {
  if (!Number.isInteger(request.seed)) throw new RequestError('seed is required and must be an integer (ADR-002 determinism)');
  if (!defs.styles.some((s) => s.id === request.styleId)) throw new RequestError(`unknown styleId: ${request.styleId}`);
  if (!defs.equipment.some((p) => p.id === request.equipmentProfile)) throw new RequestError(`unknown equipmentProfile: ${request.equipmentProfile}`);
  if (!(request.blockWeeks >= 1 && request.blockWeeks <= 12)) throw new RequestError('blockWeeks must be 1-12');
  if (!(request.daysPerWeek >= 1 && request.daysPerWeek <= 7)) throw new RequestError('daysPerWeek must be 1-7');
}

export { loadDomain, intervalDomain };
