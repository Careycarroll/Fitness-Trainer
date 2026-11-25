import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildMonthGrid,
  querySessionsByMonth,
  querySessionsList,
  querySessionExercises,
  formatDisplayWeight
} from '../js/ui/calendar.js';
import { createAppDb } from '../js/storage/app-db.js';

describe('Calendar & Log Queries (#105)', () => {
  test('buildMonthGrid returns complete 7-column weeks for any month', () => {
    const nov2026 = buildMonthGrid(2026, 10); // Nov 2026 starts on Sun
    assert.equal(nov2026.length % 7, 0);
    assert.equal(nov2026[0].date, '2026-11-01');
    assert.equal(nov2026[0].inMonth, true);
    assert.equal(nov2026.filter((c) => c.inMonth).length, 30);

    const feb2026 = buildMonthGrid(2026, 1);
    assert.equal(feb2026.length % 7, 0);
    assert.equal(feb2026.filter((c) => c.inMonth).length, 28);
  });

  test('querySessionsByMonth, querySessionsList, and querySessionExercises return accurate data', async () => {
    const seed = JSON.parse(readFileSync('js/data/exercises.seed.json', 'utf8')).exercises;
    const db = await createAppDb(seed);
    try {
      db.run("INSERT INTO workout_sessions (id, date, title, source, status) VALUES ('s1', '2026-11-25', 'Leg Day', 'custom', 'completed')");
      db.run("INSERT INTO workout_blocks (id, session_id, order_index, block_type) VALUES ('b1', 's1', 0, 'straight')");
      db.run("INSERT INTO logged_sets (id, session_id, block_id, exercise_id, order_index, weight_kg, reps, is_complete) VALUES ('set1', 's1', 'b1', 'back-squat', 0, 102.0582, 5, 1)");

      const monthMap = querySessionsByMonth(db, 2026, 10);
      assert.equal(monthMap.get('2026-11-25').length, 1);
      assert.equal(monthMap.get('2026-11-25')[0].setCount, 1);

      const list = querySessionsList(db);
      assert.equal(list.length, 1);
      assert.equal(list[0].title, 'Leg Day');

      const exGroups = querySessionExercises(db, 's1');
      assert.equal(exGroups.length, 1);
      assert.equal(exGroups[0].exerciseName, 'Back Squat');
      assert.equal(exGroups[0].sets[0].reps, 5);
    } finally {
      db.close();
    }
  });

  test('formatDisplayWeight converts canonical kg to lb and kg', () => {
    assert.equal(formatDisplayWeight(null, 'lb'), 'BW');
    assert.equal(formatDisplayWeight(102.0582, 'lb'), '225 lb');
    assert.equal(formatDisplayWeight(100, 'kg'), '100 kg');
  });
});
