import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generate, RequestError } from '../js/engine/index.js';
import { defs } from '../js/engine/defs.js';
import { allSetGroups, BLOCK_TYPES } from '../js/engine/blocks.js';

const base = {
  schemaVersion: 1,
  styleId: 'strength',
  daysPerWeek: 4,
  sessionMinutes: 70,
  equipmentProfile: 'commercial-gym',
  blockWeeks: 1,
  seed: 20260809,
  history: []
};

/**
 * ADR-027 rewrote the assertions in this file, and the rewrite is the point.
 *
 * The previous version reached into `session.blocks[i].reps` and
 * `session.stations[i].workSeconds` — it asserted on the SHAPE of the output
 * rather than on what the engine had decided. So a restructure that changed
 * nothing about selection or prescription broke the suite anyway, and the
 * breakage carried no information.
 *
 * Everything below goes through `allSetGroups()`. If the container changes
 * again, this file does not.
 */

describe('engine determinism (ADR-002)', () => {
  test('same request produces byte-identical output', () => {
    const a = JSON.stringify(generate(base, defs));
    const b = JSON.stringify(generate(base, defs));
    assert.equal(a, b);
  });

  test('different seed produces different output', () => {
    const a = JSON.stringify(generate(base, defs));
    const b = JSON.stringify(generate({ ...base, seed: 999 }, defs));
    assert.notEqual(a, b);
  });
});

describe('the session count the request asked for is reported (#51)', () => {
  const req = (n, styleId = 'bodybuilding') => ({ ...base, styleId, daysPerWeek: n, seed: 20260813 });

  test('an honoured request reports no mismatch', () => {
    const p = generate(req(4), defs);
    assert.equal(p.sessionMismatch, null);
    assert.equal(p.requestedSessions, 4);
    assert.equal(p.resolvedSessions, 4);
  });

  test('7 requested: both counts and the cause are on the program', () => {
    const p = generate(req(7), defs);
    assert.equal(p.requestedSessions, 7);
    assert.equal(p.resolvedSessions, 6, 'a tie must resolve to the GREATER day count');
    assert.equal(p.splitId, 'ppl-6');
    assert.match(p.sessionMismatch.reason, /no 7-session split template exists/);
    assert.deepEqual(p.sessionMismatch.available, [1, 2, 3, 4, 5, 6]);
  });

  test('the resolved count is the count actually emitted', () => {
    // The reduction was invisible because nothing compared these two numbers.
    for (let n = 1; n <= 7; n += 1) {
      const p = generate(req(n), defs);
      assert.equal(p.weeks[0].sessions.length, p.resolvedSessions,
        `${n} requested: schedule and resolvedSessions disagree`);
    }
  });

  test('conditioning over-delivers, and says so', () => {
    // Only conditioning-3 exists, so 1 and 2 requested resolve UPWARD. The bug
    // is an unreported fallback, not a reduction -- a cap at 6 would miss this
    // entirely, which is why the fix reports rather than clamps.
    for (const n of [1, 2]) {
      const p = generate(req(n, 'hiit'), defs);
      assert.equal(p.resolvedSessions, 3);
      assert.ok(p.resolvedSessions > p.requestedSessions, 'this case adds sessions');
      assert.ok(p.sessionMismatch, `${n}-session conditioning request must report`);
      assert.deepEqual(p.sessionMismatch.available, [3],
        'available must be domain-filtered: load-domain counts are not on offer');
    }
  });

  test('the tie-break does not depend on splits.json order', () => {
    const shuffled = { ...defs, splits: defs.splits.slice().reverse() };
    assert.equal(generate(req(7), shuffled).splitId, generate(req(7), defs).splitId);
  });

  test('reporting changed no generated work (ADR-002)', () => {
    const a = generate(req(4), defs);
    const b = generate(req(4), defs);
    assert.equal(JSON.stringify(a.weeks), JSON.stringify(b.weeks));
  });
});

describe('request contract', () => {
  test('rejects a missing seed', () => {
    const { seed, ...noSeed } = base;
    assert.throws(() => generate(noSeed, defs), RequestError);
  });
  test('rejects an unknown style', () => {
    assert.throws(() => generate({ ...base, styleId: 'yoga' }, defs), RequestError);
  });
  test('rejects blockWeeks out of range', () => {
    assert.throws(() => generate({ ...base, blockWeeks: 13 }, defs), RequestError);
  });
});

describe('mesocycle', () => {
  test('produces the requested number of weeks', () => {
    const program = generate({ ...base, blockWeeks: 8 }, defs);
    assert.equal(program.weeks.length, 8);
    assert.equal(program.weeks[0].sessions.length, 4);
  });
});

describe('domain routing (ADR-010)', () => {
  test('load styles route to the load generator', () => {
    for (const id of ['powerlifting', 'bodybuilding', 'strength', 'core']) {
      assert.equal(generate({ ...base, styleId: id }, defs).domain, 'load');
    }
  });

  test('time styles route to the interval generator', () => {
    for (const id of ['hiit', 'cardio', 'crossfit']) {
      const p = generate({ ...base, styleId: id, daysPerWeek: 3 }, defs);
      assert.equal(p.domain, 'time');
    }
  });
});

