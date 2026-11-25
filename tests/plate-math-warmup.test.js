import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlateLoaded,
  barWeightFor,
  roundToLoadable,
  computePlateLoad,
  platesForIncrement,
  DEFAULT_PLATES_LB
} from '../js/engine/plate-math.js';
import { prescribeWarmup } from '../js/engine/warmup.js';

describe('Loadable rounding (#17), Plate math (#73), and Warm-up ramp (#72)', () => {
  test('roundToLoadable rounds 82.5% of 315 (259.9 lb) to 260 lb', () => {
    assert.equal(roundToLoadable(315 * 0.825, { increment: 5, minWeight: 45 }), 260);
    assert.equal(roundToLoadable(30, { increment: 5, minWeight: 45 }), 45);
  });

  test('isPlateLoaded and barWeightFor read from exercise equipment', () => {
    const squat = { loadType: 'barbell', equipment: ['barbell', 'rack'] };
    const ssb = { loadType: 'barbell', equipment: ['safety_bar', 'rack'] };
    const db = { loadType: 'dumbbell', equipment: ['dumbbell', 'bench'] };

    assert.equal(isPlateLoaded(squat), true);
    assert.equal(barWeightFor(squat), 45);
    assert.equal(barWeightFor(ssb), 65);
    assert.equal(isPlateLoaded(db), false);
  });

  test('computePlateLoad decomposes 185 lb into 45 + 25 per side and rejects unachievable loads', () => {
    const ok = computePlateLoad(185, { barWeight: 45, plates: DEFAULT_PLATES_LB });
    assert.equal(ok.achievable, true);
    assert.equal(ok.formatted, '45 bar + 45, 25 /side');

    const bad = computePlateLoad(187, { barWeight: 45, plates: DEFAULT_PLATES_LB });
    assert.equal(bad.achievable, false);
    assert.ok(bad.reason.includes('Cannot load'));
  });

  test('prescribeWarmup returns null when warmupRequired is false, weighted ramp when max known, and RIR ramp otherwise', () => {
    assert.equal(prescribeWarmup({ warmupRequired: false }), null);

    const withMax = prescribeWarmup({ warmupRequired: true }, { workingWeight: 225, barWeight: 45 });
    assert.ok(withMax.steps.length >= 3);
    assert.ok(withMax.text.includes('45 lb × 8'));

    const noMax = prescribeWarmup({ warmupRequired: true });
    assert.equal(noMax.steps.length, 3);
    assert.ok(noMax.text.includes('RIR 6+'));
  });

  test('roundToLoadable and platesForIncrement support 0.25 lb micro-plates and custom barWeights', () => {
    assert.equal(roundToLoadable(135.4, { increment: 0.5, minWeight: 35 }), 135.5);
    const microPlates = platesForIncrement(0.5, 'lb');
    assert.equal(microPlates.includes(0.25), true);
    const pm = computePlateLoad(135.5, { barWeight: 45, plates: microPlates, unit: 'lb' });
    assert.equal(pm.achievable, true);
    assert.equal(barWeightFor({ equipment: ['barbell'] }, { barWeights: { barbell: 35 } }), 35);
  });
});
