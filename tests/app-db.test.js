import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APP_SCHEMA_VERSION,
  createAppDb,
  openAppDb,
  exportAppDb,
  seedExercises,
  softResetTrainingMax,
  getSetting,
  setSetting,
  getAppDbStats,
  migrateFitNotesToAppDb
} from '../js/storage/app-db.js';
import { getSql } from '../js/storage/sqlite-injector.js';

describe('Standalone AppDB Schema & Migration (ADR-033)', () => {
  test('createAppDb initializes all tables, indexes, and schema_migrations', async () => {
    const db = await createAppDb();
    try {
      const tables = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )[0].values.map((r) => r[0]);

      for (const expected of [
        'body_metrics',
        'equipment_profiles',
        'exercises',
        'logged_sets',
        'meal_logs',
        'meal_presets',
        'performance_records',
        'plans',
        'schema_migrations',
        'user_settings',
        'workout_blocks',
        'workout_sessions',
        'workout_templates'
      ]) {
        assert.ok(tables.includes(expected), `missing table ${expected}`);
      }

      const ver = db.exec('SELECT version FROM schema_migrations')[0].values[0][0];
      assert.equal(ver, APP_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  test('seedExercises upserts shipped catalog while preserving user_rest_sec', async () => {
    const seed = JSON.parse(readFileSync('js/data/exercises.seed.json', 'utf8')).exercises;
    const db = await createAppDb(seed);
    try {
      const count = db.exec('SELECT COUNT(*) FROM exercises WHERE is_custom = 0')[0].values[0][0];
      assert.equal(count, seed.length);

      // User customizes rest time on back-squat
      db.run("UPDATE exercises SET user_rest_sec = 240 WHERE id = 'back-squat'");

      // Re-run seedExercises (simulating app upgrade)
      seedExercises(db, seed);

      const row = db.exec(
        "SELECT default_rest_sec, user_rest_sec FROM exercises WHERE id = 'back-squat'"
      )[0].values[0];
      assert.equal(row[0], 180);
      assert.equal(row[1], 240, 'user_rest_sec must survive catalog refresh');
    } finally {
      db.close();
    }
  });

  test('supports drop sets via parent_set_id and drop_index, plus export/re-open round-trip', async () => {
    const seed = JSON.parse(readFileSync('js/data/exercises.seed.json', 'utf8')).exercises;
    const db = await createAppDb(seed);

    db.run("INSERT INTO workout_sessions (id, date, title, source, status) VALUES ('s1', '2026-11-24', 'Push', 'custom', 'completed')");
    db.run("INSERT INTO workout_blocks (id, session_id, order_index, block_type) VALUES ('b1', 's1', 0, 'straight')");
    db.run("INSERT INTO logged_sets (id, session_id, block_id, exercise_id, order_index, set_type, weight_kg, reps, is_complete) VALUES ('set1', 's1', 'b1', 'back-squat', 0, 'working', 100, 8, 1)");
    db.run("INSERT INTO logged_sets (id, session_id, block_id, exercise_id, order_index, set_type, parent_set_id, drop_index, weight_kg, reps, is_complete) VALUES ('drop1', 's1', 'b1', 'back-squat', 1, 'drop', 'set1', 1, 80, 8, 1)");

    const buf = exportAppDb(db);
    db.close();

    const reopened = await openAppDb(buf);
    try {
      const drops = reopened.exec(
        "SELECT parent_set_id, drop_index, weight_kg FROM logged_sets WHERE set_type = 'drop'"
      )[0].values[0];
      assert.equal(drops[0], 'set1');
      assert.equal(drops[1], 1);
      assert.equal(drops[2], 80);
    } finally {
      reopened.close();
    }
  });

  test('migrateFitNotesToAppDb converts FitNotes history idempotently with PR records', async () => {
    const seed = JSON.parse(readFileSync('js/data/exercises.seed.json', 'utf8')).exercises;
    const appDb = await createAppDb(seed);

    const SQL = await getSql();
    const fnDb = new SQL.Database();
    fnDb.run('CREATE TABLE exercise (_id INTEGER PRIMARY KEY, name TEXT, category_id INTEGER, exercise_type_id INTEGER DEFAULT 0)');
    fnDb.run('CREATE TABLE training_log (_id INTEGER PRIMARY KEY, exercise_id INTEGER, date TEXT, metric_weight REAL, reps INTEGER, unit INTEGER DEFAULT 2, is_complete INTEGER DEFAULT 1, duration_seconds INTEGER DEFAULT 0, distance REAL DEFAULT 0)');
    fnDb.run('CREATE TABLE WorkoutComment (_id INTEGER PRIMARY KEY, date TEXT, comment TEXT)');
    fnDb.run('CREATE TABLE Comment (_id INTEGER PRIMARY KEY, date TEXT, owner_type_id INTEGER, owner_id INTEGER, comment TEXT)');

    fnDb.run("INSERT INTO exercise VALUES (1, 'Back Squat', 1, 0), (2, 'Plank (Time)', 2, 3), (3, 'Weird Custom Lift', 1, 0)");
    fnDb.run("INSERT INTO training_log VALUES (1, 1, '2026-11-20', 100, 5, 2, 1, 0, 0)");
    fnDb.run("INSERT INTO training_log VALUES (2, 1, '2026-11-20', 110, 5, 2, 1, 0, 0)");
    fnDb.run("INSERT INTO training_log VALUES (3, 2, '2026-11-20', 0, 0, 2, 1, 90, 0)");
    fnDb.run("INSERT INTO training_log VALUES (4, 3, '2026-11-21', 40, 10, 2, 1, 0, 0)");
    fnDb.run("INSERT INTO training_log VALUES (5, 1, '2026-11-22', 80, 5, 2, 0, 0, 0)"); // incomplete -> skipped by default
    fnDb.run("INSERT INTO WorkoutComment VALUES (1, '2026-11-20', 'Heavy day')");
    fnDb.run("INSERT INTO Comment VALUES (1, '2026-11-20', 1, 2, 'Felt strong')");

    const fnBuf = fnDb.export();
    fnDb.close();

    const first = await migrateFitNotesToAppDb(appDb, fnBuf);
    assert.equal(first.importedSessions, 2);
    assert.equal(first.importedSets, 4);
    assert.equal(first.createdCustomExercises, 1);
    assert.ok(first.recordsCreated >= 3);

    // Re-running must be idempotent
    const second = await migrateFitNotesToAppDb(appDb, fnBuf);
    assert.equal(second.importedSessions, 0);
    assert.equal(second.skippedDates, 2);

    const custom = appDb.exec("SELECT id, name FROM exercises WHERE is_custom = 1")[0].values[0];
    assert.equal(custom[0], 'custom:weird-custom-lift');
    assert.equal(custom[1], 'Weird Custom Lift');

    const pr = appDb.exec("SELECT value_primary FROM performance_records WHERE exercise_id = 'back-squat' ORDER BY value_primary DESC LIMIT 1")[0].values[0][0];
    assert.ok(pr > 125, '110kg x 5 should compute e1RM ~128.33kg');

    appDb.close();
  });

  test('softResetTrainingMax increments active_epoch while preserving lifetime PRs', async () => {
    const seed = JSON.parse(readFileSync('js/data/exercises.seed.json', 'utf8')).exercises;
    const db = await createAppDb(seed);
    try {
      db.run("INSERT INTO performance_records (id, record_type, exercise_id, date, epoch, value_primary, is_pr, is_epoch_pr, created_at) VALUES ('r1', 'e1rm', 'back-squat', '2026-06-01', 1, 160, 1, 1, '2026-06-01T00:00:00Z')");
      softResetTrainingMax(db, 'back-squat');

      const epoch = db.exec("SELECT active_epoch FROM exercises WHERE id = 'back-squat'")[0].values[0][0];
      assert.equal(epoch, 2);

      // New comeback record in epoch 2 (lower than lifetime 160kg PR)
      db.run("INSERT INTO performance_records (id, record_type, exercise_id, date, epoch, value_primary, is_pr, is_epoch_pr, created_at) VALUES ('r2', 'e1rm', 'back-squat', '2026-11-24', 2, 120, 0, 1, '2026-11-24T00:00:00Z')");

      const allTime = db.exec("SELECT MAX(value_primary) FROM performance_records WHERE exercise_id = 'back-squat'")[0].values[0][0];
      const currentEpochBest = db.exec("SELECT MAX(value_primary) FROM performance_records p JOIN exercises e ON e.id = p.exercise_id WHERE p.exercise_id = 'back-squat' AND p.epoch = e.active_epoch")[0].values[0][0];

      assert.equal(allTime, 160, 'lifetime PR must remain intact');
      assert.equal(currentEpochBest, 120, 'current epoch baseline reflects post-reset max');
    } finally {
      db.close();
    }
  });

  test('supports user_settings, meal_logs, meal_presets, and getAppDbStats', async () => {
    const db = await createAppDb();
    try {
      setSetting(db, 'display_unit', 'lb');
      assert.equal(getSetting(db, 'display_unit'), 'lb');
      assert.equal(getSetting(db, 'missing_key', 'default'), 'default');

      db.run(
        "INSERT INTO meal_presets (id, name, meal_slot, calories, protein_g, carbs_g, fat_g, created_at) VALUES ('mp1', 'Chicken & Rice', 'lunch', 650, 50, 70, 14, '2026-11-25T00:00:00Z')"
      );
      db.run(
        "INSERT INTO meal_logs (id, date, meal_slot, name, calories, protein_g, carbs_g, fat_g, created_at) VALUES ('ml1', '2026-11-25', 'lunch', 'Chicken & Rice', 650, 50, 70, 14, '2026-11-25T12:00:00Z')"
      );

      const stats = getAppDbStats(db);
      assert.equal(stats.meals, 1);
      assert.equal(stats.sessions, 0);
    } finally {
      db.close();
    }
  });
});
