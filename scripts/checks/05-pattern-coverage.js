import { PATTERNS } from './_enums.js';

/** ADR-008 completeness definition, checked mechanically. */
export default {
  id: '05', name: 'Pattern coverage (>=2 options per pattern)',
  run(defs, assert) {
    const counts = Object.fromEntries(PATTERNS.map((p) => [p, 0]));
    for (const ex of defs.exercises) counts[ex.pattern]++;
    for (const p of PATTERNS) {
      assert(counts[p] >= 2, `pattern "${p}" has ${counts[p]} option(s); minimum 2 (substitution needs an alternative)`);
    }
  }
};
