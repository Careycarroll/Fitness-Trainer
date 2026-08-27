/**
 * #44 — weekly sets per muscle against the volume landmarks.
 *
 * landmarks.json shipped in M2 and no generator read it until now. These tests
 * pin the two rulings that make the numbers mean anything: indirect work counts
 * half, stabilising counts zero.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generate } from '../js/engine/index.js';
import { defs } from '../js/engine/defs.js';
import { weeklyVolume, volumeConcerns, classify, INDIRECT_WEIGHT, STABILISER_WEIGHT } from '../js/engine/volume.js';

const req = (over = {}) => ({
  schemaVersion: 1, styleId: 'bodybuilding', daysPerWeek: 4, blockWeeks: 1,
  equipmentProfile: 'commercial-gym', sessionMinutes: 70, seed: 20260813,
  athlete: { skillLevel: 3 }, history: [], ...over
});

/** A week with one setGroup, so the arithmetic is inspectable. */
const oneGroup = (fields) => ({
  sessions: [{ blocks: [{ setGroups: [{ exerciseId: 'x', sets: 4, ...fields }] }] }]
});

describe('weekly volume counts what it should (#44)', () => {
  test('a direct set counts once, an indirect set counts half', () => {
    const v = weeklyVolume(oneGroup({ primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }),
      defs.landmarks);
    assert.equal(v.chest.total, 4);
    assert.equal(v.triceps.total, 4 * INDIRECT_WEIGHT);
    assert.equal(v.triceps.direct, 0, 'indirect must not inflate the direct count');
    assert.equal(v.triceps.indirect, 4, 'the raw indirect count is kept for display');
  });

  test('stabilising counts for nothing', () => {
    // Bracing under a squat is isometric. The landmarks come from research
    // counting sets where the muscle shortens under load through a range.
    assert.equal(STABILISER_WEIGHT, 0);
    const v = weeklyVolume(oneGroup({ primaryMuscles: ['quads'], secondaryMuscles: [], stabilises: ['abs'] }),
      defs.landmarks);
    assert.equal(v.abs.total, 0);
    assert.equal(v.abs.verdict, 'untrained');
  });

  test('the real catalog produces the numbers the split implies', () => {
    // Regression pins on the shipped catalog: abs must NOT read over MRV on
    // bracing alone, which is what motivated the stabilises split. Before it,
    // abs measured 33 indirect sets and 28.5 total against MRV 20.
    const v = weeklyVolume(generate(req(), defs).weeks[0], defs.landmarks);
    assert.ok(v.abs.total < defs.landmarks.abs.mrv,
      `abs at ${v.abs.total} is at or over MRV ${defs.landmarks.abs.mrv} — bracing is being counted`);
    assert.ok(v.biceps.total >= defs.landmarks.biceps.mev,
      'biceps reach MEV from pulling alone; counting indirect at zero would hide that');
  });

  test('systemic is excluded: it has all-zero landmarks and no rows', () => {
    // It would otherwise report as permanently at MRV. It is a fatigue concept,
    // not a trainable muscle.
    const v = weeklyVolume(generate(req(), defs).weeks[0], defs.landmarks);
    assert.equal(v.systemic, undefined);
  });

  test('every landmarked muscle appears, including untrained ones', () => {
    // A muscle the split never touches is THE finding. Omitting it would hide
    // exactly what this report exists to surface.
    const v = weeklyVolume(generate(req(), defs).weeks[0], defs.landmarks);
    const expected = Object.keys(defs.landmarks).filter((m) => m !== 'systemic').length;
    assert.equal(Object.keys(v).length, expected);
    assert.ok(Object.values(v).some((x) => x.verdict === 'untrained'),
      'this split leaves muscles untrained and the report must say so');
  });

  test('the interval domain reports null, not zeros', () => {
    // It prescribes work and rest seconds; `sets` is null throughout. Zeros
    // would read as "trained nothing", which is false — it trained differently.
    const p = generate(req({ styleId: 'hiit', daysPerWeek: 3 }), defs);
    assert.equal(weeklyVolume(p.weeks[0], defs.landmarks), null);
  });

  test('the program carries volume per week', () => {
    const p = generate(req({ blockWeeks: 2 }), defs);
    assert.equal(p.weeks.length, 2);
    for (const w of p.weeks) assert.ok(w.volume, `week ${w.week} has no volume`);
  });
});

describe('classification and concerns (#44)', () => {
  const l = { mv: 4, mev: 8, mav: 16, mrv: 22 };

  test('each band is named at its boundary', () => {
    assert.equal(classify(0, l), 'untrained');
    assert.equal(classify(2, l), 'below-mv');
    assert.equal(classify(4, l), 'maintenance');
    assert.equal(classify(8, l), 'productive');
    assert.equal(classify(16, l), 'productive');
    assert.equal(classify(17, l), 'above-mav');
    assert.equal(classify(23, l), 'over-mrv');
  });

  test('untrained is distinct from below-mv', () => {
    // Zero sets is a split problem; insufficient sets is a dosing problem.
    assert.notEqual(classify(0, l), classify(1, l));
  });

  test('a muscle with no landmark is reported, not dropped', () => {
    // Check 08 makes this impossible in shipped data. Asserted so an imported
    // row cannot introduce one silently (#63).
    const v = weeklyVolume(oneGroup({ primaryMuscles: ['invented_muscle'], secondaryMuscles: [] }),
      defs.landmarks);
    assert.equal(v.invented_muscle.verdict, 'no-landmark');
    assert.equal(v.invented_muscle.direct, 4);
  });

  test('concerns exclude productive muscles and rank the worst first', () => {
    const v = weeklyVolume(generate(req(), defs).weeks[0], defs.landmarks);
    const c = volumeConcerns(v);
    assert.ok(c.length > 0, 'this split has concerns and they must surface');
    assert.ok(c.every((x) => x.verdict !== 'productive'));
    assert.equal(c[0].verdict, 'over-mrv', 'exceeding what you can recover from ranks first');
  });

  test('no volume yields no concerns rather than throwing', () => {
    assert.deepEqual(volumeConcerns(null), []);
  });
});
