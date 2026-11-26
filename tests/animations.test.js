import test from 'node:test';
import assert from 'node:assert/strict';
import { defs } from '../js/engine/defs.js';
import animations from '../js/data/animations.json' with { type: 'json' };

const REQUIRED_NUMERIC_KEYS = [
  'hipX', 'hipY', 'torso', 'head',
  'thighF', 'shinF', 'footF',
  'thighB', 'shinB', 'footB',
  'uArmF', 'fArmF', 'uArmB', 'fArmB'
];

test('animations.json covers every shipped exercise and family', () => {
  for (const ex of defs.exercises) {
    const spec = animations.exercises?.[ex.id] ?? animations.families?.[ex.exerciseFamily];
    assert.ok(spec, `missing animation spec for ${ex.id} (family: ${ex.exerciseFamily})`);
    assert.ok(Array.isArray(spec.keyframes) && spec.keyframes.length >= 2, `${ex.id} needs >=2 keyframes`);
    for (const kf of spec.keyframes) {
      for (const key of REQUIRED_NUMERIC_KEYS) {
        assert.equal(typeof kf[key], 'number', `${ex.id} keyframe missing numeric ${key}`);
      }
    }
  }
});
