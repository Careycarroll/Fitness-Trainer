import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAppDb } from '../js/storage/app-db.js';
import {
  createFreestyleSession,
  createSessionFromEngineSession,
  loadActiveWorkout,
  addExerciseToWorkout,
  addSetToBlock,
  addDropSet,
  updateSetFields,
  nextSupersetFocusSetId,
  finishWorkoutSession,
  saveSessionAsTemplate,
  createSessionFromTemplate
} from '../js/ui/logger.js';

const seed = JSON.parse(readFileSync('js/data/exercises.seed.json', 'utf8')).exercises;

describe('In-App Workout Logger (#106)', () => {
  test('creates freestyle session, adds exercises, sets, and grouped drop sets', async () => {
    const db = await createAppDb(seed);
    try {
      const sessId = createFreestyleSession(db, '2026-11-25', 'Upper Push');
      const blockId = addExerciseToWorkout(db, sessId, 'back-squat', { setCount: 2 });
      const extraSetId = addSetToBlock(db, sessId, blockId, 'back-squat');
      updateSetFields(db, extraSetId, { weightKg: 100, reps: 8, isComplete: true });
      const dropId = addDropSet(db, extraSetId);
      assert.ok(dropId);

      const workout = loadActiveWorkout(db, sessId);
      assert.equal(workout.session.title, 'Upper Push');
      assert.equal(workout.blocks.length, 1);
      assert.equal(workout.blocks[0].sets.length, 4);

      const dropSet = workout.blocks[0].sets.find((s) => s.id === dropId);
      assert.equal(dropSet.setType, 'drop');
      assert.equal(dropSet.parentSetId, extraSetId);
      assert.equal(dropSet.dropIndex, 1);
      assert.equal(dropSet.weightKg, 80); // 80% of 100kg
    } finally {
      db.close();
    }
  });

  test('nextSupersetFocusSetId auto-advances between superset exercises in round order', async () => {
    const db = await createAppDb(seed);
    try {
      const engineSess = {
        label: 'Antagonist Superset',
        blocks: [
          {
            blockType: 'superset',
            rounds: 2,
            setGroups: [
              { exerciseId: 'barbell-bench-press', sets: 2, repTarget: 8 },
              { exerciseId: 'barbell-row', sets: 2, repTarget: 8 }
            ]
          }
        ]
      };
      const sessId = createSessionFromEngineSession(db, engineSess, '2026-11-25');
      const workout = loadActiveWorkout(db, sessId);
      const blk = workout.blocks[0];
      assert.equal(blk.sets.length, 4);

      // Checking off Bench Set 1 should advance to Row Set 1
      updateSetFields(db, blk.sets[0].id, { isComplete: true });
      const next1 = nextSupersetFocusSetId(loadActiveWorkout(db, sessId).blocks[0], blk.sets[0].id);
      assert.equal(next1, blk.sets[1].id);
      assert.equal(blk.sets[1].exerciseId, 'barbell-row');

      // Checking off Row Set 1 should advance to Bench Set 2
      updateSetFields(db, blk.sets[1].id, { isComplete: true });
      const next2 = nextSupersetFocusSetId(loadActiveWorkout(db, sessId).blocks[0], blk.sets[1].id);
      assert.equal(next2, blk.sets[2].id);
      assert.equal(blk.sets[2].exerciseId, 'barbell-bench-press');
    } finally {
      db.close();
    }
  });

  test('finishWorkoutSession records PRs and saveSessionAsTemplate round-trips', async () => {
    const db = await createAppDb(seed);
    try {
      const sessId = createFreestyleSession(db, '2026-11-25', 'PR Day');
      const blkId = addExerciseToWorkout(db, sessId, 'back-squat', { setCount: 1 });
      const w = loadActiveWorkout(db, sessId);
      updateSetFields(db, w.blocks[0].sets[0].id, { weightKg: 140, reps: 5, isComplete: true });

      const summary = finishWorkoutSession(db, sessId);
      assert.equal(summary.completedSets, 1);
      assert.equal(summary.newPrs.length, 1);
      assert.equal(summary.newPrs[0].isAllTime, true);

      const tmplId = saveSessionAsTemplate(db, sessId, 'Heavy Squat Template');
      assert.ok(tmplId);

      const cloneSessId = createSessionFromTemplate(db, tmplId, '2026-11-28');
      const cloned = loadActiveWorkout(db, cloneSessId);
      assert.equal(cloned.session.title, 'Heavy Squat Template');
      assert.equal(cloned.blocks[0].sets.length, 1);
      assert.equal(cloned.blocks[0].sets[0].weightKg, 140);
    } finally {
      db.close();
    }
  });
});
