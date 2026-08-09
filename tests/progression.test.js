import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { estimate1RM, best1RM, nextLoad } from '../js/engine/progression.js';
import { defs } from '../js/engine/defs.js';

const coef = defs.progression.epley.coefficient;
const triggers = defs.progression.deloadTriggers;
const linear = defs.progression.models['linear-load'];

describe('1RM estimation', () => {
  test('a single rep at RIR 0 is the 1RM', () => {
    assert.ok(Math.abs(estimate1RM(100, 1, 0, coef) - 103.33) < 0.01);
  });
  test('RIR increases the estimate', () => {
    assert.ok(estimate1RM(100, 5, 2, coef) > estimate1RM(100, 5, 0, coef));
  });
  test('best1RM returns null for an unlogged exercise', () => {
    assert.equal(best1RM([], 'back-squat', coef), null);
  });
});

describe('deload triggers fail closed', () => {
  const session = (vol, rir) => ({ sets: [{ weight: vol, reps: 5, rir }] });

  test('three stalled sessions trigger a deload', () => {
    const recent = [session(100, 2), session(100, 2), session(100, 2), session(100, 2)];
    const r = nextLoad({ exercise: { pattern: 'squat' }, model: linear, recentSessions: recent, deloadTriggers: triggers });
    assert.equal(r.action, 'deload');
  });

  test('grinding sets (low average RIR) trigger a deload even while progressing', () => {
    const recent = [session(100, 0), session(105, 0), session(110, 0)];
    const r = nextLoad({ exercise: { pattern: 'squat' }, model: linear, recentSessions: recent, deloadTriggers: triggers });
    assert.equal(r.action, 'deload');
  });

  test('clean progression increases load, lower body more than upper', () => {
    const recent = [session(100, 3), session(105, 3), session(110, 3)];
    const lower = nextLoad({ exercise: { pattern: 'squat' }, model: linear, recentSessions: recent, deloadTriggers: triggers });
    const upper = nextLoad({ exercise: { pattern: 'horizontalPush' }, model: linear, recentSessions: recent, deloadTriggers: triggers });
    assert.equal(lower.action, 'increase');
    assert.ok(lower.delta > upper.delta);
  });
});
