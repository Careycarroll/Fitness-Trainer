/**
 * SQLite WASM Injector for FitNotes on Android (#92).
 *
 * Injects planned workouts non-destructively into an existing FitNotes SQLite database
 * (.fitnotes) client-side. Preserves 100% of historical sets, PRs, bodyweight logs, and routines.
 */
import initSqlJs from 'sql.js';

let sqlPromise = null;

export async function getSql() {
  if (!sqlPromise) {
    const config = {};
    if (typeof window !== 'undefined') {
      const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
      const cleanBase = base.endsWith('/') ? base : base + '/';
      config.locateFile = (file) => `${cleanBase}${file}`;
    }
    sqlPromise = initSqlJs(config);
  }
  return sqlPromise;
}

/**
 * Inspect an existing .fitnotes SQLite database buffer.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<object>} stats and inspection details
 */
export async function inspectDatabase(buffer) {
  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(buffer));

  try {
    const getVal = (sql, fallback = 0) => {
      try {
        const res = db.exec(sql);
        return res[0]?.values[0][0] ?? fallback;
      } catch {
        return fallback;
      }
    };

    const completedSets = getVal('SELECT COUNT(*) FROM training_log WHERE is_complete = 1', 0);
    const pendingSets = getVal('SELECT COUNT(*) FROM training_log WHERE is_complete = 0', 0);
    const totalSets = getVal('SELECT COUNT(*) FROM training_log', 0);
    const totalWorkouts = getVal('SELECT COUNT(DISTINCT date) FROM training_log', 0);
    const totalRoutines = getVal('SELECT COUNT(*) FROM Routine', 0);
    const totalExercises = getVal('SELECT COUNT(*) FROM exercise', 0);

    const dateRows = db.exec('SELECT DISTINCT date FROM training_log ORDER BY date DESC');
    const existingDates = new Set((dateRows[0]?.values ?? []).map((v) => v[0]));

    return {
      ok: true,
      completedSets,
      pendingSets,
      totalSets,
      totalWorkouts,
      totalRoutines,
      totalExercises,
      existingDates: [...existingDates]
    };
  } finally {
    db.close();
  }
}

/**
 * Inspect the exact exercises and sets logged in a .fitnotes SQLite database for a specific date.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {string} dateStr YYYY-MM-DD
 * @returns {Promise<object>}
 */
export async function inspectDate(buffer, dateStr) {
  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(buffer));
  try {
    const sets = db.exec(`
      SELECT e.name, t.metric_weight, t.reps, t.duration_seconds, t.is_complete, c.name
      FROM training_log t
      JOIN exercise e ON e._id = t.exercise_id
      LEFT JOIN Category c ON c._id = e.category_id
      WHERE t.date = ?
      ORDER BY t._id ASC
    `, [dateStr])[0]?.values ?? [];

    let workoutComment = '';
    try {
      workoutComment = db.exec('SELECT comment FROM WorkoutComment WHERE date = ?', [dateStr])[0]?.values[0]?.[0] ?? '';
    } catch {
      // Table might not exist
    }

    const exercises = sets.map(([name, weight, reps, duration, isComplete, category]) => ({
      name,
      weight: Number(weight || 0),
      reps: Number(reps || 0),
      duration: Number(duration || 0),
      isComplete: Boolean(isComplete),
      category: category || 'Uncategorized'
    }));

    return {
      date: dateStr,
      workoutComment,
      totalSets: sets.length,
      exercises
    };
  } finally {
    db.close();
  }
}

/**
 * Inject planned workouts into a .fitnotes SQLite database non-destructively.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {Array<object>} stagedWorkouts
 * @param {object} [options]
 * @returns {Promise<{ buffer: Uint8Array, summary: object }>}
 */
