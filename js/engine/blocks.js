/**
 * blocks.js — the single constructor and the single reader for session blocks.
 *
 * ADR-027: a Block holds an ordered list of SetGroups. A SetGroup is one
 * exercise plus its prescription. A straight set is a one-element list; there
 * is no special case for the common shape.
 *
 * Why this file exists at all: no abstraction can hide the block shape, because
 * the shape IS the interface between the engine and its consumers. What this
 * file buys is narrower and worth having anyway — the next shape change edits
 * one constructor and one dispatch table instead of six inline literals spread
 * across two generators and a renderer.
 */

/** Every blockType the renderer and editor must handle. */
export const BLOCK_TYPES = ['straight', 'superset', 'circuit', 'emom', 'amrap'];

/**
 * One exercise plus its prescription.
 *
 * `fields` is domain-specific and deliberately not enumerated here: the load
 * domain contributes sets/reps/intensity, the interval domain contributes
 * work/rest seconds. Constraining it would mean this module knowing about both
 * generators, which is the coupling it exists to avoid.
 *
 * @param {object} exercise  catalog row
 * @param {object} fields    prescription
 */
export function makeSetGroup(exercise, fields) {
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    pattern: exercise.pattern,
    // Carried so consumers never need the catalog to answer "can I pair these"
    // or "what does this train". Substitution and pairing both read them, and
    // a UI that has to re-join against 285 rows to render a card is wrong.
    equipment: exercise.equipment,
    primaryMuscles: exercise.primaryMuscles,
    // Added for weekly volume (#44). Indirect work is the larger share for
    // several muscles -- biceps measure 0 direct sets and 20 indirect across a
    // bodybuilding week -- so a consumer counting only primaries reads arms as
    // untrained while the athlete rows and pulls four days a week.
    secondaryMuscles: exercise.secondaryMuscles ?? [],
    // Counted at zero in volume (#44), carried so a consumer can SHOW what a
    // movement braces without re-joining the catalog.
    stabilises: exercise.stabilises ?? [],
    exerciseFamily: exercise.exerciseFamily ?? null,
    fatigueCost: exercise.fatigueCost,
    unilateral: exercise.unilateral,
    warmupRequired: exercise.warmupRequired,
    ...fields
  };
}

/**
 * @param {string} blockType   one of BLOCK_TYPES
 * @param {object[]} setGroups ordered; length 1 for a straight set
 * @param {object} [extra]     group-level fields — rounds, timeCapSeconds
 */
export function makeBlock(blockType, setGroups, extra = {}) {
  if (!BLOCK_TYPES.includes(blockType)) {
    throw new Error(`unknown blockType "${blockType}" (ADR-027)`);
  }
  if (!Array.isArray(setGroups) || setGroups.length === 0) {
    throw new Error(`block "${blockType}" needs at least one setGroup`);
  }
  if (blockType === 'straight' && setGroups.length !== 1) {
    // A straight set with two exercises is a superset that forgot to say so.
    // Silently accepting it would put a pairing in the data that no consumer
    // renders as one.
    throw new Error('blockType "straight" holds exactly one setGroup');
  }
  return {
    blockType,
    setGroups,
    rounds: null,
    timeCapSeconds: null,
    ...extra
  };
}

/** The common case, named so the 90% path reads as one call rather than two. */
export const straightBlock = (exercise, fields) =>
  makeBlock('straight', [makeSetGroup(exercise, fields)]);

// ---------------------------------------------------------------------------
// Readers. Consumers use these instead of reaching into the shape, so a future
// change lands here rather than in every caller.
// ---------------------------------------------------------------------------

/** Every SetGroup in a session, flattened, in order. */
export const allSetGroups = (session) =>
  (session.blocks ?? []).flatMap((b) => b.setGroups);

/** Total fatigue a session's blocks account for. */
export const sessionFatigue = (session) =>
  allSetGroups(session).reduce((n, sg) => n + (sg.fatigueCost ?? 0), 0);

/**
 * Address a SetGroup by (block, setGroup) index. Returns undefined rather than
 * throwing: the UI addresses by index across re-renders and an edit that races
 * a regeneration should no-op, not crash.
 */
export const setGroupAt = (session, b, g) => session.blocks?.[b]?.setGroups?.[g];
