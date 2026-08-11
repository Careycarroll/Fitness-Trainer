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

  test('interval work respects each exercise timeDomain bounds', () => {
    const byId = Object.fromEntries(defs.exercises.map((e) => [e.id, e]));
    for (const id of ['hiit', 'cardio', 'crossfit']) {
      const p = generate({ ...base, styleId: id, daysPerWeek: 3 }, defs);
      for (const sg of p.weeks[0].sessions.flatMap(allSetGroups)) {
        const ex = byId[sg.exerciseId];
        assert.ok(
          sg.workSeconds >= ex.timeDomain.minSeconds &&
          sg.workSeconds <= ex.timeDomain.maxSeconds,
          `${sg.exerciseId}: ${sg.workSeconds}s outside [${ex.timeDomain.minSeconds},${ex.timeDomain.maxSeconds}]`);
      }
    }
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