export async function injectWorkouts(buffer, stagedWorkouts, options = {}) {
  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(buffer));

  try {
    const preCompletedSets = Number(db.exec('SELECT COUNT(*) FROM training_log WHERE is_complete = 1')[0]?.values[0][0] ?? 0);
    const preTotalSets = Number(db.exec('SELECT COUNT(*) FROM training_log')[0]?.values[0][0] ?? 0);

    // Resolve categories directly from the database schema rather than hardcoded IDs (#97)
    let catRows = [];
    try {
      catRows = db.exec('SELECT _id, name FROM Category')[0]?.values ?? [];
    } catch {
      // Table may not exist in synthetic test databases
    }
    const catMap = {};
    for (const [id, name] of catRows) {
      catMap[String(name).toLowerCase().trim()] = id;
    }
    const defaultCatId = catMap['legs'] ?? (catRows[0]?.[0] ?? 1);

    const resolveCategory = (categoryName) => {
      const norm = String(categoryName || '').toLowerCase().trim();
      if (catMap[norm]) return catMap[norm];
      if (norm.includes('chest') || norm.includes('push_h')) return catMap['chest'] ?? defaultCatId;
      if (norm.includes('back') || norm.includes('pull_v') || norm.includes('pull_h') || norm.includes('lats')) return catMap['back'] ?? defaultCatId;
      if (norm.includes('biceps')) return catMap['biceps'] ?? defaultCatId;
      if (norm.includes('triceps')) return catMap['triceps'] ?? defaultCatId;
      if (norm.includes('shoulder') || norm.includes('push_v') || norm.includes('delts') || norm.includes('olympic')) return catMap['shoulders'] ?? defaultCatId;
      if (norm.includes('abs') || norm.includes('core')) return catMap['abs'] ?? defaultCatId;
      if (norm.includes('cardio') || norm.includes('conditioning')) return catMap['cardio'] ?? defaultCatId;
      if (norm.includes('leg') || norm.includes('squat') || norm.includes('hinge') || norm.includes('quad') || norm.includes('glute')) return catMap['legs'] ?? defaultCatId;
      return defaultCatId;
    };

    // Sanitize any corrupt orphan category_id references so FitNotes Android never crashes (#97)
    try {
      db.run('UPDATE exercise SET category_id = ? WHERE category_id NOT IN (SELECT _id FROM Category)', [defaultCatId]);
    } catch {
      // Ignore if table missing
    }

    // Load existing exercises
    const exRows = db.exec('SELECT _id, name, category_id FROM exercise');
    const existingExercises = new Map();
    if (exRows[0]?.values) {
      for (const [id, name, catId] of exRows[0].values) {
        existingExercises.set(name.trim().toLowerCase(), { id, name, catId });
      }
    }

    const getOrCreateExercise = (name, categoryName = 'Legs', exerciseTypeId = 0) => {
      const key = name.trim().toLowerCase();
      if (existingExercises.has(key)) {
        return existingExercises.get(key).id;
      }
      // If looking for a (Time) exercise, also check if a (Time) variant exists in the DB
      if (exerciseTypeId === 3 && !key.endsWith('(time)')) {
        const altKey = `${key} (time)`;
        if (existingExercises.has(altKey)) {
          return existingExercises.get(altKey).id;
        }
      }
      const catId = resolveCategory(categoryName);
      db.run(
        'INSERT INTO exercise (name, category_id, exercise_type_id, weight_increment, default_rest_time) VALUES (?, ?, ?, 5, 60)',
        [name.trim(), catId, exerciseTypeId]
      );
      const newId = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
      existingExercises.set(key, { id: newId, name: name.trim(), catId, typeId: exerciseTypeId });
      return newId;
    };

    // Check if training_log supports duration_seconds column (native FitNotes schema)
    let hasDurationCol = false;
    try {
      const logCols = db.exec('PRAGMA table_info(training_log)')[0]?.values ?? [];
      hasDurationCol = logCols.some((col) => col[1] === 'duration_seconds');
    } catch {
      hasDurationCol = false;
    }

    let addedSetsCount = 0;
    let addedWorkoutsCount = 0;
    let overwrittenDatesCount = 0;

    for (const workout of stagedWorkouts) {
      if (!workout.date || !workout.exercises?.length) continue;
      addedWorkoutsCount += 1;

      // Overwrite existing workout on date collision if requested (#100)
      if (workout.overwrite || options.overwriteExisting) {
        try {
          db.run('DELETE FROM training_log WHERE date = ?', [workout.date]);
          overwrittenDatesCount += 1;
        } catch {
          // Table might be absent in synthetic tests
        }
        try {
          db.run('DELETE FROM WorkoutComment WHERE date = ?', [workout.date]);
        } catch {
          // Optional table
        }
        try {
          db.run('DELETE FROM Comment WHERE date = ?', [workout.date]);
        } catch {
          // Optional table
        }
      }

      // Add workout comment if available and table exists
      if (workout.description || workout.title) {
        const comment = [workout.title ? `[${workout.title}]` : '', workout.description || ''].filter(Boolean).join(' ');
        try {
          db.run('INSERT INTO WorkoutComment (date, comment) VALUES (?, ?)', [workout.date, comment]);
        } catch {
          // Table might be absent or optional
        }
      }

      for (const item of workout.exercises) {
        const reps = Number(item.reps ?? 0);
        const durationSeconds = Number(item.durationSeconds ?? 0);
        const metricWeight = Number(item.metricWeight ?? 0);
        const unit = options.unit ?? 0; // 0 = standard/lbs depending on settings

        const exerciseTypeId = item.exerciseTypeId ?? (durationSeconds > 0 && reps === 0 ? 3 : 0);
        const exerciseId = getOrCreateExercise(item.name, item.category || 'Legs', exerciseTypeId);

        // Each exercise can specify multiple sets or a setCount
        const setsToInsert = item.sets || Array.from({ length: item.setCount || 1 }, () => ({ reps, durationSeconds, metricWeight }));

        for (const s of setsToInsert) {
          const sReps = s.reps ?? reps;
          const sDuration = s.durationSeconds ?? durationSeconds;
          const sWeight = s.metricWeight ?? metricWeight;

          if (hasDurationCol) {
            db.run(
              'INSERT INTO training_log (exercise_id, date, metric_weight, reps, unit, is_complete, duration_seconds) VALUES (?, ?, ?, ?, ?, 0, ?)',
              [exerciseId, workout.date, sWeight, sReps, unit, sDuration]
            );
          } else {
            db.run(
              'INSERT INTO training_log (exercise_id, date, metric_weight, reps, unit, is_complete) VALUES (?, ?, ?, ?, ?, 0)',
              [exerciseId, workout.date, sWeight, sReps, unit]
            );
          }
          const logId = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
          addedSetsCount += 1;

          // Attach note if present
          const noteText = item.note || item.loadNote;
          if (noteText) {
            try {
              db.run('INSERT INTO Comment (date, owner_type_id, owner_id, comment) VALUES (?, 1, ?, ?)',
                [workout.date, logId, noteText]);
            } catch {
              // Comment table fallback
            }
          }
        }
      }
    }

    // Verify non-destructive integrity
    // Verify non-destructive integrity (unless user explicitly overwrote an existing date)
    const postCompletedSets = Number(db.exec('SELECT COUNT(*) FROM training_log WHERE is_complete = 1')[0]?.values[0][0] ?? 0);
    const postTotalSets = Number(db.exec('SELECT COUNT(*) FROM training_log')[0]?.values[0][0] ?? 0);

    if (!overwrittenDatesCount && postCompletedSets !== preCompletedSets) {
      throw new Error(`Integrity invariant violated: completed sets changed from ${preCompletedSets} to ${postCompletedSets}`);
    }

    const integrity = db.exec('PRAGMA integrity_check')[0]?.values[0][0];
    if (integrity !== 'ok') {
      throw new Error(`Database integrity check failed: ${integrity}`);
    }

    const exported = db.export();

    return {
      buffer: exported,
      summary: {
        preCompletedSets,
        postTotalSets,
        addedSetsCount,
        addedWorkoutsCount,
        overwrittenDatesCount,
        integrity
      }
    };
  } finally {
    db.close();
  }
}

