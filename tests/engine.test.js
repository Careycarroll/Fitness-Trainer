import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generate, RequestError } from '../js/engine/index.js';
import { defs } from '../js/engine/defs.js';

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
      assert.ok(p.weeks[0].sessions[0].stations !== undefined);
    }
  });
});

describe('fatigue budget', () => {
  test('no session exceeds its style budget', () => {
    for (const style of defs.styles) {
      const p = generate({ ...base, styleId: style.id, daysPerWeek: 3 }, defs);
      for (const week of p.weeks) {
        for (const s of week.sessions) {
          assert.ok(s.fatigueUsed <= s.fatigueBudget, `${style.id}/${s.label}: ${s.fatigueUsed} > ${s.fatigueBudget}`);
        }
      }
    }
  });
});

describe('prescriptions are sane', () => {
  test('load prescriptions sit inside the style bands', () => {
    for (const id of ['powerlifting', 'bodybuilding', 'strength', 'core']) {
      const style = defs.styles.find((s) => s.id === id);
      const p = generate({ ...base, styleId: id }, defs);
      for (const block of p.weeks[0].sessions.flatMap((s) => s.blocks)) {
        assert.ok(block.reps >= style.repRange.min && block.reps <= style.repRange.max, `${id}: reps ${block.reps} outside band`);
        assert.ok(block.intensityOf1RM >= style.intensityBand.min - 1e-9 && block.intensityOf1RM <= style.intensityBand.max + 1e-9, `${id}: intensity ${block.intensityOf1RM} outside band`);
        assert.ok(block.sets >= 2);
      }
    }
  });

  test('interval work respects each exercise timeDomain bounds', () => {
    const byId = Object.fromEntries(defs.exercises.map((e) => [e.id, e]));
    for (const id of ['hiit', 'cardio', 'crossfit']) {
      const p = generate({ ...base, styleId: id, daysPerWeek: 3 }, defs);
      for (const station of p.weeks[0].sessions.flatMap((s) => s.stations)) {
        const ex = byId[station.exerciseId];
        assert.ok(station.workSeconds >= ex.timeDomain.minSeconds && station.workSeconds <= ex.timeDomain.maxSeconds,
          `${station.exerciseId}: ${station.workSeconds}s outside [${ex.timeDomain.minSeconds},${ex.timeDomain.maxSeconds}]`);
      }
    }
  });
});
