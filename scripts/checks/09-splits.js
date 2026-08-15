import { PATTERNS } from './_enums.js';
import { DEFERRED_PATTERNS, isDeferred } from './_deferred.js';

export default {
  id: '09', name: 'Split templates reference valid patterns',
  run(defs, assert) {
    // Muscle tokens are checked against what the CATALOG owns rather than
    // against the enum. A token no row lists as primary would weight nothing,
    // and a split day that silently means nothing is worse than one that fails.
    const primaryMuscles = new Set(defs.exercises.flatMap((e) => e.primaryMuscles ?? []));

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

        // `muscles` is optional: it WEIGHTS selection within the day's own
        // patterns so a body-part split is expressible. Patterns alone cannot
        // say it -- "Chest & Triceps" and "Shoulders & Arms" are both
        // push_h/push_v/isolation. Absent or empty means unweighted.
        if (d.muscles !== undefined) {
          assert(Array.isArray(d.muscles) && d.muscles.length > 0,
            `${s.id}/${d.label}: muscles must be a non-empty array when present`);
          assert(new Set(d.muscles).size === d.muscles.length,
            `${s.id}/${d.label}: duplicate muscle token`);
          for (const m of d.muscles) {
            assert(primaryMuscles.has(m),
              `${s.id}/${d.label}: muscle "${m}" is not a primary muscle of any catalog row, so it weights nothing`);
          }
          // A day whose muscles are unreachable from its own patterns reads as
          // a promise the generator cannot keep.
          const reachable = defs.exercises.some((e) =>
            d.patterns.includes(e.pattern) &&
            (e.primaryMuscles ?? []).some((m) => d.muscles.includes(m)));
          assert(reachable,
            `${s.id}/${d.label}: no catalog row combines this day's patterns with its muscles`);
        }
      }
    }
  }
};