/**
 * Bulk inject full exercise catalog into an existing FitNotes SQLite database (#95).
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {Array<object>} catalogExercises
 * @returns {Promise<{buffer: Uint8Array, summary: object}>}
 */
export async function injectCatalog(buffer, catalogExercises) {
  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(buffer));

  try {
    const preCompletedSets = Number(db.exec('SELECT COUNT(*) FROM training_log WHERE is_complete = 1')[0]?.values[0][0] ?? 0);

    let catRows = [];
    try {
      catRows = db.exec('SELECT _id, name FROM Category')[0]?.values ?? [];
    } catch {
      // Table may not exist in synthetic test databases
    }
    const catMap = {};
    for (const [id, name] of catRows) {
      catMap[String(name).toLowerCase().trim()] = id;
    }
    const defaultCatId = catMap['legs'] ?? (catRows[0]?.[0] ?? 1);

    const getCatId = (ex) => {
      const sf = (ex.sourceFile || '').toLowerCase();
      if (sf.includes('chest')) return catMap['chest'] ?? defaultCatId;
      if (sf.includes('back')) return catMap['back'] ?? defaultCatId;
      if (sf.includes('biceps')) return catMap['biceps'] ?? defaultCatId;
      if (sf.includes('triceps')) return catMap['triceps'] ?? defaultCatId;
      if (sf.includes('shoulders')) return catMap['shoulders'] ?? defaultCatId;
      if (sf.includes('core')) return catMap['abs'] ?? defaultCatId;
      if (sf.includes('conditioning')) return catMap['cardio'] ?? defaultCatId;
      if (sf.includes('quads') || sf.includes('glutes') || sf.includes('hamstrings') || sf.includes('calves') || sf.includes('hips')) {
        return catMap['legs'] ?? defaultCatId;
      }
      if (sf.includes('fullbody')) {
        const pm = (ex.primaryMuscles?.[0] || '').toLowerCase();
        if (['delts', 'front_delts'].includes(pm)) return catMap['shoulders'] ?? defaultCatId;
        if (['lats', 'upper_back'].includes(pm)) return catMap['back'] ?? defaultCatId;
        return catMap['legs'] ?? defaultCatId;
      }
      return defaultCatId;
    };

    // Sanitize any corrupt orphan category_id references so FitNotes Android never crashes (#97)
    try {
      db.run('UPDATE exercise SET category_id = ? WHERE category_id NOT IN (SELECT _id FROM Category)', [defaultCatId]);
    } catch {
      // Ignore if table missing
    }

    const getExType = (ex) => {
      const tt = ex.trackingType || 'weight_reps';
      if (tt === 'reps_only') return 4;
      if (tt === 'time' || tt === 'time_load') return 3;
      if (tt === 'weight_distance') return 2;
      if (ex.monostructural || ex.sourceFile === '13_conditioning.csv') return 1;
      return 0;
    };

    const existingRows = db.exec('SELECT _id, name FROM exercise')[0]?.values ?? [];
    const existing = new Set(existingRows.map(r => String(r[1]).toLowerCase().trim()));

    let addedExercisesCount = 0;
    for (const ex of catalogExercises) {
      const name = String(ex.name || '').trim();
      const norm = name.toLowerCase();
      if (!name || existing.has(norm)) continue;

      const catId = getCatId(ex);
      const exType = getExType(ex);
      const rest = ex.restSeconds || 60;

      db.run(
        'INSERT INTO exercise (name, category_id, exercise_type_id, weight_increment, default_rest_time) VALUES (?, ?, ?, 5, ?)',
        [name, catId, exType, rest]
      );
      existing.add(norm);
      addedExercisesCount++;
    }

    const postCompletedSets = Number(db.exec('SELECT COUNT(*) FROM training_log WHERE is_complete = 1')[0]?.values[0][0] ?? 0);
    if (postCompletedSets !== preCompletedSets) {
      throw new Error(`Integrity invariant violated: completed sets changed`);
    }

    const integrity = db.exec('PRAGMA integrity_check')[0]?.values[0][0];
    if (integrity !== 'ok') {
      throw new Error(`Database integrity check failed: ${integrity}`);
    }

    const totalExercises = Number(db.exec('SELECT COUNT(*) FROM exercise')[0]?.values[0][0] ?? 0);

    return {
      buffer: db.export(),
      summary: {
        addedExercisesCount,
        totalExercises,
        integrity
      }
    };
  } finally {
    db.close();
  }
}
