/**
 * #75 — what GOOD selection looks like.
 *
 * The 282 tests that preceded this file assert shape, determinism, and specific
 * past bugs. None assert that a style produces the training it describes, which
 * is why `score()` could grow one term per defect until a trunk style opened
 * with a deadlift and nobody noticed.
 *
 * THESE TESTS ARE EXPECTED TO FAIL until score() is rewritten. That is the
 * point: they document the defects as executable claims rather than as prose in
 * an issue. A test that fails for a stated reason is worth more than a comment
 * saying the same thing.
 *
 * Each assertion is a claim about TRAINING, not about implementation. None of
 * them mention scoring terms, weights or pass order, so the rewrite is free to
 * change all of those.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generate } from '../js/engine/index.js';
import { defs } from '../js/engine/defs.js';
import { allSetGroups } from '../js/engine/blocks.js';
import { weeklyVolume } from '../js/engine/volume.js';

const LOAD_STYLES = defs.styles.filter((s) => s.domain === 'load');
const PROFILES = defs.equipment.map((p) => p.id);
const SEED = 20260813;

const plan = (styleId, daysPerWeek, equipmentProfile = 'commercial-gym', over = {}) =>
  generate({
    schemaVersion: 1, styleId, daysPerWeek, blockWeeks: 1,
    equipmentProfile, sessionMinutes: 70, seed: SEED,
    athlete: { skillLevel: 3 }, history: [], ...over
  }, defs);

const rowOf = (id) => defs.exercises.find((e) => e.id === id);
const sessionsOf = (p) => p.weeks.flatMap((w) => w.sessions);

/** Every (style, profile, days) combination that generates. */
function* everySession() {
  for (const style of LOAD_STYLES) {
    for (const profile of PROFILES) {
      for (let n = 1; n <= 6; n += 1) {
        let p;
        try { p = plan(style.id, n, profile); } catch { continue; }
        for (const [i, session] of sessionsOf(p).entries()) {
          yield { style, profile, days: n, index: i, session, program: p };
        }
      }
    }
  }
}

describe('a session delivers the exercise count it asked for (#75)', () => {
  test('no session falls below the style declared minimum without saying why', () => {
    // core/5 places 4 of 6 twice. It is reported in omitted[] as
    // count-not-reachable, which is honest -- but the cause is the engine
    // spending half a 10-point budget on a back squat the style scores at 0.1
    // emphasis, not a genuine catalog limit.
    const failures = [];
    for (const { style, profile, days, index, session } of everySession()) {
      // Compared against what the SESSION asked for, not the style floor. The
      // first version of this test used exercisesPerSession.min and passed on
      // core/5 placing 4 of 6 -- min is 4, so the assertion was satisfied by a
      // session that lost a third of its work. `exercisesRequested` is the
      // number after the recovery-gap adjustment, which is the real target.
      const want = session.exercisesRequested ?? style.exercisesPerSession?.min ?? 1;
      if (session.exercisesPlaced >= want) continue;
      failures.push(
        `${style.id}/${profile}/${days} session ${index + 1}: placed ` +
        `${session.exercisesPlaced} of ${want} requested ` +
        `(fatigue ${session.fatigueUsed}/${session.fatigueBudget})`
      );
    }
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
  });
});

describe('one exercise cannot consume the session (#75)', () => {
  test('no single exercise costs more than half the session budget', () => {
    // back-squat at f5 against core's budget of 10 leaves 5 points for 5 slots.
    // The main pass scores fatigueCost * 10 -- "the heaviest legal thing" -- and
    // legal only means it fits, never that it leaves the session fillable.
    const failures = [];
    for (const { style, profile, days, index, session } of everySession()) {
      const budget = session.fatigueBudget ?? style.fatigueBudget;
      const want = session.exercisesRequested ?? 1;
      for (const g of allSetGroups(session)) {
        const cost = rowOf(g.exerciseId)?.fatigueCost ?? 0;
        // The rule is about what is LEFT, not what is spent. A main lift must
        // leave enough budget for the remaining slots at the cheapest possible
        // cost of 1 each, or the session cannot finish.
        //
        // The first version asked `cost * 2 <= budget`, which passes back-squat
        // at f5 against core's budget of 10 by exactly one point -- the very
        // case it was written to catch.
        if (budget - cost >= want - 1) continue;
        failures.push(
          `${style.id}/${profile}/${days} session ${index + 1}: ${g.exerciseId} ` +
          `costs ${cost} of ${budget}, leaving ${budget - cost} for ${want - 1} more slots`
        );
      }
    }
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
  });
});

