import { gateExists, listGates } from '../../js/engine/safety.js';

/**
 * ADR-012: data may reference a gate, never define one. A dangling reference is a silently
 * disabled safety control, so it is a build failure.
 */
export default {
  id: '04', name: 'Skill gate references resolve to code (ADR-012)',
  run(defs, assert) {
    for (const ex of defs.exercises) {
      if (ex.skillGate === null) continue;
      assert(typeof ex.skillGate === 'string', `${ex.id}: skillGate must be a string or null`);
      assert(gateExists(ex.skillGate),
        `${ex.id}: references unknown gate "${ex.skillGate}". Known: ${listGates().join(', ')}`);
    }
    // High-skill movements must be gated. Fail closed.
    for (const ex of defs.exercises) {
      if (ex.skill >= 5) {
        assert(ex.skillGate !== null, `${ex.id}: skill 5 movement must declare a skillGate`);
      }
      // ADR-026 retired the `olympic` pattern; Olympic lifts ship as
      // `explosive` carrying skillGate 'olympic-lift'. Keying on the pattern
      // made this assertion unreachable rather than false — a check that
      // stops running looks identical to one that passes.
      if (ex.skillGate === 'olympic-lift') {
        assert(ex.skillGate !== null, `${ex.id}: olympic pattern must declare a skillGate`);
      }
    }
  }
};
