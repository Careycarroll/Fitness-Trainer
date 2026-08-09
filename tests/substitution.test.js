import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rankSubstitutes, isAvailable } from '../js/engine/substitution.js';
import { defs } from '../js/engine/defs.js';

const byId = Object.fromEntries(defs.exercises.map((e) => [e.id, e]));
const weights = defs.substitutionWeights;
const commercial = defs.equipment.find((p) => p.id === 'commercial-gym');
const minimal = defs.equipment.find((p) => p.id === 'minimal');

describe('substitution ranks by pattern + equipment', () => {
  test('never returns the target itself', () => {
    const r = rankSubstitutes(byId['back-squat'], defs.exercises, weights, commercial);
    assert.ok(!r.some((x) => x.exercise.id === 'back-squat'));
  });

  test('prefers the same movement pattern', () => {
    const top = rankSubstitutes(byId['back-squat'], defs.exercises, weights, commercial)[0];
    assert.equal(top.exercise.pattern, 'squat');
  });

  test('respects the equipment profile', () => {
    const top = rankSubstitutes(byId['barbell-bench-press'], defs.exercises, weights, minimal)[0];
    assert.ok(isAvailable(top.exercise, minimal), `${top.exercise.id} is not available in the minimal profile`);
  });

  test('every catalog entry has at least one substitute in a commercial gym', () => {
    for (const ex of defs.exercises) {
      const r = rankSubstitutes(ex, defs.exercises, weights, commercial, 1);
      assert.ok(r.length > 0, `${ex.id} has no substitute`);
    }
  });
});