describe('a style leads with a pattern it actually emphasises (#75)', () => {
  test('the main lift is never a pattern the style scores below 0.3', () => {
    // `isMain` is POSITIONAL: index 0 of day.patterns wins the main slot
    // regardless of emphasis. body-part-5 Legs asks for ["squat","lunge","core"],
    // so `core` -- which declares squat 0.1 and core 1.0 -- opens with a squat.
    //
    // 0.3 is the threshold this test proposes: below it, a style is saying "run
    // this if the split demands it", not "lead the session with it".
    const failures = [];
    for (const { style, profile, days, index, session, program } of everySession()) {
      const first = allSetGroups(session)[0];
      if (!first) continue;
      const pattern = rowOf(first.exerciseId)?.pattern;
      const emphasis = style.patternEmphasis?.[pattern] ?? 0;

      // RELATIVE to what the day declares, not an absolute floor.
      //
      // The first version required emphasis >= 0.3 outright, and four failures
      // survived that no reordering could fix: `core` at 6 days uses ppl-6,
      // whose Legs days declare ["squat","hinge","lunge"] -- which core scores
      // 0.1, 0.2, 0.1. Nothing on that day clears 0.3, so the assertion was
      // demanding trunk work from a day that never asks for it. That is a
      // split/style mismatch, not a selection defect, and asserting it here
      // would have held the engine to something the data cannot deliver.
      const split = defs.splits.find((s) => s.id === program.splitId);
      const day = split?.days?.[index % (split?.days?.length ?? 1)];
      const best = Math.max(0, ...(day?.patterns ?? [])
        .map((p) => style.patternEmphasis?.[p] ?? 0));
      if (emphasis >= best) continue;
      failures.push(
        `${style.id}/${profile}/${days} session ${index + 1} opens with ` +
        `${first.exerciseId} (${pattern}, emphasis ${emphasis}) when the day ` +
        `declares a pattern at ${best}`
      );
    }
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
  });
});

