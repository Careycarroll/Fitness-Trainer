import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAppDb, softResetTrainingMax } from '../js/storage/app-db.js';
import {
  queryExerciseTrend,
  queryWeeklyWorkouts,
  queryBodyweightTrend,
  addBodyMetric,
  renderSvgLineChart,
  renderSvgBarChart,
  addMealLog,
  queryMealsForDate,
  queryMealPresets,
  logMealFromPreset,
  getNutritionTargets,
  setNutritionTargets
} from '../js/ui/trends.js';

const seed = JSON.parse(readFileSync('js/data/exercises.seed.json', 'utf8')).exercises;

describe('Graphical Trends & Basic Meal Tracker (#108)', () => {
  test('queryExerciseTrend tracks records across epochs and renders SVG line chart', async () => {
    const db = await createAppDb(seed);
    try {
      db.run("INSERT INTO performance_records (id, record_type, exercise_id, date, epoch, value_primary, is_pr, is_epoch_pr, created_at) VALUES ('p1', 'e1rm', 'back-squat', '2026-10-01', 1, 150, 1, 1, '2026-10-01T00:00:00Z')");
      softResetTrainingMax(db, 'back-squat');
      db.run("INSERT INTO performance_records (id, record_type, exercise_id, date, epoch, value_primary, is_pr, is_epoch_pr, created_at) VALUES ('p2', 'e1rm', 'back-squat', '2026-11-25', 2, 120, 0, 1, '2026-11-25T00:00:00Z')");

      const trend = queryExerciseTrend(db, 'back-squat');
      assert.equal(trend.activeEpoch, 2);
      assert.equal(trend.allTimeBest, 150);
      assert.equal(trend.currentEpochBest, 120);
      assert.equal(trend.points.length, 2);

      const svg = renderSvgLineChart(trend.points, { unitSuffix: ' kg' });
      assert.ok(svg.includes('<svg'));
      assert.ok(svg.includes('<polyline'));
    } finally {
      db.close();
    }
  });

  test('queryWeeklyWorkouts and bodyweight trend render cleanly', async () => {
    const db = await createAppDb(seed);
    try {
      db.run("INSERT INTO workout_sessions (id, date, title, source, status) VALUES ('s1', '2026-11-25', 'Squat Day', 'custom', 'completed')");
      const weeks = queryWeeklyWorkouts(db);
      assert.equal(weeks.length, 1);
      assert.equal(weeks[0].workouts, 1);

      const barSvg = renderSvgBarChart(weeks);
      assert.ok(barSvg.includes('<rect'));

      addBodyMetric(db, { date: '2026-11-25', weightKg: 82.5 });
      const bw = queryBodyweightTrend(db);
      assert.equal(bw.length, 1);
      assert.equal(bw[0].weightKg, 82.5);
    } finally {
      db.close();
    }
  });

  test('meal tracker logs meals, presets, targets, and sums daily macros', async () => {
    const db = await createAppDb();
    try {
      setNutritionTargets(db, { calories: 2600, proteinG: 200, carbsG: 260, fatG: 80 });
      assert.equal(getNutritionTargets(db).proteinG, 200);

      addMealLog(db, {
        date: '2026-11-25',
        mealSlot: 'breakfast',
        name: 'Eggs & Oats',
        calories: 550,
        proteinG: 35,
        carbsG: 60,
        fatG: 18,
        saveAsPreset: true
      });

      const presets = queryMealPresets(db);
      assert.equal(presets.length, 1);

      logMealFromPreset(db, presets[0].id, '2026-11-25', 'snack');
      const day = queryMealsForDate(db, '2026-11-25');
      assert.equal(day.meals.length, 2);
      assert.equal(day.totals.calories, 1100);
      assert.equal(day.totals.proteinG, 70);
    } finally {
      db.close();
    }
  });
});