// ---------------------------------------------------------------------------
// ADR-027 structural contract.
//
// These are the assertions that make the nesting real rather than decorative:
// both domains emit the same container, and `stations[]` is gone from every
// consumer's view of a session.
// ---------------------------------------------------------------------------

describe('block structure (ADR-027)', () => {
  test('every session in every style emits blocks, never stations', () => {
    for (const style of defs.styles) {
      const p = generate({ ...base, styleId: style.id, daysPerWeek: 3 }, defs);
      for (const session of p.weeks.flatMap((w) => w.sessions)) {
        assert.ok(Array.isArray(session.blocks),
          `${style.id}/${session.label}: session has no blocks array`);
        assert.equal(session.stations, undefined,
          `${style.id}/${session.label}: stations[] is retired by ADR-027`);
      }
    }
  });

  test('every block declares a known blockType and holds at least one setGroup', () => {
    for (const style of defs.styles) {
      const p = generate({ ...base, styleId: style.id, daysPerWeek: 3 }, defs);
      for (const session of p.weeks.flatMap((w) => w.sessions)) {
        for (const block of session.blocks) {
          assert.ok(BLOCK_TYPES.includes(block.blockType),
            `${style.id}: unknown blockType "${block.blockType}"`);
          assert.ok(block.setGroups.length >= 1,
            `${style.id}: ${block.blockType} block has no setGroups`);
        }
      }
    }
  });

  test('a straight block holds exactly one setGroup', () => {
    // The invariant makeBlock() enforces. A two-exercise "straight" block is a
    // superset that failed to declare itself, and nothing downstream would
    // render it as a pairing.
    for (const id of ['powerlifting', 'bodybuilding', 'strength', 'core']) {
      const p = generate({ ...base, styleId: id }, defs);
      for (const block of p.weeks[0].sessions.flatMap((s) => s.blocks)) {
        if (block.blockType !== 'straight') continue;
        assert.equal(block.setGroups.length, 1);
      }
    }
  });

  test('a conditioning session is one block containing every station', () => {
    // The rounds and the cap describe the group, so there is exactly one group.
    for (const id of ['hiit', 'cardio', 'crossfit']) {
      const p = generate({ ...base, styleId: id, daysPerWeek: 3 }, defs);
      for (const session of p.weeks[0].sessions) {
        if (session.blocks.length === 0) continue;   // nothing coverable; omitted[] says so
        assert.equal(session.blocks.length, 1,
          `${id}/${session.label}: expected one circuit/amrap block`);
        const [block] = session.blocks;
        assert.ok(['circuit', 'amrap'].includes(block.blockType));
        assert.equal(block.rounds, session.rounds);
      }
    }
  });

  test('setGroups carry catalog identity, so consumers never re-join', () => {
    // ADR-027: a UI that has to look up 285 rows to render a card is wrong, and
    // pairing cannot check equipment contention without these fields present.
    const p = generate(base, defs);
    for (const sg of allSetGroups(p.weeks[0].sessions[0])) {
      assert.ok(sg.exerciseId);
      assert.ok(Array.isArray(sg.equipment));
      assert.ok(Array.isArray(sg.primaryMuscles));
      assert.equal(typeof sg.fatigueCost, 'number');
    }
  });
});

describe('fatigue budget', () => {
  test('no session exceeds its style budget', () => {
    for (const style of defs.styles) {
      const p = generate({ ...base, styleId: style.id, daysPerWeek: 3 }, defs);
      for (const week of p.weeks) {
        for (const s of week.sessions) {
          assert.ok(s.fatigueUsed <= s.fatigueBudget,
            `${style.id}/${s.label}: ${s.fatigueUsed} > ${s.fatigueBudget}`);
        }
      }
    }
  });

  test('the reported total matches the setGroups actually emitted', () => {
    // Guards a class of bug the flat shape made impossible and the nested one
    // does not: a block dropped without its cost being reclaimed.
    for (const id of ['powerlifting', 'strength']) {
      const p = generate({ ...base, styleId: id }, defs);
      for (const s of p.weeks[0].sessions) {
        const summed = allSetGroups(s).reduce((n, sg) => n + sg.fatigueCost, 0);
        assert.equal(s.fatigueUsed, summed, `${id}/${s.label}`);
      }
    }
  });
});

import { AMRAP_MIN_ROUNDS } from '../js/engine/intervalDomain.js';

/**
 * #42. An AMRAP is "as many rounds as possible against a cap", so a round the
 * athlete cannot finish once is not a round. crossfit shipped Elliptical
 * Trainer 720s beside Wall Sit 90s and a 45s plank: an 855s round against a
 * 720s cap, so stations two and three were unreachable.
 *
 * The hard invariant is that a round fits inside the cap. The derived station
 * window targets AMRAP_MIN_ROUNDS of them, but a row whose own minSeconds
 * exceeds that window clamps UP, so the achieved ratio can fall below the
 * target without the session being broken. Asserting the ratio would make this
 * test fail on catalog changes that are not defects; asserting the fit does
 * not.
 */
