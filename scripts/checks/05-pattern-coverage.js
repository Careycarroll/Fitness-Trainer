import { PATTERNS } from './_enums.js';
import { DEFERRED_PATTERNS, isDeferred } from './_deferred.js';

/**
 * ADR-008 completeness, checked mechanically: every pattern needs >= 2 options
 * or substitution has nowhere to go.
 *
 * ADR-026: patterns whose milestone has not landed are SKIPPED loudly, never
 * silently, and the threshold is not lowered for anything else.
 */
export default {
  id: '05',
  name: 'Pattern coverage (>=2 options per pattern)',

  run(defs, assert) {
    const counts = Object.fromEntries(PATTERNS.map((p) => [p, 0]));
    for (const ex of defs.exercises) {
      if (ex.pattern in counts) counts[ex.pattern]++;
    }

    for (const p of PATTERNS) {
      if (isDeferred(p)) {
        console.log(`        SKIP  pattern "${p}" — deferred: ${DEFERRED_PATTERNS[p]}`);
        // Staleness guard: if a deferred pattern acquires rows, the entry is
        // stale and must be deleted, or the deferral outlives its milestone.
        assert(counts[p] === 0,
          `pattern "${p}" is deferred but has ${counts[p]} catalog row(s). ` +
          `Delete the entry from _deferred.js (${DEFERRED_PATTERNS[p]}).`);
        continue;
      }
      assert(counts[p] >= 2,
        `pattern "${p}" has ${counts[p]} option(s); minimum 2 ` +
        '(substitution needs an alternative)');
    }
  }
};
