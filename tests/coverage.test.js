import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeCoverage,
  assertCoverage,
  isPerformable,
  CoverageError
} from '../js/engine/coverage.js';

const catalog = [
  { id: 'back-squat', pattern: 'squat', equipment: ['barbell', 'plates', 'rack'] },
  { id: 'goblet-squat', pattern: 'squat', equipment: ['dumbbell'] },
  { id: 'air-squat', pattern: 'squat', equipment: [] },
  { id: 'deadlift', pattern: 'hinge', equipment: ['barbell', 'plates'] },
  { id: 'kb-swing', pattern: 'hinge', equipment: ['kettlebell'] },
  { id: 'bench-press', pattern: 'horizontal-push', equipment: ['barbell', 'plates', 'bench'] },
  { id: 'pushup', pattern: 'horizontal-push', equipment: [] },
  { id: 'pullup', pattern: 'vertical-pull', equipment: ['pullup-bar'] }
];

const garage = {
  id: 'home-garage',
  name: 'My Garage',
  editable: true,
  equipment: ['barbell', 'plates', 'rack', 'bench', 'pullup-bar']
};

const gym = { id: 'commercial-gym', name: 'Commercial Gym', editable: false, assumesAll: true, equipment: [] };

const jumpRopeOnly = { id: 'sparse', name: 'Sparse', editable: true, equipment: ['jump-rope'] };

const patterns = ['squat', 'hinge', 'horizontal-push', 'vertical-pull'];

test('coverage: performability', async (t) => {
  await t.test('all required tokens must be owned', () => {
    const owned = new Set(['barbell', 'plates']);
    assert.equal(isPerformable(catalog[3], owned), true);
    assert.equal(isPerformable(catalog[0], owned), false); // needs rack
  });
  await t.test('no-equipment movements are always performable', () => {
    assert.equal(isPerformable(catalog[2], new Set()), true);
  });
});

test('coverage: profiles', async (t) => {
  await t.test('the garage covers every pattern in the full-body split', () => {
    const { gaps } = analyzeCoverage(garage, patterns, catalog);
    assert.deepEqual(gaps, []);
  });

  await t.test('commercial-gym assumes everything and never gaps', () => {
    const { gaps, optionsByPattern } = analyzeCoverage(gym, patterns, catalog);
    assert.deepEqual(gaps, []);
    assert.equal(optionsByPattern.get('squat').length, 3);
  });

  await t.test('an impoverished profile raises CoverageError, never a session', () => {
    assert.throws(() => assertCoverage(jumpRopeOnly, patterns, catalog), CoverageError);
  });

  await t.test('the error names the pattern and actionable equipment', () => {
    try {
      assertCoverage(jumpRopeOnly, ['hinge'], catalog);
      assert.fail('expected CoverageError');
    } catch (err) {
      assert.ok(err instanceof CoverageError);
      assert.match(err.message, /no 'hinge' option available in profile "Sparse"/);
      assert.match(err.message, /kettlebell/);
      assert.equal(err.gaps[0].pattern, 'hinge');
    }
  });

  await t.test('bodyweight-coverable patterns survive an empty profile', () => {
    const empty = { id: 'none', name: 'Nothing', equipment: [] };
    const { covered, gaps } = analyzeCoverage(empty, patterns, catalog);
    assert.ok(covered.includes('squat'));
    assert.ok(covered.includes('horizontal-push'));
    assert.deepEqual(gaps.map((g) => g.pattern).sort(), ['hinge', 'vertical-pull']);
  });

  await t.test('multiple gaps are all reported, not just the first', () => {
    try {
      assertCoverage(jumpRopeOnly, ['hinge', 'vertical-pull'], catalog);
      assert.fail('expected CoverageError');
    } catch (err) {
      assert.equal(err.gaps.length, 2);
      assert.match(err.message, /Also uncovered: vertical-pull/);
    }
  });

  await t.test('a one-token suggestion is preferred over a multi-token one', () => {
    const partial = { id: 'p', name: 'P', equipment: ['barbell', 'plates'] };
    const { gaps } = analyzeCoverage(partial, ['vertical-pull'], catalog);
    assert.deepEqual(gaps[0].suggests, ['pullup-bar']);
  });
});
