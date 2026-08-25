import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate, gateExists, listGates, UnknownGateError, filterByGates } from '../js/engine/safety.js';
import { defs } from '../js/engine/defs.js';
import { generate } from '../js/engine/index.js';

describe('safety gates fail closed (ADR-012)', () => {
  test('an unknown gate id throws rather than permitting', () => {
    assert.throws(() => evaluateGate('does-not-exist', {}), UnknownGateError);
  });

  test('null gate permits', () => {
    assert.equal(evaluateGate(null, {}).allowed, true);
  });

  test('olympic lifts are denied below experience level 4', () => {
    const r = evaluateGate('olympic-lift', { skillLevel: 1 });
    assert.equal(r.allowed, false);
    // Asserts what the athlete can ACT on, not the phrasing. The old reason
    // said "requires skill level 4+" while the real blocker was `hasCoaching`,
    // a field the UI could not set (#61).
    assert.match(r.reason, /level 4/, 'the denial must name the level that would allow it');
    assert.match(r.reason, /substituted/i, 'and say the session is not simply short');
  });

  test('level 3 is denied, level 4 is allowed, with no coaching branch', () => {
    // The gate used to admit level 3 WITH coaching, and `hasCoaching` was
    // hardcoded false at every call site -- so the branch never ran and the
    // threshold was always 4. It is now 4 outright (#61).
    assert.equal(evaluateGate('olympic-lift', { skillLevel: 3 }).allowed, false);
    assert.equal(evaluateGate('olympic-lift', { skillLevel: 4 }).allowed, true);
    assert.equal(evaluateGate('olympic-lift', { skillLevel: 3, hasCoaching: true }).allowed, false,
      'coaching is no longer an input and must not change the answer');
  });

  test('the deleted gates are gone, not merely unreferenced', () => {
    // kipping-prerequisite and inversion-prerequisite both read ctx.strictReps,
    // which every call site hardcoded to {}, and no catalog row referenced
    // either. Three gates, one live. Deleted rather than left as dead safety
    // code that reads as a working control (#61).
    for (const gone of ['kipping-prerequisite', 'inversion-prerequisite']) {
      assert.equal(gateExists(gone), false, `${gone} should have been deleted`);
      assert.throws(() => evaluateGate(gone, {}), /Unknown skill gate/,
        'an unknown gate must throw, not permit');
    }
    assert.deepEqual(listGates(), ['olympic-lift'], 'one gate, and that is the honest count');
  });

  test('every declared gate is referenced by some catalog row', () => {
    // Check 04 enforces this at build time; asserted here too so the reason
    // survives with the code that depends on it.
    const referenced = new Set(defs.exercises.map((ex) => ex.skillGate).filter(Boolean));
    for (const gate of listGates()) {
      assert.ok(referenced.has(gate), `gate "${gate}" is unreachable from the catalog`);
    }
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
    const novice = { skillLevel: 1 };
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
    const ready = { skillLevel: 4 };
    const { allowed } = filterByGates(defs.exercises, ready);
    assert.ok(allowed.some((e) => e.skillGate === 'olympic-lift'));
  });
});
