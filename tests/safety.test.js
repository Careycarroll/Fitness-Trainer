import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate, gateExists, UnknownGateError, filterByGates } from '../js/engine/safety.js';
import { defs } from '../js/engine/defs.js';
import { generate } from '../js/engine/index.js';

describe('safety gates fail closed (ADR-012)', () => {
  test('an unknown gate id throws rather than permitting', () => {
    assert.throws(() => evaluateGate('does-not-exist', {}), UnknownGateError);
  });

  test('null gate permits', () => {
    assert.equal(evaluateGate(null, {}).allowed, true);
  });

  test('olympic lifts are denied to a low-skill athlete', () => {
    const r = evaluateGate('olympic-lift', { skillLevel: 1, hasCoaching: false });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /skill level/i);
  });

  test('kipping requires strict capacity first', () => {
    assert.equal(evaluateGate('kipping-prerequisite', { strictReps: { 'pull-up': 2 } }).allowed, false);
    assert.equal(evaluateGate('kipping-prerequisite', { strictReps: { 'pull-up': 8 } }).allowed, true);
  });

  test('every gate referenced by the catalog exists in code', () => {
    for (const ex of defs.exercises) {
      if (ex.skillGate) assert.ok(gateExists(ex.skillGate), `${ex.id} -> ${ex.skillGate}`);
    }
  });
});

describe('gates are enforced by the generator, not merely available', () => {
  test('a novice is never prescribed a gated movement', () => {
    const gated = new Set(defs.exercises.filter((e) => e.skillGate).map((e) => e.id));
    const novice = { skillLevel: 1, hasCoaching: false, strictReps: {} };
    for (const styleId of ['crossfit', 'hiit', 'strength']) {
      const p = generate(
        { styleId, daysPerWeek: 3, blockWeeks: 2, seed: 7, equipmentProfile: 'commercial-gym', sessionMinutes: 60, athlete: novice, history: [] },
        defs
      );
      const ids = p.weeks.flatMap((w) => w.sessions.flatMap((s) => (s.blocks ?? s.stations).map((b) => b.exerciseId)));
      for (const id of ids) assert.ok(!gated.has(id), `${styleId}: novice was prescribed gated movement ${id}`);
    }
  });

  test('a qualified athlete can receive them', () => {
    const ready = { skillLevel: 4, hasCoaching: true, strictReps: { 'pull-up': 10, 'pike-push-up': 12 } };
    const { allowed } = filterByGates(defs.exercises, ready);
    assert.ok(allowed.some((e) => e.pattern === 'olympic'));
  });
});