describe('the muscles a style emphasises actually get trained (#75)', () => {
  test('every style highest-emphasis pattern reaches MEV on the muscles it trains', () => {
    // The claim in plain terms: if a style says core 1.0, a week of it should
    // train the trunk to the minimum effective volume. Measurable only since
    // #44 -- weeklyVolume() plus landmarks.json.
    const failures = [];
    // Muscles a gate dropped, and why. PRINTED, never silent: a narrowing that
    // cannot be read is indistinguishable from a test that stopped looking.
    const excluded = [];
    const reported = [];
    // RESTORED to the e958115 form. An intermediate version derived this set from
    // `day.muscles` instead, and guarded with `if (!muscles.size) continue;` —
    // which skipped bodybuilding, strength and powerlifting outright, because
    // upper-lower-4 and powerlifting-4 declare `muscles` on no day at all. The
    // suite went green while never examining the three styles the defect was
    // reported against.
    //
    // Known imprecision, kept deliberately: `athletic` is asked for MEV on chest
    // and side_delts because a few explosive rows name them as primary, and
    // powerlifting for erectors, which one heavy hinge day already satisfies as
    // programming. Those two claims are too broad. Narrow them by naming the
    // muscles a style genuinely owes — not by skipping styles whose splits left
    // a field empty.
    for (const style of LOAD_STYLES) {
      const top = Object.entries(style.patternEmphasis ?? {})
        .filter(([, v]) => v >= 0.9).map(([p]) => p);
      if (!top.length) continue;

      // PREDOMINANCE gate.
      //
      // The first version took every primary muscle of every row in the style's
      // 0.9+ patterns. `athletic` emphasises `explosive`, and 3 of 23 explosive
      // rows list chest as primary, so it was asked for 8 sets of chest
      // hypertrophy. A style built on jumps and throws owes none.
      //
      // A muscle is claimed only if the style's own top patterns train it
      // BROADLY. 0.2 is the threshold: primary on at least a fifth of the rows
      // the style leads with. Computed from the catalog, never from
      // `day.muscles` — a split that leaves that field blank must not be able
      // to silence this assertion, which is how an earlier narrowing skipped
      // three styles outright.
      const PREDOMINANCE = 0.2;

      const topRows = defs.exercises.filter((e) => top.includes(e.pattern));
      const tally = new Map();
      for (const e of topRows) {
        for (const m of e.primaryMuscles ?? []) tally.set(m, (tally.get(m) ?? 0) + 1);
      }
      const muscles = new Set();
      for (const [m, n] of tally) {
        if (n / topRows.length >= PREDOMINANCE) muscles.add(m);
        else excluded.push(
          `${style.id}: ${m} not claimed — primary on ${n} of ${topRows.length} ` +
          `rows in ${top.join('/')} (${(n / topRows.length * 100).toFixed(0)}% < ` +
          `${PREDOMINANCE * 100}%)`
        );
      }

      let p;
      try { p = plan(style.id, 4); } catch { continue; }
      const vol = weeklyVolume(p.weeks[0], defs.landmarks);
      if (!vol) continue;

      // CEILING gate.
      //
      // A shortfall is only a DEFECT if the week could have delivered MEV. Each
      // failing muscle in bodybuilding is named on exactly one day, and an
      // accessory slot is max(2, setMin - 1) = 2 sets, so the ceiling is 2-4
      // against MEV 8-10. Perfect selection cannot reach that, and asserting it
      // holds the engine to arithmetic the split does not offer.
      //
      // Below the ceiling the shortfall is REPORTED, not failed — the standing
      // decision is that volume is reported and never enforced. `weeklyVolume()`
      // already says so; this test should not disagree with it.
      const split = defs.splits.find((x) => x.id === p.splitId);
      const accessorySets = Math.max(2, (style.setsPerMainLift?.min ?? 3) - 1);

      for (const m of [...muscles].sort()) {
        const v = vol[m];
        const mev = v?.landmark?.mev;
        if (!mev || v.total >= mev) continue;

        // Serving slots: every declared pattern, on every day, that holds at
        // least one row training this muscle as primary. Equipment is not
        // re-filtered — an unreachable row at commercial-gym is unreachable
        // anywhere, and this is a ceiling, not a prediction.
        let slots = 0;
        for (const d of split?.days ?? []) {
          for (const pat of d.patterns ?? []) {
            if ((style.patternEmphasis?.[pat] ?? 0) === 0) continue;
            const serves = defs.exercises.some((e) =>
              e.pattern === pat && (e.primaryMuscles ?? []).includes(m));
            if (serves) slots += 1;
          }
        }
        const ceiling = slots * accessorySets;

        if (ceiling < mev) {
          reported.push(
            `${style.id}: ${m} ${v.total}/${mev} — unreachable, ceiling ~${ceiling} ` +
            `(${slots} serving slot(s) x ${accessorySets} sets on ${p.splitId})`
          );
          continue;
        }

        failures.push(
          `${style.id} emphasises ${top.join('/')} at 0.9+, but ${m} gets ` +
          `${v.total} sets against MEV ${mev} (reachable: ceiling ~${ceiling})`
        );
      }
    }
    for (const line of excluded) console.log(`      EXCLUDED  ${line}`);
    for (const line of reported) console.log(`      REPORTED  ${line}`);
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
  });
});

describe('what must not regress in the rewrite (#75)', () => {
  test('the same seed still produces byte-identical output', () => {
    for (const style of LOAD_STYLES) {
      const a = JSON.stringify(plan(style.id, 4).weeks);
      assert.equal(a, JSON.stringify(plan(style.id, 4).weeks), `${style.id} is not deterministic`);
    }
  });

  test('no session exceeds its fatigue budget', () => {
    // The budget is a CEILING. Whatever the rewrite does with targeting, this
    // holds.
    for (const { style, profile, days, index, session } of everySession()) {
      assert.ok(session.fatigueUsed <= session.fatigueBudget,
        `${style.id}/${profile}/${days} session ${index + 1}: ` +
        `${session.fatigueUsed} used of ${session.fatigueBudget}`);
    }
  });

  test('every pattern a split day asks for is covered or reported', () => {
    // Silent omission is the failure mode #43 exists to prevent. A pattern that
    // yields nothing must appear in omitted[] with a reason.
    const failures = [];
    for (const { style, profile, days, index, session, program } of everySession()) {
      const split = defs.splits.find((s) => s.id === program.splitId);
      const day = split?.days?.[index % (split?.days?.length ?? 1)];
      if (!day) continue;
      const present = new Set(allSetGroups(session).map((g) => rowOf(g.exerciseId)?.pattern));
      const explained = new Set((session.omitted ?? []).map((o) => o.pattern));
      for (const pattern of day.patterns ?? []) {
        if (present.has(pattern) || explained.has(pattern)) continue;
        if ((style.patternEmphasis?.[pattern] ?? 0) === 0) continue; // not trained by this style
        failures.push(`${style.id}/${profile}/${days} session ${index + 1}: ` +
          `${pattern} neither placed nor reported`);
      }
    }
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
  });
});