describe('AMRAP rounds fit their cap (#42)', () => {
  test('no AMRAP round exceeds its own time cap', () => {
    let amraps = 0;

    for (const id of ['hiit', 'cardio', 'crossfit']) {
      const p = generate({ ...base, styleId: id, daysPerWeek: 3 }, defs);

      for (const session of p.weeks[0].sessions) {
        for (const block of session.blocks) {
          if (block.blockType !== 'amrap') continue;
          amraps += 1;

          const round = block.setGroups.reduce(
            (t, g) => t + g.workSeconds + g.restSeconds, 0);

          assert.ok(round > 0, `${id}: an AMRAP round of zero seconds`);
          assert.ok(
            round <= block.timeCapSeconds,
            `${id}: round ${round}s exceeds the ${block.timeCapSeconds}s cap — ` +
            'the athlete cannot complete one round, so later stations are unreachable');
        }
      }
    }

    assert.ok(amraps > 0, 'no AMRAP block was generated — this test proved nothing');
  });
});

describe('prescriptions are sane', () => {
  test('load prescriptions sit inside the style bands', () => {
    for (const id of ['powerlifting', 'bodybuilding', 'strength', 'core']) {
      const style = defs.styles.find((s) => s.id === id);
      const p = generate({ ...base, styleId: id }, defs);
      for (const sg of p.weeks[0].sessions.flatMap(allSetGroups)) {
        assert.ok(sg.reps >= style.repRange.min && sg.reps <= style.repRange.max,
          `${id}: reps ${sg.reps} outside band`);
        assert.ok(
          sg.intensityOf1RM >= style.intensityBand.min - 1e-9 &&
          sg.intensityOf1RM <= style.intensityBand.max + 1e-9,
          `${id}: intensity ${sg.intensityOf1RM} outside band`);
        assert.ok(sg.sets >= 2);
      }
    }
  });

  /**
   * Two rules, not one (#37). A time-SCORED row carries honest bounds and is
   * clamped to them. A reps-for-time row has none -- its rep columns hold reps,
   * not seconds -- so it takes the STYLE's work window unmodified. Asserting
   * only the first would leave the second path uncovered.
   */
  test('interval work respects each exercise timeDomain bounds', () => {
    const byId = Object.fromEntries(defs.exercises.map((e) => [e.id, e]));
    let clamped = 0;
    let repsForTime = 0;

    for (const id of ['hiit', 'cardio', 'crossfit']) {
      const style = defs.styles.find((s) => s.id === id);
      const p = generate({ ...base, styleId: id, daysPerWeek: 3 }, defs);

      for (const sg of p.weeks[0].sessions.flatMap(allSetGroups)) {
        const ex = byId[sg.exerciseId];

        if (ex.timeDomain) {
          clamped += 1;
          assert.ok(
            sg.workSeconds >= ex.timeDomain.minSeconds &&
            sg.workSeconds <= ex.timeDomain.maxSeconds,
            `${sg.exerciseId}: ${sg.workSeconds}s outside [${ex.timeDomain.minSeconds},${ex.timeDomain.maxSeconds}]`);
          continue;
        }

        repsForTime += 1;
        assert.ok(ex.repsForTime,
          `${sg.exerciseId}: no timeDomain and not repsForTime — it should never have reached the interval pool`);
        assert.ok(sg.repsForTime === true,
          `${sg.exerciseId}: setGroup must carry repsForTime so a consumer can render reps, not a timer`);

        const wr = style.workRest ?? style.intervals ?? {};
        if (wr.workSeconds != null) {
          // #42: `workSeconds` is a PER-STATION window in an interval style and
          // the WHOLE-BLOCK cap in an AMRAP. The rule this test protects is
          // unchanged -- a reps-for-time row takes the station window
          // unmodified -- but for an AMRAP that window is DERIVED from the cap
          // rather than equal to it. Asserting equality with the cap is what
          // demanded twelve minutes of unbroken hip thrusts.
          const isAmrap = wr.restSeconds === 0 && wr.rounds === 1;
          const stations = Math.max(1, style.exercisesPerSession?.min ?? 1);
          const stationSeconds = isAmrap
            ? Math.max(1, Math.floor(wr.workSeconds / (AMRAP_MIN_ROUNDS * stations)))
            : wr.workSeconds;
          assert.equal(sg.workSeconds, stationSeconds,
            `${sg.exerciseId}: reps-for-time takes the station work window unmodified`);
        }
      }
    }

    assert.ok(clamped > 0, 'no time-scored rows exercised — the clamp path is untested');
    assert.ok(repsForTime > 0, 'no reps-for-time rows reached the interval pool (#37 did not take)');
  });

  test('no exercise appears twice in one session', () => {
    for (const style of defs.styles) {
      const p = generate({ ...base, styleId: style.id, daysPerWeek: 3 }, defs);
      for (const s of p.weeks[0].sessions) {
        const ids = allSetGroups(s).map((sg) => sg.exerciseId);
        assert.equal(new Set(ids).size, ids.length, `${style.id}/${s.label}: duplicate exercise`);
      }
    }
  });
});
