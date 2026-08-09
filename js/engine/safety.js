/**
 * Safety and skill gates.
 *
 * ADR-012: THIS FILE IS CODE ON PURPOSE AND MUST STAY CODE.
 *
 * A gate expressed in JSON fails OPEN — a dropped key silently disables the check and the
 * generator happily prescribes a snatch to someone who has never done one. A gate expressed
 * here fails CLOSED: an unknown gate id throws, and a missing implementation fails a unit
 * test at commit time.
 *
 * Data may REFERENCE a gate by id (`skillGate` in exercises.json). Data may never DEFINE one.
 */

/** Thrown when a definition file references a gate that does not exist. Fail closed. */
export class UnknownGateError extends Error {}

const GATES = Object.freeze({
  /** Olympic lifts require demonstrated technical competence, not just strength. */
  'olympic-lift': (ctx) => {
    if (ctx.skillLevel < 3) {
      return deny('Olympic lifts require skill level 3+. Substituting a comparable pattern.');
    }
    if (!ctx.hasCoaching && ctx.skillLevel < 4) {
      return deny('Olympic lifts without coaching require skill level 4+.');
    }
    return allow();
  },

  /** Kipping loads the shoulder in end-range under momentum. Strict capacity comes first. */
  'kipping-prerequisite': (ctx) => {
    if ((ctx.strictReps?.['pull-up'] ?? 0) < 5) {
      return deny('Kipping requires 5+ strict pull-ups first.');
    }
    return allow();
  },

  /** Inverted pressing: overhead capacity before load is inverted onto the shoulder. */
  'inversion-prerequisite': (ctx) => {
    if ((ctx.strictReps?.['pike-push-up'] ?? 0) < 8) {
      return deny('Inverted pressing requires 8+ pike push-ups first.');
    }
    return allow();
  }
});

const allow = () => ({ allowed: true, reason: null });
const deny = (reason) => ({ allowed: false, reason });

export function gateExists(id) {
  return Object.prototype.hasOwnProperty.call(GATES, id);
}

export function listGates() {
  return Object.keys(GATES);
}

/**
 * @param {string|null} gateId
 * @param {object} ctx  athlete context: { skillLevel, hasCoaching, strictReps }
 * @returns {{allowed: boolean, reason: string|null}}
 */
export function evaluateGate(gateId, ctx) {
  if (gateId === null || gateId === undefined) return allow();
  if (!gateExists(gateId)) {
    // Fail closed. An unrecognised gate is a defect, not a permission.
    throw new UnknownGateError(`Unknown skill gate: "${gateId}"`);
  }
  return GATES[gateId](ctx ?? {});
}

/** Convenience: filter a candidate list through their gates. */
export function filterByGates(exercises, ctx) {
  const allowed = [];
  const blocked = [];
  for (const ex of exercises) {
    const result = evaluateGate(ex.skillGate, ctx);
    (result.allowed ? allowed : blocked).push({ exercise: ex, reason: result.reason });
  }
  return { allowed: allowed.map((a) => a.exercise), blocked };
}
