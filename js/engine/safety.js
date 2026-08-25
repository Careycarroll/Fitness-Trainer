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

/**
 * ONE gate, and that is the honest count (#61).
 *
 * Two others were deleted rather than kept: `kipping-prerequisite` (5+ strict
 * pull-ups) and `inversion-prerequisite` (8+ pike push-ups). Both read
 * `ctx.strictReps`, which every call site hardcoded to `{}`, so both denied
 * unconditionally -- and neither was referenced by any catalog row, so neither
 * ever ran at all. Dead safety code that reads as a working safety system is
 * worse than no gate: it invites the belief that a class of movement is being
 * checked when nothing is.
 *
 * `strictReps` went with them, and it carried a second problem. SPEC.md
 * documented it as `exerciseId -> rep cap, athlete override`; these gates used
 * it as a capacity threshold. Two different features sharing one field name,
 * neither implemented. When something genuinely needs an athlete capability,
 * it gets a field with one meaning and a UI that can set it.
 *
 * Check 04 now asserts every declared gate is referenced by some catalog row,
 * so a gate cannot go dead like this again without failing the build.
 */
const GATES = Object.freeze({
  /**
   * Olympic lifts require demonstrated technical competence, not just strength.
   *
   * Level 4, flat. This used to admit level 3 WITH coaching -- and `hasCoaching`
   * was hardcoded false at every call site, so that branch never ran and the
   * effective threshold was always 4. The denial read "requires skill level 4+"
   * while the real blocker was a field the UI could not set: unactionable advice
   * wearing the shape of a rule.
   */
  'olympic-lift': (ctx) => {
    if ((ctx.skillLevel ?? 0) < 4) {
      return deny(
        'Olympic lifts need experience level 4 — confident with the derived lifts ' +
        '(power clean, push jerk). A comparable pattern is substituted.'
      );
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
 * @param {object} ctx  athlete context: { skillLevel }
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
