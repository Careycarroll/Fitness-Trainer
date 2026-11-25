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

/** Thrown when an unrecognised joint constraint is supplied (#48). Fail closed. */
export class UnknownJointError extends Error {}

export const KNOWN_JOINTS = Object.freeze([
  'ankle', 'elbow', 'hip', 'knee', 'lower_back', 'neck', 'shoulder', 'wrist'
]);
const KNOWN_JOINT_SET = new Set(KNOWN_JOINTS);

export function validateAvoidJoints(avoidJoints) {
  if (avoidJoints == null) return [];
  if (!Array.isArray(avoidJoints)) {
    throw new UnknownJointError('athlete.avoidJoints must be an array');
  }
  for (const j of avoidJoints) {
    if (!KNOWN_JOINT_SET.has(j)) {
      throw new UnknownJointError(`Unknown joint constraint: "${j}"`);
    }
  }
  return avoidJoints;
}

export function allowsExerciseForJoints(exercise, avoidJoints) {
  if (!avoidJoints || avoidJoints.length === 0) return allow();
  validateAvoidJoints(avoidJoints);
  const hit = (exercise?.jointLoad ?? []).find((j) => avoidJoints.includes(j));
  if (hit) {
    return deny(`Excluded by joint constraint (${hit}; not medical guidance)`);
  }
  return allow();
}

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
  },

  /**
   * The ring muscle-up transition (#58).
   *
   * Level 5, and this gate exists because the movement is the one place in the
   * catalog where having the strength is not enough: the transition loads the
   * shoulder at end range under momentum, and a false grip that slips there
   * fails badly rather than gradually.
   *
   * Reads skillLevel ONLY. The obvious test is ring dip capacity, and #61
   * deleted two gates for depending on `strictReps` -- a field no call site
   * supplied, so those gates could never pass and nothing said so. A gate that
   * cannot be evaluated is not a safety control. When athlete capabilities are
   * genuinely captured, this is the first thing that should read them.
   */
  'ring-muscle-up': (ctx) => {
    if ((ctx.skillLevel ?? 0) < 5) {
      return deny(
        'A ring muscle-up needs experience level 5 — the transition loads the ' +
        'shoulder at end range under momentum. A ring dip or pull-up is substituted.'
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

/** Convenience: filter a candidate list through their skill gates and joint constraints. */
export function filterByGates(exercises, ctx) {
  const avoidJoints = validateAvoidJoints(ctx?.avoidJoints);
  const allowed = [];
  const blocked = [];
  for (const ex of exercises) {
    const gateRes = evaluateGate(ex.skillGate, ctx);
    if (!gateRes.allowed) {
      blocked.push({ exercise: ex, reason: gateRes.reason });
      continue;
    }
    const jointRes = allowsExerciseForJoints(ex, avoidJoints);
    (jointRes.allowed ? allowed : blocked).push({ exercise: ex, reason: jointRes.reason });
  }
  return { allowed: allowed.map((a) => a.exercise), blocked };
}
