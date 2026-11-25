import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractCatalogFacets,
  filterCatalogExercises,
  formatTrackingLabel
} from '../js/ui/catalog.js';

const exercises = JSON.parse(readFileSync('js/data/exercises.seed.json', 'utf8')).exercises;

describe('Browsable Exercise Catalog (#83)', () => {
  test('extractCatalogFacets derives non-empty muscles, patterns, equipment, and trackingTypes', () => {
    const facets = extractCatalogFacets(exercises);
    assert.ok(facets.muscles.includes('quads'));
    assert.ok(facets.patterns.includes('squat'));
    assert.ok(facets.equipment.includes('barbell'));
    assert.ok(facets.trackingTypes.includes('weight_reps'));
  });

  test('filterCatalogExercises filters by query, muscle, pattern, equipment, and trackingType', () => {
    const squats = filterCatalogExercises(exercises, { query: 'back squat' });
    assert.ok(squats.some((e) => e.id === 'back-squat'));

    const quads = filterCatalogExercises(exercises, { muscle: 'quads', equipment: 'barbell' });
    assert.ok(quads.length > 0);
    assert.ok(quads.every((e) =>
      (e.primaryMuscles.includes('quads') || e.secondaryMuscles.includes('quads')) &&
      e.equipment.includes('barbell')
    ));

    const timed = filterCatalogExercises(exercises, { trackingType: 'time' });
    assert.ok(timed.length > 0);
    assert.ok(timed.every((e) => e.trackingType === 'time'));
  });

  test('filterCatalogExercises respects onlyMyEquipment with owned tokens', () => {
    const bwOnly = filterCatalogExercises(exercises, {
      onlyMyEquipment: true,
      ownedEquipment: []
    });
    assert.ok(bwOnly.length > 0);
    assert.ok(bwOnly.every((e) => e.equipment.every((tok) => tok === 'bodyweight')));

    const noBw = filterCatalogExercises(exercises, {
      excludeNoEquipment: true
    });
    assert.ok(noBw.length > 0);
    assert.ok(noBw.every((e) => e.equipment.some((tok) => tok !== 'bodyweight')));
  });

  test('formatTrackingLabel formats known and fallback tracking types cleanly', () => {
    assert.equal(formatTrackingLabel('weight_reps'), 'Weight & Reps');
    assert.equal(formatTrackingLabel('time'), 'Timed Hold / Interval');
  });
});
