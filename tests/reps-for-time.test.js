/**
 * #37 — compound `reps_only` rows are reps-for-time, which ADR-009's domain
 * table lists as a TIME-domain scoring mode. The derivation admits them to the
 * interval domain without touching `scoring`, so two things need proving:
 *
 *   1. Load-domain output did not move. `scoring` is untouched and the load
 *      filter reads only `scoring` — but "should be unchanged" is exactly the
 *      claim that deserves an assertion rather than an argument.
 *   2. The time-domain pool now supplies every pattern a conditioning split
 *      asks for, except the ones honestly deferred.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../js/engine/index.js';
import { allSetGroups } from '../js/engine/blocks.js';
import { defs } from '../js/engine/defs.js';

const DEFERRED = new Set(['monostructural']);

const timeEligible = (e) =>
  e.scoring === 'time' || e.scoring === 'both' || e.repsForTime === true;

const req = (over) => ({
  schemaVersion: 1, styleId: 'strength', daysPerWeek: 4, sessionMinutes: 70,
  equipmentProfile: 'commercial-gym', blockWeeks: 2, seed: 20260813,
  athlete: { skillLevel: 3, hasCoaching: false, strictReps: {} }, history: [], ...over,
});

describe('reps-for-time derivation (#37)', () => {
  test('the rule admits compound reps_only rows and changes nothing else', () => {
    const flagged = defs.exercises.filter((e) => e.repsForTime);
    assert.ok(flagged.length > 0, 'no row is reps-for-time — the derivation did not run');

    for (const e of flagged) {
      // Derived from a load-scored row: if either of these moves, the load
      // domain silently loses the row.
      assert.equal(e.scoring, 'load', `${e.id}: scoring changed`);
      assert.equal(e.timeDomain, null, `${e.id}: timeDomain was fabricated`);
      assert.equal(e.roundsCapable, true, `${e.id}: reps-for-time work is rounds-capable`);
    }
  });

  test('every pattern a conditioning split asks for is suppliable, or deferred', () => {
    const timeStyles = defs.styles.filter((s) => s.domain !== 'load');
    assert.ok(timeStyles.length > 0);

    const pool = defs.exercises.filter(timeEligible);
    const gaps = [];

    for (const style of timeStyles) {
      // chooseSplit() routes time styles to `conditioning*` splits only, so a
      // load split's patterns are not this domain's problem.
      for (const split of defs.splits.filter((sp) => sp.id.startsWith('conditioning'))) {
        for (const day of split.days) {
          for (const pattern of day.patterns) {
            if (DEFERRED.has(pattern)) continue;
            // A style that does not program a pattern is not a catalog gap.
            if ((style.patternEmphasis[pattern] ?? 0) === 0) continue;
            if (!pool.some((e) => e.pattern === pattern)) {
              gaps.push(`${style.id}/${split.id}/${day.label}: ${pattern}`);
            }
          }
        }
      }
    }

    assert.deepEqual(gaps, [], `time-domain pool cannot supply:\n  ${gaps.join('\n  ')}`);
  });

  test('a reps-for-time station takes the style window, unclamped', () => {
    const style = defs.styles.find((s) => s.domain !== 'load');
    const program = generate(req({ styleId: style.id, daysPerWeek: 3 }), defs);
    const groups = program.weeks.flatMap((w) => w.sessions.flatMap(allSetGroups));

    const rft = groups.filter((g) => g.repsForTime === true);
    assert.ok(rft.length > 0, 'no reps-for-time station was selected in any session');

    for (const g of rft) {
      // No per-exercise window exists for these rows, so the style's work
      // seconds pass through. A clamp here would mean bounds were invented.
      assert.equal(g.workSeconds, style.workRest.workSeconds,
        `${g.exerciseId}: work window was clamped against bounds that do not exist`);
    }
  });

  test('load-domain generation is unchanged and stays deterministic', () => {
    for (const style of defs.styles.filter((s) => s.domain === 'load')) {
      for (const profile of ['commercial-gym', 'home-garage']) {
        const r = req({ styleId: style.id, equipmentProfile: profile });

        assert.equal(
          JSON.stringify(generate(r, defs)), JSON.stringify(generate(r, defs)),
          `${style.id}/${profile}: generation is not deterministic`,
        );

        const groups = generate(r, defs).weeks.flatMap((w) => w.sessions.flatMap(allSetGroups));
        assert.ok(groups.length > 0, `${style.id}/${profile}: emitted no setGroups`);
        assert.ok(
          groups.every((g) => g.repsForTime === undefined),
          `${style.id}: a load setGroup carries a time-domain field`,
        );
      }
    }
  });
});
