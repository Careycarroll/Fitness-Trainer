/**
 * Native SQLite application database (ADR-033, ADR-011).
 *
 * Designed as the permanent, standalone storage schema for Fitness Trainer
 * (Capacitor Phase 1 via sql.js + native backup, Kotlin Room Phase 2).
 *
 * All weights are stored in canonical kilograms (`weight_kg`) and distances
 * in canonical meters (`distance_m`). UI layers convert to user display units.
 */

import { getSql } from './sqlite-injector.js';
import { LB_PER_KG } from './fitnotes.js';

export const APP_SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercises (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  is_custom         INTEGER NOT NULL DEFAULT 0,
  tracking_type     TEXT NOT NULL DEFAULT 'weight_reps',
  scoring           TEXT NOT NULL DEFAULT 'load',
  pattern           TEXT,
  primary_muscles   TEXT NOT NULL DEFAULT '[]',
  secondary_muscles TEXT NOT NULL DEFAULT '[]',
  equipment         TEXT NOT NULL DEFAULT '[]',
  unilateral        INTEGER NOT NULL DEFAULT 0,
  default_rest_sec  INTEGER NOT NULL DEFAULT 90,
  user_rest_sec     INTEGER,
  warmup_required   INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  archived          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id                   TEXT PRIMARY KEY,
  date                 TEXT NOT NULL,
  started_at           TEXT,
  completed_at         TEXT,
  title                TEXT NOT NULL,
  source               TEXT NOT NULL DEFAULT 'custom',
  status               TEXT NOT NULL DEFAULT 'planned',
  plan_id              TEXT,
  plan_session_id      TEXT,
  template_id          TEXT,
  equipment_profile_id TEXT,
  location             TEXT,
  session_rpe          REAL,
  bodyweight_kg        REAL,
  notes                TEXT
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_date ON workout_sessions(date);

CREATE TABLE IF NOT EXISTS workout_blocks (
  id                      TEXT PRIMARY KEY,
  session_id              TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  order_index             INTEGER NOT NULL,
  block_type              TEXT NOT NULL DEFAULT 'straight',
  title                   TEXT,
  time_cap_sec            INTEGER,
  rounds_target           INTEGER,
  rounds_completed        INTEGER,
  extra_reps              INTEGER,
  duration_sec            INTEGER,
  rest_between_rounds_sec INTEGER,
  notes                   TEXT
);

CREATE INDEX IF NOT EXISTS idx_workout_blocks_session ON workout_blocks(session_id, order_index);

CREATE TABLE IF NOT EXISTS logged_sets (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  block_id       TEXT NOT NULL REFERENCES workout_blocks(id) ON DELETE CASCADE,
  exercise_id    TEXT NOT NULL REFERENCES exercises(id),
  order_index    INTEGER NOT NULL,
  round_number   INTEGER,
  set_type       TEXT NOT NULL DEFAULT 'working',
  parent_set_id  TEXT REFERENCES logged_sets(id) ON DELETE CASCADE,
  drop_index     INTEGER,
  weight_kg      REAL,
  reps           INTEGER,
  duration_sec   INTEGER,
  distance_m     REAL,
  calories       INTEGER,
  rir            REAL,
  rpe            REAL,
  side           TEXT NOT NULL DEFAULT 'both',
  rest_sec       INTEGER,
  is_complete    INTEGER NOT NULL DEFAULT 0,
  completed_at   TEXT,
  is_pr          INTEGER NOT NULL DEFAULT 0,
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_logged_sets_session ON logged_sets(session_id, order_index);
CREATE INDEX IF NOT EXISTS idx_logged_sets_exercise ON logged_sets(exercise_id);
CREATE INDEX IF NOT EXISTS idx_logged_sets_parent ON logged_sets(parent_set_id);

CREATE TABLE IF NOT EXISTS performance_records (
  id                TEXT PRIMARY KEY,
  record_type       TEXT NOT NULL,
  exercise_id       TEXT REFERENCES exercises(id),
  benchmark_key     TEXT,
  date              TEXT NOT NULL,
  value_primary     REAL NOT NULL,
  value_secondary   REAL,
  confidence        TEXT NOT NULL DEFAULT 'direct',
  source_session_id TEXT REFERENCES workout_sessions(id) ON DELETE SET NULL,
  source_set_id     TEXT REFERENCES logged_sets(id) ON DELETE SET NULL,
  is_pr             INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_perf_exercise ON performance_records(exercise_id, record_type);
CREATE INDEX IF NOT EXISTS idx_perf_benchmark ON performance_records(benchmark_key, record_type);

CREATE TABLE IF NOT EXISTS plans (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  style_id      TEXT NOT NULL,
  split_id      TEXT NOT NULL,
  request_json  TEXT NOT NULL,
  program_json  TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_templates (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'custom',
  source        TEXT NOT NULL DEFAULT 'user',
  template_json TEXT NOT NULL,
  last_used_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment_profiles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  tokens_json TEXT NOT NULL DEFAULT '[]',
  is_custom   INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS body_metrics (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  weight_kg    REAL,
  body_fat_pct REAL,
  notes        TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_body_metrics_date ON body_metrics(date);

CREATE TABLE IF NOT EXISTS user_settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;

function makeId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Ensure schema tables and current migration version exist.
 *
 * @param {object} db sql.js Database instance
 */
export function ensureAppSchema(db) {
  db.run('PRAGMA foreign_keys = ON;');
  db.run(SCHEMA_SQL);

  const existing = db.exec('SELECT version FROM schema_migrations WHERE version = ?', [APP_SCHEMA_VERSION]);
  if (!existing[0]?.values?.length) {
    db.run(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      [APP_SCHEMA_VERSION, 'initial_standalone_schema', new Date().toISOString()]
    );
  }
}

/**
 * Create a new in-memory AppDB initialized with the standalone schema.
 *
 * @param {Array<object>} [catalogExercises] optional catalog seed array
 * @returns {Promise<object>} sql.js Database instance
 */
export async function createAppDb(catalogExercises = []) {
  const SQL = await getSql();
  const db = new SQL.Database();
  ensureAppSchema(db);
  if (catalogExercises.length > 0) {
    seedExercises(db, catalogExercises);
  }
  return db;
}

/**
 * Open an existing AppDB binary buffer and ensure schema/migrations are current.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {Array<object>} [catalogExercises] optional catalog refresh on open
 * @returns {Promise<object>} sql.js Database instance
 */
export async function openAppDb(buffer, catalogExercises = []) {
  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(buffer));
  ensureAppSchema(db);
  if (catalogExercises.length > 0) {
    seedExercises(db, catalogExercises);
  }
  return db;
}

/**
 * Export the AppDB to a Uint8Array suitable for native/file/IndexedDB persistence.
 *
 * @param {object} db
 * @returns {Uint8Array}
 */
export function exportAppDb(db) {
  return db.export();
}

/**
 * Idempotently upsert shipped catalog exercises into SQLite while preserving
 * user-customized `user_rest_sec`, `notes`, and `archived` flags.
 *
 * @param {object} db
 * @param {Array<object>} catalogExercises
 * @returns {number} count of exercises processed
 */
export function seedExercises(db, catalogExercises) {
  if (!Array.isArray(catalogExercises) || catalogExercises.length === 0) return 0;

  const stmt = db.prepare(`
    INSERT INTO exercises (
      id, name, is_custom, tracking_type, scoring, pattern,
      primary_muscles, secondary_muscles, equipment,
      unilateral, default_rest_sec, warmup_required
    ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      tracking_type = excluded.tracking_type,
      scoring = excluded.scoring,
      pattern = excluded.pattern,
      primary_muscles = excluded.primary_muscles,
      secondary_muscles = excluded.secondary_muscles,
      equipment = excluded.equipment,
      unilateral = excluded.unilateral,
      default_rest_sec = excluded.default_rest_sec,
      warmup_required = excluded.warmup_required
  `);

  db.run('BEGIN TRANSACTION;');
  try {
    for (const ex of catalogExercises) {
      stmt.run([
        ex.id,
        ex.name,
        ex.trackingType || 'weight_reps',
        ex.scoring || 'load',
        ex.pattern || null,
        JSON.stringify(ex.primaryMuscles || []),
        JSON.stringify(ex.secondaryMuscles || []),
        JSON.stringify(ex.equipment || []),
        ex.unilateral ? 1 : 0,
        Number(ex.restSeconds ?? 90),
        ex.warmupRequired ? 1 : 0
      ]);
    }
    db.run('COMMIT;');
  } catch (err) {
    db.run('ROLLBACK;');
    throw err;
  } finally {
    stmt.free();
  }

  return catalogExercises.length;
}

/**
 * Estimate 1RM using Epley formula (consistent with ADR-023).
 *
 * @param {number} weightKg
 * @param {number} reps
 * @returns {number|null}
 */
export function estimateE1rmKg(weightKg, reps) {
  if (!weightKg || weightKg <= 0 || !reps || reps <= 0) return null;
  if (reps === 1) return Number(weightKg.toFixed(4));
  return Number((weightKg * (1 + reps / 30)).toFixed(4));
}

function slugifyCustomId(name) {
  const base = String(name || 'exercise')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `custom:${base || 'unnamed'}`;
}

/**
 * One-time migration tool: imports historical workouts from a FitNotes `.fitnotes`
 * SQLite database into our standalone AppDB without retaining FitNotes quirks.
 *
 * Idempotent per imported date: dates already present with `source = 'imported'`
 * are skipped unless `overwriteImported` is true.
 *
 * @param {object} appDb
 * @param {ArrayBuffer|Uint8Array} fitnotesBuffer
 * @param {object} [options]
 * @param {Map<number, object>} [options.manifest] parsed fitnotes-mapping.csv map
 * @param {boolean} [options.includeIncomplete] default false (only completed sets)
 * @param {boolean} [options.overwriteImported] default false
 * @returns {Promise<{importedSessions: number, importedSets: number, createdCustomExercises: number, skippedDates: number, recordsCreated: number}>}
 */
export async function migrateFitNotesToAppDb(appDb, fitnotesBuffer, options = {}) {
  const SQL = await getSql();
  const fnDb = new SQL.Database(new Uint8Array(fitnotesBuffer));

  try {
    const { manifest = null, includeIncomplete = false, overwriteImported = false } = options;

    // Build lookup of known exercises in AppDB by id and normalized name
    const exById = new Set();
    const exByName = new Map();
    const existingExRows = appDb.exec('SELECT id, name FROM exercises')[0]?.values ?? [];
    for (const [id, name] of existingExRows) {
      exById.add(id);
      exByName.set(String(name).trim().toLowerCase(), id);
    }

    // Load source exercises from FitNotes DB
    const fnExercises = new Map();
    const fnExRows = fnDb.exec('SELECT _id, name, exercise_type_id FROM exercise')[0]?.values ?? [];
    for (const [id, name, typeId] of fnExRows) {
      fnExercises.set(Number(id), { name: String(name).trim(), typeId: Number(typeId ?? 0) });
    }

    // Load WorkoutComments by date
    const dayComments = new Map();
    try {
      const wcRows = fnDb.exec('SELECT date, comment FROM WorkoutComment')[0]?.values ?? [];
      for (const [date, comment] of wcRows) {
        if (comment) dayComments.set(date, String(comment));
      }
    } catch {
      // Optional table
    }

    // Load per-set comments
    const setComments = new Map();
    try {
      const cRows = fnDb.exec('SELECT owner_id, comment FROM Comment WHERE owner_type_id = 1')[0]?.values ?? [];
      for (const [ownerId, comment] of cRows) {
        if (comment) setComments.set(Number(ownerId), String(comment));
      }
    } catch {
      // Optional table
    }

    // Check optional columns on training_log
    const logCols = (fnDb.exec('PRAGMA table_info(training_log)')[0]?.values ?? []).map((c) => c[1]);
    const hasDuration = logCols.includes('duration_seconds');
    const hasDistance = logCols.includes('distance');

    const durSelect = hasDuration ? 'duration_seconds' : '0';
    const distSelect = hasDistance ? 'distance' : '0';
    const whereClause = includeIncomplete ? '' : 'WHERE is_complete = 1';

    const logRows = fnDb.exec(`
      SELECT _id, exercise_id, date, metric_weight, reps, is_complete, ${durSelect}, ${distSelect}
      FROM training_log
      ${whereClause}
      ORDER BY date ASC, _id ASC
    `)[0]?.values ?? [];

    // Group rows by date
    const byDate = new Map();
    for (const row of logRows) {
      const date = String(row[2]);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push({
        fnId: Number(row[0]),
        fnExId: Number(row[1]),
        date,
        weightKg: Number(row[3] ?? 0),
        reps: Number(row[4] ?? 0),
        isComplete: Boolean(row[5]),
        durationSec: Number(row[6] ?? 0),
        distanceM: Number(row[7] ?? 0),
        note: setComments.get(Number(row[0])) || null
      });
    }

    let importedSessions = 0;
    let importedSets = 0;
    let createdCustomExercises = 0;
    let skippedDates = 0;
    let recordsCreated = 0;

    // Track best e1RM / duration per exercise for initial PR ledger
    const bestE1rm = new Map();
    const bestDuration = new Map();

    const resolveAppExerciseId = (fnExId) => {
      // 1. Check manifest if provided
      if (manifest instanceof Map && manifest.has(fnExId)) {
        const entry = manifest.get(fnExId);
        if (entry?.trainerId && exById.has(entry.trainerId)) {
          return entry.trainerId;
        }
      }

      const fnEx = fnExercises.get(fnExId);
      const rawName = fnEx?.name || `Imported Exercise ${fnExId}`;
      const cleanName = rawName.replace(/\s*\(Time\)$/i, '').trim();

      // 2. Name match against existing catalog
      const exactMatch = exByName.get(rawName.toLowerCase()) || exByName.get(cleanName.toLowerCase());
      if (exactMatch) return exactMatch;

      // 3. Create custom exercise entry
      let customId = slugifyCustomId(cleanName);
      if (exById.has(customId)) {
        customId = `${customId}-${fnExId}`;
      }
      const isTime = fnEx?.typeId === 3 || /\(Time\)$/i.test(rawName);
      appDb.run(
        `INSERT INTO exercises (id, name, is_custom, tracking_type, scoring) VALUES (?, ?, 1, ?, ?)`,
        [customId, cleanName, isTime ? 'time' : 'weight_reps', isTime ? 'time' : 'load']
      );
      exById.add(customId);
      exByName.set(cleanName.toLowerCase(), customId);
      createdCustomExercises += 1;
      return customId;
    };

    appDb.run('BEGIN TRANSACTION;');
    try {
      for (const [date, sets] of byDate) {
        const existingImported = appDb.exec(
          "SELECT id FROM workout_sessions WHERE date = ? AND source = 'imported'",
          [date]
        )[0]?.values ?? [];

        if (existingImported.length > 0) {
          if (!overwriteImported) {
            skippedDates += 1;
            continue;
          }
          for (const [oldId] of existingImported) {
            appDb.run('DELETE FROM workout_sessions WHERE id = ?', [oldId]);
          }
        }

        const sessionId = makeId('sess');
        const comment = dayComments.get(date) || null;
        const title = comment ? comment.replace(/^\[|\]$/g, '').slice(0, 60) : `Imported Workout (${date})`;
        const noteText = comment ? `Imported workout history — ${comment}` : 'Imported workout history';

        appDb.run(
          `INSERT INTO workout_sessions (id, date, title, source, status, notes, completed_at)
           VALUES (?, ?, ?, 'imported', 'completed', ?, ?)`,
          [sessionId, date, title, noteText, `${date}T12:00:00Z`]
        );
        importedSessions += 1;

        // Group consecutive sets of the same exercise into straight blocks
        let currentExId = null;
        let currentBlockId = null;
        let blockIdx = 0;
        let setIdx = 0;

        for (const s of sets) {
          const exId = resolveAppExerciseId(s.fnExId);
          if (exId !== currentExId) {
            currentExId = exId;
            currentBlockId = makeId('blk');
            appDb.run(
              `INSERT INTO workout_blocks (id, session_id, order_index, block_type) VALUES (?, ?, ?, 'straight')`,
              [currentBlockId, sessionId, blockIdx++]
            );
          }

          const setId = makeId('set');
          const weightVal = s.weightKg > 0 ? Number((s.weightKg / LB_PER_KG * LB_PER_KG).toFixed(4)) : 0;

          appDb.run(
            `INSERT INTO logged_sets (
              id, session_id, block_id, exercise_id, order_index, set_type,
              weight_kg, reps, duration_sec, distance_m, is_complete, completed_at, notes
            ) VALUES (?, ?, ?, ?, ?, 'working', ?, ?, ?, ?, ?, ?, ?)`,
            [
              setId,
              sessionId,
              currentBlockId,
              exId,
              setIdx++,
              weightVal > 0 ? weightVal : null,
              s.reps > 0 ? s.reps : null,
              s.durationSec > 0 ? s.durationSec : null,
              s.distanceM > 0 ? s.distanceM : null,
              s.isComplete ? 1 : 0,
              s.isComplete ? `${date}T12:00:00Z` : null,
              s.note
            ]
          );
          importedSets += 1;

          if (s.isComplete) {
            const e1rm = estimateE1rmKg(weightVal, s.reps);
            if (e1rm !== null) {
              const prev = bestE1rm.get(exId) ?? 0;
              if (e1rm > prev) {
                bestE1rm.set(exId, e1rm);
                appDb.run(
                  `INSERT INTO performance_records (
                    id, record_type, exercise_id, date, value_primary, value_secondary,
                    confidence, source_session_id, source_set_id, is_pr, created_at
                  ) VALUES (?, 'e1rm', ?, ?, ?, ?, 'direct', ?, ?, 1, ?)`,
                  [makeId('pr'), exId, date, e1rm, s.reps, sessionId, setId, `${date}T12:00:00Z`]
                );
                appDb.run('UPDATE logged_sets SET is_pr = 1 WHERE id = ?', [setId]);
                recordsCreated += 1;
              }
            } else if (s.durationSec > 0) {
              const prevDur = bestDuration.get(exId) ?? 0;
              if (s.durationSec > prevDur) {
                bestDuration.set(exId, s.durationSec);
                appDb.run(
                  `INSERT INTO performance_records (
                    id, record_type, exercise_id, date, value_primary,
                    confidence, source_session_id, source_set_id, is_pr, created_at
                  ) VALUES (?, 'max_duration', ?, ?, ?, 'direct', ?, ?, 1, ?)`,
                  [makeId('pr'), exId, date, s.durationSec, sessionId, setId, `${date}T12:00:00Z`]
                );
                appDb.run('UPDATE logged_sets SET is_pr = 1 WHERE id = ?', [setId]);
                recordsCreated += 1;
              }
            }
          }
        }
      }
      appDb.run('COMMIT;');
    } catch (err) {
      appDb.run('ROLLBACK;');
      throw err;
    }

    return {
      importedSessions,
      importedSets,
      createdCustomExercises,
      skippedDates,
      recordsCreated
    };
  } finally {
    fnDb.close();
  }
}
