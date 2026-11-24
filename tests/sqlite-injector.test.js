import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inspectDatabase, injectWorkouts, injectCatalog, getSql } from '../js/storage/sqlite-injector.js';

const SAMPLE_DB_PATH = '/Users/careycarroll/.gemini/antigravity/brain/ee93e30f-3978-4fe2-8775-b176195e79cf/.user_uploaded/media_1795479245274_91abe76e.fitnotes';

describe('SQLite WASM Injector for FitNotes Android (#92)', () => {
  test('getSql initializes SQL.js successfully', async () => {
    const SQL = await getSql();
    assert.ok(SQL);
    assert.equal(typeof SQL.Database, 'function');
  });

  test('inspectDatabase reads existing FitNotes database stats', async () => {
    let buf;
    if (existsSync(SAMPLE_DB_PATH)) {
      buf = readFileSync(SAMPLE_DB_PATH);
    } else {
      const SQL = await getSql();
      const db = new SQL.Database();
      db.run('CREATE TABLE exercise (_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category_id INTEGER NOT NULL)');
      db.run('CREATE TABLE training_log (_id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id INTEGER NOT NULL, date DATE NOT NULL, metric_weight INTEGER NOT NULL, reps INTEGER NOT NULL, unit INTEGER NOT NULL DEFAULT 0, is_complete INTEGER NOT NULL DEFAULT 0)');
      db.run('INSERT INTO exercise (name, category_id) VALUES ("Bench Press", 1)');
      db.run('INSERT INTO training_log (exercise_id, date, metric_weight, reps, is_complete) VALUES (1, "2026-11-20", 80, 5, 1)');
      buf = db.export();
      db.close();
    }
    const stats = await inspectDatabase(buf);
    assert.equal(stats.ok, true);
    assert.equal(typeof stats.completedSets, 'number');
    assert.equal(typeof stats.totalExercises, 'number');
    assert.ok(stats.totalExercises >= 1);
  });

  test('injectWorkouts appends planned workouts non-destructively', async () => {
    const SQL = await getSql();
    const db = new SQL.Database();
    
    // Create minimal schema matching FitNotes
    db.run('CREATE TABLE exercise (_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category_id INTEGER NOT NULL, exercise_type_id INTEGER NOT NULL DEFAULT 0, weight_increment INTEGER, default_rest_time INTEGER)');
    db.run('CREATE TABLE training_log (_id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id INTEGER NOT NULL, date DATE NOT NULL, metric_weight INTEGER NOT NULL, reps INTEGER NOT NULL, unit INTEGER NOT NULL DEFAULT 0, is_complete INTEGER NOT NULL DEFAULT 0)');
    db.run('CREATE TABLE Comment (_id INTEGER PRIMARY KEY AUTOINCREMENT, date DATE NOT NULL, owner_type_id INTEGER NOT NULL, owner_id INTEGER NOT NULL, comment TEXT NOT NULL)');
    db.run('CREATE TABLE WorkoutComment (_id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, comment TEXT NOT NULL)');

    // Insert 1 existing historical completed set
    db.run('INSERT INTO exercise (name, category_id) VALUES ("Pull Up", 5)');
    db.run('INSERT INTO training_log (exercise_id, date, metric_weight, reps, is_complete) VALUES (1, "2026-11-20", 0, 15, 1)');

    const baseBuf = db.export();
    db.close();

    const staged = [
      {
        date: '2026-11-24',
        title: 'Barbara',
        description: '5 rounds for time',
        exercises: [
          { name: 'Pull Up', category: 'Back', reps: 20, setCount: 5, loadNote: '20 pull-ups' },
          { name: 'Push Up', category: 'Chest', reps: 30, setCount: 5, loadNote: '30 push-ups' }
        ]
      }
    ];

    const { buffer, summary } = await injectWorkouts(baseBuf, staged);
    assert.ok(buffer);
    assert.equal(summary.preCompletedSets, 1);
    assert.equal(summary.addedSetsCount, 10);
    assert.equal(summary.addedWorkoutsCount, 1);
    assert.equal(summary.integrity, 'ok');

    // Re-inspect exported database
    const verifyDb = new SQL.Database(buffer);
    const completed = verifyDb.exec('SELECT COUNT(*) FROM training_log WHERE is_complete = 1')[0].values[0][0];
    const pending = verifyDb.exec('SELECT COUNT(*) FROM training_log WHERE is_complete = 0')[0].values[0][0];
    const newEx = verifyDb.exec('SELECT name FROM exercise WHERE name = "Push Up"')[0]?.values[0][0];

    assert.equal(completed, 1, 'historical completed sets must be 100% preserved');
    assert.equal(pending, 10, 'planned sets must be added with is_complete = 0');
    assert.equal(newEx, 'Push Up', 'missing exercise must be auto-created in exercise table');
    verifyDb.close();
  });

  test('injectCatalog bulk inserts new exercises non-destructively (#95)', async () => {
    const SQL = await getSql();
    const db = new SQL.Database();
    
    db.run('CREATE TABLE Category (_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
    db.run('INSERT INTO Category VALUES (9, "Abs"), (10, "Back"), (13, "Chest"), (14, "Legs")');
    db.run('CREATE TABLE exercise (_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category_id INTEGER NOT NULL, exercise_type_id INTEGER NOT NULL DEFAULT 0, weight_increment INTEGER, default_rest_time INTEGER)');
    db.run('CREATE TABLE training_log (_id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id INTEGER NOT NULL, date DATE NOT NULL, metric_weight INTEGER NOT NULL, reps INTEGER NOT NULL, unit INTEGER NOT NULL DEFAULT 0, is_complete INTEGER NOT NULL DEFAULT 0)');

    // 1 pre-existing exercise and completed set
    db.run('INSERT INTO exercise (name, category_id) VALUES ("Back Squat", 14)');
    db.run('INSERT INTO training_log (exercise_id, date, metric_weight, reps, is_complete) VALUES (1, "2026-11-20", 100, 5, 1)');

    const baseBuf = db.export();
    db.close();

    const catalog = [
      { name: 'Back Squat', sourceFile: '01_quads.csv', trackingType: 'weight_reps' }, // duplicate, should be skipped
      { name: 'Barbell Bench Press', sourceFile: '06_chest.csv', trackingType: 'weight_reps' }, // new
      { name: 'Deadlift', sourceFile: '07_back.csv', trackingType: 'weight_reps' } // new
    ];

    const { buffer, summary } = await injectCatalog(baseBuf, catalog);
    assert.equal(summary.addedExercisesCount, 2);
    assert.equal(summary.totalExercises, 3);
    assert.equal(summary.integrity, 'ok');

    const verifyDb = new SQL.Database(buffer);
    const count = verifyDb.exec('SELECT COUNT(*) FROM exercise')[0].values[0][0];
    const completed = verifyDb.exec('SELECT COUNT(*) FROM training_log WHERE is_complete = 1')[0].values[0][0];
    assert.equal(count, 3);
    assert.equal(completed, 1);
    verifyDb.close();
  });
});
