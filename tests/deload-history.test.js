import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateDeloadTriggers } from '../js/engine/deload.js';
import { createAppDb } from '../js/storage/app-db.js';
import { queryHistoryPerLift } from '../js/ui/trends.js';

const progression = JSON.parse(readFileSync('js/data/progression.json', 'utf8'));
const seed = JSON.parse(readFileSync('js/data/exercises.seed.json', 'utf8')).exercises;

describe('Deload triggers (#70) and History per lift (#71)', () => {
  test('evaluateDeloadTriggers fails closed when inputs are missing', () => {
    const res = evaluateDeloadTriggers(progression.deloadTriggers, {});
    assert.equal(res.anyTriggered, false);
    assert.equal(res.triggers.length, 3);
    assert.ok(res.triggers.every((t) => t.status === 'unevaluable' && t.triggered === null));
  });

  test('evaluateDeloadTriggers fires on MRV exceedance, low RIR, and consecutive stalls', () => {
    const res = evaluateDeloadTriggers(progression.deloadTriggers, {
      weeklyVolume: [{ muscle: 'quads', sets: 22, mrv: 20 }],
      recentRirs: [0, 0.5, 0],
      liftSeries: [{ exerciseId: 'back-squat', exerciseName: 'Back Squat', values: [150, 145, 145, 140] }]
    });
    assert.equal(res.anyTriggered, true);
    assert.ok(res.triggers.every((t) => t.status === 'evaluated' && t.triggered === true));
  });

  test('queryHistoryPerLift returns sets grouped by date, newest first, and handles empty history', async () => {
    const db = await createAppDb(seed);
    try {
      assert.deepEqual(queryHistoryPerLift(db, 'back-squat'), []);

      db.run("INSERT INTO workout_sessions (id, date, title, source, status) VALUES ('s1', '2026-11-10', 'Old', 'custom', 'completed')");
      db.run("INSERT INTO workout_sessions (id, date, title, source, status) VALUES ('s2', '2026-11-20', 'New', 'custom', 'completed')");
      db.run("INSERT INTO workout_blocks (id, session_id, order_index, block_type) VALUES ('b1', 's1', 0, 'straight'), ('b2', 's2', 0, 'straight')");
      db.run("INSERT INTO logged_sets (id, session_id, block_id, exercise_id, order_index, weight_kg, reps, is_complete) VALUES ('st1', 's1', 'b1', 'back-squat', 0, 100, 5, 1), ('st2', 's2', 'b2', 'back-squat', 0, 110, 5, 1)");

      const hist = queryHistoryPerLift(db, 'back-squat');
      assert.equal(hist.length, 2);
      assert.equal(hist[0].date, '2026-11-20');
      assert.equal(hist[1].date, '2026-11-10');
    } finally {
      db.close();
    }
  });
});
