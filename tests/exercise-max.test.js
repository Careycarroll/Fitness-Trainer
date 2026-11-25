import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isAnchoredLift,
  epley1RM,
  deriveEstimatedMaxes,
  resolveWorkingMax,
  syncEstimatedMaxes,
  buildMaxReadout
} from '../js/engine/exercise-max.js';
import { emptyState, appendExerciseMax, currentMax } from '../js/storage/state.js';

const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, '..', 'js', 'data', 'exercises.seed.json'), 'utf8'));
const catalog = seed.exercises;

test('isAnchoredLift matches compound barbell/trap_bar weight_reps with fatigueCost >= 3', () => {
  const squat = catalog.find((e) => e.id === 'back-squat');
  const skull = catalog.find((e) => e.id === 'ez-bar-skullcrusher');
  assert.equal(isAnchoredLift(squat), true);
  assert.equal(isAnchoredLift(skull), false);
});

test('deriveEstimatedMaxes applies ADR-023 two-tier confidence and ignores 7+ reps and RPE <= 7', () => {
  const sets = [
    { exerciseId: 'back-squat', date: '2026-11-10', weight: 300, weightUnit: 'lb', reps: 10, rpe: 9 }, // ignored (7+ reps)
    { exerciseId: 'back-squat', date: '2026-11-12', weight: 295, weightUnit: 'lb', reps: 5, rpe: 8 },  // tier 2
    { exerciseId: 'back-squat', date: '2026-11-14', weight: 315, weightUnit: 'lb', reps: 2, rpe: 9 },  // tier 1 wins
    { exerciseId: 'barbell-bench-press', date: '2026-11-15', weight: 225, weightUnit: 'lb', reps: 5, rpe: 8 }, // tier 2 only
    { exerciseId: 'conventional-deadlift', date: '2026-11-16', weight: 405, weightUnit: 'lb', reps: 2, rpe: 7 }     // ignored (RPE <= 7)
  ];

  const { byExerciseId, reasons } = deriveEstimatedMaxes(sets, catalog, '2026-11-25');
  assert.equal(byExerciseId.get('back-squat').source, 'estimated');
  assert.equal(byExerciseId.get('back-squat').e1rm, epley1RM(315, 2));
  assert.equal(byExerciseId.get('barbell-bench-press').source, 'estimated_low_confidence');
  assert.equal(byExerciseId.get('conventional-deadlift'), undefined);
  assert.match(reasons.get('conventional-deadlift'), /1–6 reps/);
});

test('resolveWorkingMax and syncEstimatedMaxes do not silently overwrite tested or entered maxes', () => {
  let state = emptyState();
  state = appendExerciseMax(state, {
    id: 'm1',
    exerciseId: 'back-squat',
    e1rm: 315,
    source: 'entered',
    effectiveDate: '2026-11-01'
  });
  state = {
    ...state,
    importedSets: [
      {
        id: 's1', source: 'fitnotes', exerciseId: 'back-squat',
        sourceExerciseId: '1', sourceExerciseName: 'Barbell Squat',
        date: '2026-11-20', setIndex: 0,
        weight: 330, weightUnit: 'lb', reps: 2,
        seconds: null, distance: null, distanceUnit: null, rpe: 9, notes: null
      }
    ]
  };

  const synced = syncEstimatedMaxes(state, catalog, '2026-11-25');
  assert.equal(currentMax(synced, 'back-squat').source, 'entered');
  assert.equal(currentMax(synced, 'back-squat').e1rm, 315);

  const { byExerciseId } = deriveEstimatedMaxes(state.importedSets, catalog, '2026-11-25');
  const resolved = resolveWorkingMax(state, 'back-squat', byExerciseId.get('back-squat'));
  assert.equal(resolved.workingMax.e1rm, 315);
  assert.match(resolved.precedenceFlag, /352/);
});

test('buildMaxReadout is read-only and keeps estimated 1RM separate from actual personal bests', () => {
  const state = {
    ...emptyState(),
    meta: { lastImportAt: '2026-11-01T10:00:00.000Z' },
    importedSets: [
      {
        id: 's1', source: 'fitnotes', exerciseId: 'barbell-bench-press',
        sourceExerciseId: '2', sourceExerciseName: 'Bench Press',
        date: '2026-11-18', setIndex: 0,
        weight: 225, weightUnit: 'lb', reps: 5,
        seconds: null, distance: null, distanceUnit: null, rpe: 9, notes: null
      },
      {
        id: 's2', source: 'fitnotes', exerciseId: null,
        sourceExerciseId: '999', sourceExerciseName: 'Mystery Lift',
        date: '2026-11-18', setIndex: 0,
        weight: 100, weightUnit: 'lb', reps: 10,
        seconds: null, distance: null, distanceUnit: null, rpe: null, notes: null
      }
    ]
  };
  const beforeJson = JSON.stringify(state);

  const readout = buildMaxReadout({ state, catalog, asOfDate: '2026-11-25' });
  assert.equal(JSON.stringify(state), beforeJson);
  assert.equal(readout.isStale, true);
  assert.equal(readout.daysSinceImport, 24);
  assert.equal(readout.unresolvedSetCount, 1);
  assert.equal(readout.unresolvedExerciseCount, 1);

  const bench = readout.anchoredLifts.find((r) => r.exerciseId === 'barbell-bench-press');
  assert.equal(bench.workingMax.source, 'estimated_low_confidence');
  assert.equal(bench.workingMax.e1rm, 262.5);
  assert.equal(bench.personalBest.weight, 225);
  assert.equal(bench.personalBest.reps, 5);
});
