import { PATTERNS } from './_enums.js';

export default {
  id: '09', name: 'Split templates reference valid patterns',
  run(defs, assert) {
    for (const s of defs.splits) {
      assert(s.days.length === s.daysPerWeek, `${s.id}: declares ${s.daysPerWeek} days but defines ${s.days.length}`);
      for (const d of s.days) {
        assert(d.patterns.length > 0, `${s.id}/${d.label}: day has no patterns`);
        for (const p of d.patterns) {
          assert(PATTERNS.includes(p), `${s.id}/${d.label}: unknown pattern "${p}"`);
          const supply = defs.exercises.filter((e) => e.pattern === p).length;
          assert(supply > 0, `${s.id}/${d.label}: pattern "${p}" has no exercises in the catalog`);
        }
      }
    }
  }
};
