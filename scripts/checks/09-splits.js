import { PATTERNS } from './_enums.js';
import { DEFERRED_PATTERNS, isDeferred } from './_deferred.js';

export default {
  id: '09', name: 'Split templates reference valid patterns',
  run(defs, assert) {
    for (const s of defs.splits) {
      assert(s.days.length === s.daysPerWeek, `${s.id}: declares ${s.daysPerWeek} days but defines ${s.days.length}`);
      for (const d of s.days) {
        assert(d.patterns.length > 0, `${s.id}/${d.label}: day has no patterns`);
        for (const p of d.patterns) {
          assert(PATTERNS.includes(p), `${s.id}/${d.label}: unknown pattern "${p}"`);
          // A split may reference a pattern whose milestone has not landed.
          // conditioning-3 requires `monostructural`, which is the whole point
          // of shipping the split now: the deferral is visible in the split
          // rather than hidden. Reference validity is still enforced above;
          // only the supply assertion is deferred (ADR-026, ADR-007).
          if (isDeferred(p)) continue;
          const supply = defs.exercises.filter((e) => e.pattern === p).length;
          assert(supply > 0, `${s.id}/${d.label}: pattern "${p}" has no exercises in the catalog`);
        }
      }
    }
  }
};
