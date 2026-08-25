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
    }

    // EVERY DECLARED GATE MUST BE REACHABLE.
    //
    // The assertion that used to sit here read:
    //
    //   if (ex.skillGate === 'olympic-lift') assert(ex.skillGate !== null, ...)
    //
    // inside a branch where skillGate is already a string. It could not fail.
    // Its own comment records being fixed once after becoming unreachable; it
    // came back vacuous instead, which looks identical to passing.
    //
    // This is the check that would have caught the real defect: `safety.js`
    // shipped two gates -- kipping-prerequisite and inversion-prerequisite --
    // that no catalog row referenced and whose input was hardcoded empty at
    // every call site. Three gates existed, one was live, and nothing said so
    // (#61). A gate nothing reaches is not a safety control.
    const referenced = new Set(defs.exercises.map((ex) => ex.skillGate).filter(Boolean));
    for (const gate of listGates()) {
      assert(referenced.has(gate),
        `gate "${gate}" is declared in js/engine/safety.js but no catalog row references it. ` +
        'An unreachable gate reads as a working safety control and enforces nothing — ' +
        'either author the rows it guards, or delete it.');
    }
  }
};
