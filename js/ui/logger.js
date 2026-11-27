/**
 * Pure, Node-testable In-App Workout Logger & AppDB persistence helpers (#106).
 *
 * Handles:
 * - Instantiating sessions from Planner/WOD programs, Templates, or Freestyle
 * - Adding exercises, sets, and grouped drop sets (`parent_set_id` + `drop_index`)
 * - Superset / antagonist-superset / circuit round-robin auto-advance
 * - Completing workouts and recording per-session + all-time PRs (`performance_records`)
 */

import { estimateE1rmKg } from '../storage/app-db.js';
import { LB_PER_KG } from '../storage/fitnotes.js';

function makeId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function kgToDisplay(kg, unit = 'lb') {
  if (kg === null || kg === undefined || kg === 0) return '';
  if (unit === 'kg') return Number(Number(kg).toFixed(2));
  return Math.round((Number(kg) / LB_PER_KG) * 4) / 4;
}

export function displayToKg(val, unit = 'lb') {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === 'kg') return Number(n.toFixed(4));
  return Number((n * LB_PER_KG).toFixed(4));
}

/**
 * Create a new empty freestyle workout session in AppDB.
 */
export function createFreestyleSession(appDb, date, title = '') {
  const id = makeId('sess');
  const finalTitle = title.trim() || `Freestyle Workout (${date})`;
  appDb.run(
    `INSERT INTO workout_sessions (id, date, started_at, title, source, status)
     VALUES (?, ?, NULL, ?, 'custom', 'planned')`,
    [id, date, finalTitle]
  );
  return id;
}

/**
 * Instantiate an engine Session (from Planner or WOD/Benchmark) into AppDB
 * so the athlete can log sets live.
 */
export function createSessionFromEngineSession(appDb, engineSession, date, { title, source = 'plan' } = {}) {
  const sessionId = makeId('sess');
  const finalTitle = title || engineSession.label || engineSession.dayLabel || `Workout (${date})`;

  appDb.run(
    `INSERT INTO workout_sessions (id, date, started_at, title, source, status, notes)
     VALUES (?, ?, NULL, ?, ?, 'planned', ?)`,
    [sessionId, date, finalTitle, source, engineSession.notes || null]
  );

  const blocks = engineSession.blocks || [];
  let blockIdx = 0;

  for (const blk of blocks) {
    const blockId = makeId('blk');
    const blockType = blk.blockType || 'straight';
    appDb.run(
      `INSERT INTO workout_blocks (
        id, session_id, order_index, block_type, title, time_cap_sec, rounds_target
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        blockId,
        sessionId,
        blockIdx++,
        blockType,
        blk.label || null,
        blk.timeCapSeconds ?? null,
        blk.rounds ?? null
      ]
    );

    const setGroups = blk.setGroups || [];
    let setOrder = 0;
    const rounds = Math.max(1, Number(blk.rounds || 1));

    if (blockType === 'superset' || blockType === 'circuit') {
      // Interleave sets by round so round-robin order is preserved in DB
      const maxSets = Math.max(
        rounds,
        ...setGroups.map((g) => Number(g.sets || 1))
      );
      for (let r = 1; r <= maxSets; r++) {
        for (const g of setGroups) {
          if (r > Number(g.sets || maxSets)) continue;
          const restRow = appDb.exec(
            'SELECT COALESCE(user_rest_sec, default_rest_sec) FROM exercises WHERE id = ?',
            [g.exerciseId]
          )[0]?.values?.[0]?.[0];
          const restSec = g.restSeconds ?? restRow ?? 90;
          const weightKg = g.targetWeightKg ?? (g.weightLb ? displayToKg(g.weightLb, 'lb') : null);
          appDb.run(
            `INSERT INTO logged_sets (
              id, session_id, block_id, exercise_id, order_index, round_number,
              set_type, weight_kg, reps, duration_sec, rir, rest_sec, is_complete, notes
            ) VALUES (?, ?, ?, ?, ?, ?, 'working', ?, ?, ?, ?, ?, 0, ?)`,
            [
              makeId('set'),
              sessionId,
              blockId,
              g.exerciseId,
              setOrder++,
              r,
              weightKg,
              g.repTarget ?? g.reps ?? null,
              g.workSeconds ?? g.durationSeconds ?? null,
              g.rir ?? null,
              restSec,
              g.loadNote || null
            ]
          );
        }
      }
    } else {
      for (const g of setGroups) {
        const count = Math.max(1, Number(g.sets || 1));
        const restRow = appDb.exec(
          'SELECT COALESCE(user_rest_sec, default_rest_sec) FROM exercises WHERE id = ?',
          [g.exerciseId]
        )[0]?.values?.[0]?.[0];
        const restSec = g.restSeconds ?? restRow ?? 90;
        const weightKg = g.targetWeightKg ?? (g.weightLb ? displayToKg(g.weightLb, 'lb') : null);

        for (let i = 0; i < count; i++) {
          appDb.run(
            `INSERT INTO logged_sets (
              id, session_id, block_id, exercise_id, order_index, round_number,
              set_type, weight_kg, reps, duration_sec, rir, rest_sec, is_complete, notes
            ) VALUES (?, ?, ?, ?, ?, NULL, 'working', ?, ?, ?, ?, ?, 0, ?)`,
            [
              makeId('set'),
              sessionId,
              blockId,
              g.exerciseId,
              setOrder++,
              weightKg,
              g.repTarget ?? g.reps ?? null,
              g.workSeconds ?? g.durationSeconds ?? null,
              g.rir ?? null,
              restSec,
              i === 0 ? (g.loadNote || null) : null
            ]
          );
        }
      }
    }
  }

  return sessionId;
}

/**
 * Load a full active workout (session + ordered blocks + ordered sets + exercise metadata).
 */
export function loadActiveWorkout(appDb, sessionId) {
  const sRow = appDb.exec(
    `SELECT id, date, started_at, completed_at, title, source, status, location, session_rpe, notes
     FROM workout_sessions WHERE id = ?`,
    [sessionId]
  )[0]?.values?.[0];
  if (!sRow) return null;

  const session = {
    id: sRow[0],
    date: sRow[1],
    startedAt: sRow[2],
    completedAt: sRow[3],
    title: sRow[4],
    source: sRow[5],
    status: sRow[6],
    location: sRow[7] || '',
    sessionRpe: sRow[8],
    notes: sRow[9] || ''
  };

  const bRows = appDb.exec(
    `SELECT id, order_index, block_type, title, time_cap_sec, rounds_target, rounds_completed, extra_reps, duration_sec, notes
     FROM workout_blocks WHERE session_id = ? ORDER BY order_index ASC`,
    [sessionId]
  )[0]?.values ?? [];

  const setRows = appDb.exec(
    `SELECT
       ls.id, ls.block_id, ls.exercise_id, ls.order_index, ls.round_number,
       ls.set_type, ls.parent_set_id, ls.drop_index, ls.weight_kg, ls.reps,
       ls.duration_sec, ls.distance_m, ls.calories, ls.rir, ls.rpe, ls.side,
       ls.rest_sec, ls.is_complete, ls.is_pr, ls.notes,
       COALESCE(e.name, ls.exercise_id) AS ex_name,
       COALESCE(e.tracking_type, 'weight_reps') AS tracking_type,
       COALESCE(e.unilateral, 0) AS unilateral,
       COALESCE(e.user_rest_sec, e.default_rest_sec, 90) AS ex_rest_sec
     FROM logged_sets ls
     LEFT JOIN exercises e ON e.id = ls.exercise_id
     WHERE ls.session_id = ?
     ORDER BY ls.order_index ASC`,
    [sessionId]
  )[0]?.values ?? [];

  const setsByBlock = new Map();
  for (const r of setRows) {
    const blockId = r[1];
    if (!setsByBlock.has(blockId)) setsByBlock.set(blockId, []);
    setsByBlock.get(blockId).push({
      id: r[0],
      blockId,
      exerciseId: r[2],
      orderIndex: Number(r[3]),
      roundNumber: r[4] !== null ? Number(r[4]) : null,
      setType: r[5],
      parentSetId: r[6],
      dropIndex: r[7] !== null ? Number(r[7]) : null,
      weightKg: r[8] !== null ? Number(r[8]) : null,
      reps: r[9] !== null ? Number(r[9]) : null,
      durationSec: r[10] !== null ? Number(r[10]) : null,
      distanceM: r[11] !== null ? Number(r[11]) : null,
      calories: r[12] !== null ? Number(r[12]) : null,
      rir: r[13] !== null ? Number(r[13]) : null,
      rpe: r[14] !== null ? Number(r[14]) : null,
      side: r[15] || 'both',
      restSec: r[16] !== null ? Number(r[16]) : Number(r[23]),
      isComplete: Boolean(r[17]),
      isPr: Boolean(r[18]),
      notes: r[19] || '',
      exerciseName: r[20],
      trackingType: r[21],
      unilateral: Boolean(r[22]),
      defaultRestSec: Number(r[23])
    });
  }

  const blocks = bRows.map((b) => ({
    id: b[0],
    orderIndex: Number(b[1]),
    blockType: b[2],
    title: b[3] || '',
    timeCapSec: b[4] !== null ? Number(b[4]) : null,
    roundsTarget: b[5] !== null ? Number(b[5]) : null,
    roundsCompleted: b[6] !== null ? Number(b[6]) : null,
    extraReps: b[7] !== null ? Number(b[7]) : null,
    durationSec: b[8] !== null ? Number(b[8]) : null,
    notes: b[9] || '',
    sets: setsByBlock.get(b[0]) || []
  }));

  return { session, blocks };
}

/**
 * Add an exercise as a new straight block (or pair into an existing block as a superset).
 */
export function addExerciseToWorkout(appDb, sessionId, exerciseId, { blockId = null, setCount = 3 } = {}) {
  const exRow = appDb.exec(
    'SELECT tracking_type, COALESCE(user_rest_sec, default_rest_sec, 90) FROM exercises WHERE id = ?',
    [exerciseId]
  )[0]?.values?.[0];
  const trackingType = exRow?.[0] || 'weight_reps';
  const restSec = Number(exRow?.[1] ?? 90);

  let targetBlockId = blockId;
  if (!targetBlockId) {
    const maxBlockIdx = Number(
      appDb.exec('SELECT COALESCE(MAX(order_index), -1) FROM workout_blocks WHERE session_id = ?', [sessionId])[0]?.values?.[0]?.[0] ?? -1
    );
    targetBlockId = makeId('blk');
    appDb.run(
      `INSERT INTO workout_blocks (id, session_id, order_index, block_type) VALUES (?, ?, ?, 'straight')`,
      [targetBlockId, sessionId, maxBlockIdx + 1]
    );
  } else {
    // Pairing a second exercise into a straight block upgrades it to a superset
    appDb.run(
      `UPDATE workout_blocks SET block_type = 'superset' WHERE id = ? AND block_type = 'straight'`,
      [targetBlockId]
    );
  }

  const maxSetOrder = Number(
    appDb.exec('SELECT COALESCE(MAX(order_index), -1) FROM logged_sets WHERE session_id = ?', [sessionId])[0]?.values?.[0]?.[0] ?? -1
  );

  for (let i = 0; i < setCount; i++) {
    appDb.run(
      `INSERT INTO logged_sets (
        id, session_id, block_id, exercise_id, order_index, set_type,
        reps, duration_sec, rest_sec, is_complete
      ) VALUES (?, ?, ?, ?, ?, 'working', ?, ?, ?, 0)`,
      [
        makeId('set'),
        sessionId,
        targetBlockId,
        exerciseId,
        maxSetOrder + 1 + i,
        trackingType === 'time' ? null : 10,
        trackingType === 'time' ? 45 : null,
        restSec
      ]
    );
  }

  return targetBlockId;
}

/**
 * Append a new set to a block for the given exercise, copying the last set's weight/reps.
 */
export function addSetToBlock(appDb, sessionId, blockId, exerciseId, setType = 'working') {
  const prev = appDb.exec(
    `SELECT weight_kg, reps, duration_sec, rir, rest_sec, order_index
     FROM logged_sets WHERE block_id = ? AND exercise_id = ?
     ORDER BY order_index DESC LIMIT 1`,
    [blockId, exerciseId]
  )[0]?.values?.[0];

  const maxOrder = Number(
    appDb.exec('SELECT COALESCE(MAX(order_index), -1) FROM logged_sets WHERE session_id = ?', [sessionId])[0]?.values?.[0]?.[0] ?? -1
  );

  const setId = makeId('set');
  appDb.run(
    `INSERT INTO logged_sets (
      id, session_id, block_id, exercise_id, order_index, set_type,
      weight_kg, reps, duration_sec, rir, rest_sec, is_complete
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      setId,
      sessionId,
      blockId,
      exerciseId,
      maxOrder + 1,
      setType,
      prev?.[0] ?? null,
      prev?.[1] ?? null,
      prev?.[2] ?? null,
      prev?.[3] ?? null,
      prev?.[4] ?? 90
    ]
  );
  return setId;
}

/**
 * Add a drop-set stage linked directly to a parent working set.
 */
export function addDropSet(appDb, parentSetId) {
  const parent = appDb.exec(
    `SELECT session_id, block_id, exercise_id, order_index, weight_kg, reps, rest_sec
     FROM logged_sets WHERE id = ?`,
    [parentSetId]
  )[0]?.values?.[0];
  if (!parent) return null;

  const existingDrops = Number(
    appDb.exec('SELECT COALESCE(MAX(drop_index), 0) FROM logged_sets WHERE parent_set_id = ?', [parentSetId])[0]?.values?.[0]?.[0] ?? 0
  );
  const nextDropIdx = existingDrops + 1;

  // Shift subsequent sets in the session so the drop set stays grouped right below its parent
  const insertOrder = Number(parent[3]) + nextDropIdx;
  appDb.run(
    'UPDATE logged_sets SET order_index = order_index + 1 WHERE session_id = ? AND order_index >= ?',
    [parent[0], insertOrder]
  );

  const dropWeight = parent[4] ? Number((Number(parent[4]) * 0.8).toFixed(2)) : null;
  const dropId = makeId('set');
  appDb.run(
    `INSERT INTO logged_sets (
      id, session_id, block_id, exercise_id, order_index, set_type,
      parent_set_id, drop_index, weight_kg, reps, rest_sec, is_complete
    ) VALUES (?, ?, ?, ?, ?, 'drop', ?, ?, ?, ?, ?, 0)`,
    [dropId, parent[0], parent[1], parent[2], insertOrder, parentSetId, nextDropIdx, dropWeight, parent[5] ?? null, parent[6] ?? 60]
  );
  return dropId;
}

/**
 * Update mutable fields on a logged set.
 */
export function updateSetFields(appDb, setId, fields) {
  const allowed = {
    weightKg: 'weight_kg',
    reps: 'reps',
    durationSec: 'duration_sec',
    distanceM: 'distance_m',
    calories: 'calories',
    rir: 'rir',
    rpe: 'rpe',
    setType: 'set_type',
    restSec: 'rest_sec',
    notes: 'notes'
  };

  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(allowed)) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) {
      sets.push(`${col} = ?`);
      vals.push(fields[k]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'isComplete')) {
    const done = fields.isComplete ? 1 : 0;
    sets.push('is_complete = ?');
    vals.push(done);
    sets.push('completed_at = ?');
    vals.push(done ? new Date().toISOString() : null);
  }
  if (!sets.length) return;
  vals.push(setId);
  appDb.run(`UPDATE logged_sets SET ${sets.join(', ')} WHERE id = ?`, vals);
}

/**
 * Delete a set (and its child drop sets via FK cascade).
 */
export function deleteSet(appDb, setId) {
  appDb.run('DELETE FROM logged_sets WHERE id = ?', [setId]);
}

/**
 * Update workout session metadata (title, notes, location, status).
 */
export function updateSessionMeta(appDb, sessionId, fields) {
  const allowed = { title: 'title', notes: 'notes', location: 'location', status: 'status' };
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(allowed)) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) {
      sets.push(`${col} = ?`);
      vals.push(fields[k]);
    }
  }
  if (!sets.length) return;
  vals.push(sessionId);
  appDb.run(`UPDATE workout_sessions SET ${sets.join(', ')} WHERE id = ?`, vals);
}

/**
 * Update a workout block's custom title (e.g. custom Superset / Giant Set name).
 * Passing an empty string clears the custom title back to NULL.
 */
export function updateBlockTitle(appDb, blockId, title) {
  const trimmed = (title || '').trim();
  appDb.run('UPDATE workout_blocks SET title = ? WHERE id = ?', [trimmed || null, blockId]);
}

/**
 * Delete an entire workout session.
 */
export function deleteWorkoutSession(appDb, sessionId) {
  appDb.run('DELETE FROM workout_sessions WHERE id = ?', [sessionId]);
}

function reindexSessionBlocks(appDb, sessionId) {
  const rows = appDb.exec(
    'SELECT id FROM workout_blocks WHERE session_id = ? ORDER BY order_index ASC',
    [sessionId]
  )[0]?.values ?? [];
  rows.forEach(([id], idx) => {
    appDb.run('UPDATE workout_blocks SET order_index = ? WHERE id = ?', [idx, id]);
  });
}

function reindexSessionSets(appDb, sessionId) {
  const rows = appDb.exec(
    `SELECT ls.id FROM logged_sets ls
     JOIN workout_blocks wb ON wb.id = ls.block_id
     WHERE ls.session_id = ?
     ORDER BY wb.order_index ASC, ls.order_index ASC`,
    [sessionId]
  )[0]?.values ?? [];
  rows.forEach(([id], idx) => {
    appDb.run('UPDATE logged_sets SET order_index = ? WHERE id = ?', [idx, id]);
  });
}

/**
 * Move an entire workout block (straight exercise or superset/giant set) up (-1) or down (+1).
 */
export function moveWorkoutBlock(appDb, sessionId, blockId, direction) {
  const rows = appDb.exec(
    'SELECT id FROM workout_blocks WHERE session_id = ? ORDER BY order_index ASC',
    [sessionId]
  )[0]?.values ?? [];
  const ids = rows.map((r) => r[0]);
  const idx = ids.indexOf(blockId);
  const targetIdx = idx + direction;
  if (idx < 0 || targetIdx < 0 || targetIdx >= ids.length) return false;
  [ids[idx], ids[targetIdx]] = [ids[targetIdx], ids[idx]];
  ids.forEach((id, i) => appDb.run('UPDATE workout_blocks SET order_index = ? WHERE id = ?', [i, id]));
  reindexSessionSets(appDb, sessionId);
  return true;
}

/**
 * Move an exercise up (-1) or down (+1) within a superset/giant-set block.
 */
export function moveExerciseInBlock(appDb, sessionId, blockId, exerciseId, direction) {
  const rows = appDb.exec(
    'SELECT id, exercise_id FROM logged_sets WHERE block_id = ? ORDER BY order_index ASC',
    [blockId]
  )[0]?.values ?? [];
  const order = [];
  const groups = new Map();
  for (const [sid, exId] of rows) {
    if (!groups.has(exId)) {
      groups.set(exId, []);
      order.push(exId);
    }
    groups.get(exId).push(sid);
  }
  const idx = order.indexOf(exerciseId);
  const targetIdx = idx + direction;
  if (idx < 0 || targetIdx < 0 || targetIdx >= order.length) return false;
  [order[idx], order[targetIdx]] = [order[targetIdx], order[idx]];
  let pos = 0;
  for (const exId of order) {
    for (const sid of groups.get(exId)) {
      appDb.run('UPDATE logged_sets SET order_index = ? WHERE id = ?', [pos++, sid]);
    }
  }
  reindexSessionSets(appDb, sessionId);
  return true;
}

/**
 * Merge `sourceBlockId` into `targetBlockId` as a superset / giant set.
 */
export function linkBlocksIntoSuperset(appDb, sessionId, sourceBlockId, targetBlockId) {
  if (!sourceBlockId || !targetBlockId || sourceBlockId === targetBlockId) return false;
  const maxOrder = Number(
    appDb.exec('SELECT COALESCE(MAX(order_index), -1) FROM logged_sets WHERE block_id = ?', [targetBlockId])[0]?.values?.[0]?.[0] ?? -1
  );
  const srcSets = appDb.exec(
    'SELECT id FROM logged_sets WHERE block_id = ? ORDER BY order_index ASC',
    [sourceBlockId]
  )[0]?.values ?? [];
  srcSets.forEach(([sid], i) => {
    appDb.run('UPDATE logged_sets SET block_id = ?, order_index = ? WHERE id = ?', [targetBlockId, maxOrder + 1 + i, sid]);
  });
  appDb.run(`UPDATE workout_blocks SET block_type = 'superset' WHERE id = ? AND block_type = 'straight'`, [targetBlockId]);
  appDb.run('DELETE FROM workout_blocks WHERE id = ?', [sourceBlockId]);
  reindexSessionBlocks(appDb, sessionId);
  reindexSessionSets(appDb, sessionId);
  return true;
}

/**
 * Pull one exercise out of a superset/giant-set block into its own straight block.
 */
export function unlinkExerciseFromSuperset(appDb, sessionId, blockId, exerciseId) {
  const blkRow = appDb.exec('SELECT order_index FROM workout_blocks WHERE id = ?', [blockId])[0]?.values?.[0];
  if (!blkRow) return false;
  const baseIdx = Number(blkRow[0]);
  const allBlocks = appDb.exec(
    'SELECT id, order_index FROM workout_blocks WHERE session_id = ? ORDER BY order_index ASC',
    [sessionId]
  )[0]?.values ?? [];
  for (const [id, ord] of allBlocks) {
    if (Number(ord) > baseIdx) {
      appDb.run('UPDATE workout_blocks SET order_index = ? WHERE id = ?', [Number(ord) + 1, id]);
    }
  }
  const newBlockId = makeId('blk');
  appDb.run(
    `INSERT INTO workout_blocks (id, session_id, order_index, block_type) VALUES (?, ?, ?, 'straight')`,
    [newBlockId, sessionId, baseIdx + 1]
  );
  appDb.run('UPDATE logged_sets SET block_id = ? WHERE block_id = ? AND exercise_id = ?', [newBlockId, blockId, exerciseId]);

  const remEx = appDb.exec('SELECT COUNT(DISTINCT exercise_id) FROM logged_sets WHERE block_id = ?', [blockId])[0]?.values?.[0]?.[0] ?? 0;
  if (Number(remEx) <= 1) {
    appDb.run(`UPDATE workout_blocks SET block_type = 'straight' WHERE id = ? AND block_type = 'superset'`, [blockId]);
  }
  reindexSessionBlocks(appDb, sessionId);
  reindexSessionSets(appDb, sessionId);
  return true;
}

/**
 * Given a superset/antagonist-superset/circuit block and the setId just completed,
 * return the next incomplete setId in alternating exercise order (auto-advance).
 *
 * @param {object} block `{ blockType, sets }`
 * @param {string} completedSetId
 * @returns {string|null}
 */
export function nextSupersetFocusSetId(block, completedSetId) {
  if (!block || (block.blockType !== 'superset' && block.blockType !== 'circuit')) return null;
  const sets = block.sets || [];
  const idx = sets.findIndex((s) => s.id === completedSetId);
  if (idx === -1) return null;

  const currentExId = sets[idx].exerciseId;

  // Prefer the next incomplete set of a DIFFERENT exercise after idx
  for (let i = idx + 1; i < sets.length; i++) {
    if (!sets[i].isComplete && sets[i].exerciseId !== currentExId) {
      return sets[i].id;
    }
  }
  // Wrap around from the top of the block for another exercise's incomplete set
  for (let i = 0; i < idx; i++) {
    if (!sets[i].isComplete && sets[i].exerciseId !== currentExId) {
      return sets[i].id;
    }
  }
  // Fallback: any remaining incomplete set in the block
  const anyNext = sets.find((s, i) => i !== idx && !s.isComplete);
  return anyNext ? anyNext.id : null;
}

export function startWorkoutSession(appDb, sessionId) {
  const now = new Date().toISOString();
  appDb.run(
    `UPDATE workout_sessions
     SET started_at = COALESCE(started_at, ?),
         status = CASE WHEN status = 'planned' THEN 'in_progress' ELSE status END
     WHERE id = ?`,
    [now, sessionId]
  );
  return now;
}

/**
 * Complete a workout session, persist per-session performance records,
 * and flag any new all-time or active-epoch PRs.
 */
export function finishWorkoutSession(appDb, sessionId) {
  const now = new Date().toISOString();
  const sessRow = appDb.exec('SELECT date FROM workout_sessions WHERE id = ?', [sessionId])[0]?.values?.[0];
  if (!sessRow) return { completedSets: 0, newPrs: [] };
  const date = sessRow[0];

  appDb.run(
    `UPDATE workout_sessions SET status = 'completed', completed_at = ? WHERE id = ?`,
    [now, sessionId]
  );

  const completedRows = appDb.exec(
    `SELECT ls.id, ls.exercise_id, ls.weight_kg, ls.reps, ls.duration_sec,
            COALESCE(e.name, ls.exercise_id), COALESCE(e.active_epoch, 1)
     FROM logged_sets ls
     LEFT JOIN exercises e ON e.id = ls.exercise_id
     WHERE ls.session_id = ? AND ls.is_complete = 1`,
    [sessionId]
  )[0]?.values ?? [];

  const bestByEx = new Map();
  for (const [setId, exId, wKg, reps, durSec, exName, activeEpoch] of completedRows) {
    const e1rm = estimateE1rmKg(wKg ? Number(wKg) : 0, reps ? Number(reps) : 0);
    if (e1rm !== null) {
      const cur = bestByEx.get(exId);
      if (!cur || e1rm > cur.value) {
        bestByEx.set(exId, { type: 'e1rm', value: e1rm, secondary: Number(reps), setId, exName, epoch: Number(activeEpoch) });
      }
    } else if (durSec && Number(durSec) > 0) {
      const dur = Number(durSec);
      const cur = bestByEx.get(exId);
      if (!cur || dur > cur.value) {
        bestByEx.set(exId, { type: 'max_duration', value: dur, secondary: null, setId, exName, epoch: Number(activeEpoch) });
      }
    }
  }

  const newPrs = [];
  for (const [exId, best] of bestByEx) {
    const prevAll = Number(
      appDb.exec(
        'SELECT COALESCE(MAX(value_primary), 0) FROM performance_records WHERE exercise_id = ? AND record_type = ?',
        [exId, best.type]
      )[0]?.values?.[0]?.[0] ?? 0
    );
    const prevEpoch = Number(
      appDb.exec(
        'SELECT COALESCE(MAX(value_primary), 0) FROM performance_records WHERE exercise_id = ? AND record_type = ? AND epoch = ?',
        [exId, best.type, best.epoch]
      )[0]?.values?.[0]?.[0] ?? 0
    );

    const isPr = best.value > prevAll ? 1 : 0;
    const isEpochPr = best.value > prevEpoch ? 1 : 0;

    if (isPr || isEpochPr) {
      appDb.run('UPDATE logged_sets SET is_pr = 1 WHERE id = ?', [best.setId]);
      newPrs.push({ exerciseId: exId, exerciseName: best.exName, recordType: best.type, value: best.value, isAllTime: Boolean(isPr) });
    }

    // Replace any existing record for this session+exercise to keep finish idempotent
    appDb.run(
      'DELETE FROM performance_records WHERE source_session_id = ? AND exercise_id = ? AND record_type = ?',
      [sessionId, exId, best.type]
    );
    appDb.run(
      `INSERT INTO performance_records (
        id, record_type, exercise_id, date, epoch, value_primary, value_secondary,
        confidence, source_session_id, source_set_id, is_pr, is_epoch_pr, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'direct', ?, ?, ?, ?, ?)`,
      [makeId('pr'), best.type, exId, date, best.epoch, best.value, best.secondary, sessionId, best.setId, isPr, isEpochPr, now]
    );
  }

  return { completedSets: completedRows.length, newPrs };
}

/**
 * Save a workout session's structure as a reusable static workout template.
 */
export function saveSessionAsTemplate(appDb, sessionId, name, category = 'custom') {
  const active = loadActiveWorkout(appDb, sessionId);
  if (!active) return null;
  const now = new Date().toISOString();
  const id = makeId('tmpl');
  const payload = {
    blocks: active.blocks.map((b) => ({
      blockType: b.blockType,
      title: b.title,
      exercises: b.sets
        .filter((s) => !s.parentSetId)
        .map((s) => ({
          exerciseId: s.exerciseId,
          setType: s.setType,
          weightKg: s.weightKg,
          reps: s.reps,
          durationSec: s.durationSec,
          restSec: s.restSec
        }))
    }))
  };

  appDb.run(
    `INSERT INTO workout_templates (id, name, category, source, template_json, last_used_at, created_at, updated_at)
     VALUES (?, ?, ?, 'user', ?, ?, ?, ?)`,
    [id, name.trim() || active.session.title, category, JSON.stringify(payload), now, now, now]
  );
  return id;
}

/**
 * Instantiate a saved workout template into a live in_progress workout session.
 */
export function createSessionFromTemplate(appDb, templateId, date) {
  const row = appDb.exec(
    'SELECT name, template_json FROM workout_templates WHERE id = ?',
    [templateId]
  )[0]?.values?.[0];
  if (!row) return null;

  const [name, jsonStr] = row;
  const tpl = JSON.parse(jsonStr);
  const sessionId = makeId('sess');
  const now = new Date().toISOString();

  appDb.run(
    `INSERT INTO workout_sessions (id, date, started_at, title, source, status, template_id)
     VALUES (?, ?, NULL, ?, 'template', 'planned', ?)`,
    [sessionId, date, name, templateId]
  );
  appDb.run('UPDATE workout_templates SET last_used_at = ? WHERE id = ?', [now, templateId]);

  let bIdx = 0;
  let sOrder = 0;
  for (const b of tpl.blocks || []) {
    const blockId = makeId('blk');
    appDb.run(
      `INSERT INTO workout_blocks (id, session_id, order_index, block_type, title) VALUES (?, ?, ?, ?, ?)`,
      [blockId, sessionId, bIdx++, b.blockType || 'straight', b.title || null]
    );
    for (const s of b.exercises || []) {
      appDb.run(
        `INSERT INTO logged_sets (
          id, session_id, block_id, exercise_id, order_index, set_type,
          weight_kg, reps, duration_sec, rest_sec, is_complete
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [makeId('set'), sessionId, blockId, s.exerciseId, sOrder++, s.setType || 'working', s.weightKg ?? null, s.reps ?? null, s.durationSec ?? null, s.restSec ?? 90]
      );
    }
  }
  return sessionId;
}

/**
 * Fetch the most recent prior session's sets for an exercise (excluding current session).
 */
export function getLastExercisePerformance(appDb, exerciseId, excludeSessionId) {
  const sessRow = appDb.exec(
    `SELECT ws.id, ws.date
     FROM logged_sets ls
     JOIN workout_sessions ws ON ws.id = ls.session_id
     WHERE ls.exercise_id = ? AND ls.session_id != ?
     ORDER BY ls.is_complete DESC, ws.date DESC, ws.started_at DESC, ws.id DESC
     LIMIT 1`,
    [exerciseId, excludeSessionId || '']
  )[0]?.values?.[0];
  if (!sessRow) return null;
  const [prevSessId, prevDate] = sessRow;
  const rows = appDb.exec(
    `SELECT weight_kg, reps, duration_sec, rir, set_type, is_complete
     FROM logged_sets
     WHERE session_id = ? AND exercise_id = ?
     ORDER BY order_index ASC`,
    [prevSessId, exerciseId]
  )[0]?.values ?? [];
  const completed = rows.filter((r) => Number(r[5]) === 1);
  const chosen = completed.length ? completed : rows;
  return {
    date: prevDate,
    sets: chosen.map((r) => ({
      weightKg: r[0],
      reps: r[1],
      durationSec: r[2],
      rir: r[3],
      setType: r[4] || 'working'
    }))
  };
}

/**
 * Best historical weight & estimated 1RM (Epley) for an exercise outside the current session.
 */
export function getExerciseBestMetrics(appDb, exerciseId, excludeSessionId) {
  const rows = appDb.exec(
    `SELECT weight_kg, reps
     FROM logged_sets
     WHERE exercise_id = ? AND session_id != ? AND is_complete = 1 AND weight_kg > 0`,
    [exerciseId, excludeSessionId || '']
  )[0]?.values ?? [];
  let bestWeightKg = 0;
  let bestEst1RmKg = 0;
  for (const [wKg, reps] of rows) {
    const w = Number(wKg || 0);
    const r = Number(reps || 0);
    if (w > bestWeightKg) bestWeightKg = w;
    if (w > 0 && r > 0) {
      const est = r === 1 ? w : w * (1 + r / 30);
      if (est > bestEst1RmKg) bestEst1RmKg = est;
    }
  }
  return { bestWeightKg, bestEst1RmKg };
}

/**
 * Insert warm-up sets before the first existing set of an exercise in a block.
 */
export function insertWarmupSets(appDb, sessionId, blockId, exerciseId, specs) {
  if (!specs?.length) return [];
  const existing = appDb.exec(
    `SELECT id, block_id, exercise_id, order_index
     FROM logged_sets WHERE session_id = ?
     ORDER BY order_index ASC`,
    [sessionId]
  )[0]?.values ?? [];

  const firstIdx = existing.findIndex((r) => r[1] === blockId && r[2] === exerciseId);
  const insertAt = firstIdx >= 0 ? Number(existing[firstIdx][3]) : existing.length;

  for (let i = existing.length - 1; i >= 0; i--) {
    const [sid, , , ord] = existing[i];
    if (Number(ord) >= insertAt) {
      appDb.run('UPDATE logged_sets SET order_index = ? WHERE id = ?', [Number(ord) + specs.length, sid]);
    }
  }

  const createdIds = [];
  specs.forEach((sp, i) => {
    const id = makeId('set');
    createdIds.push(id);
    appDb.run(
      `INSERT INTO logged_sets (
        id, session_id, block_id, exercise_id, order_index, set_type,
        weight_kg, reps, rest_sec, is_complete
      ) VALUES (?, ?, ?, ?, ?, 'warmup', ?, ?, ?, 0)`,
      [id, sessionId, blockId, exerciseId, insertAt + i, sp.weightKg ?? null, sp.reps ?? null, sp.restSec ?? 60]
    );
  });
  return createdIds;
}

/**
 * Seed 4 completed progressive workouts + 1 planned workout for today (idempotent via demo-* IDs).
 * Useful for testing Trends graphs, Last-session Copy, Warm-ups, Steppers, and Est. 1RM PRs.
 */
export function seedSampleWorkouts(appDb, todayStr) {
  appDb.run("DELETE FROM workout_sessions WHERE id LIKE 'demo-%'");
  const baseDate = new Date(`${todayStr}T12:00:00Z`);
  const daysAgo = (n) => {
    const d = new Date(baseDate.getTime() - n * 86400000);
    return d.toISOString().slice(0, 10);
  };
  const LB = 0.45359237;
  const insertSession = (id, date, title, status, blocks) => {
    const started = status === 'completed' ? `${date}T17:00:00.000Z` : null;
    const completed = status === 'completed' ? `${date}T17:52:00.000Z` : null;
    appDb.run(
      `INSERT INTO workout_sessions (id, date, started_at, completed_at, title, source, status)
       VALUES (?, ?, ?, ?, ?, 'custom', ?)`,
      [id, date, started, completed, title, status]
    );
    let sOrder = 0;
    blocks.forEach((b, bIdx) => {
      const blkId = `${id}-blk-${bIdx}`;
      appDb.run(
        `INSERT INTO workout_blocks (id, session_id, order_index, block_type, title)
         VALUES (?, ?, ?, ?, ?)`,
        [blkId, id, bIdx, b.blockType || 'straight', b.title || null]
      );
      for (const s of b.sets) {
        const isDone = status === 'completed' ? 1 : 0;
        appDb.run(
          `INSERT INTO logged_sets (
            id, session_id, block_id, exercise_id, order_index, set_type,
            weight_kg, reps, duration_sec, rir, rest_sec, is_complete, is_pr
          ) VALUES (?, ?, ?, ?, ?, 'working', ?, ?, ?, ?, ?, ?, ?)`,
          [
            `${id}-set-${sOrder}`,
            id,
            blkId,
            s.exerciseId,
            sOrder,
            s.lb != null ? Math.round(s.lb * LB * 1000) / 1000 : null,
            s.reps ?? null,
            s.durationSec ?? null,
            s.rir ?? 2,
            s.restSec ?? 90,
            isDone,
            s.isPr ? 1 : 0
          ]
        );
        sOrder += 1;
      }
    });
  };

  insertSession('demo-lower-1', daysAgo(14), 'Lower A (Week 1)', 'completed', [
    { sets: [
      { exerciseId: 'back-squat', lb: 185, reps: 8, isPr: true },
      { exerciseId: 'back-squat', lb: 185, reps: 8 },
      { exerciseId: 'back-squat', lb: 185, reps: 8 }
    ] },
    { sets: [
      { exerciseId: 'conventional-deadlift', lb: 225, reps: 5, restSec: 120, isPr: true },
      { exerciseId: 'conventional-deadlift', lb: 225, reps: 5, restSec: 120 }
    ] },
    { sets: [
      { exerciseId: 'plank', durationSec: 45, restSec: 60 },
      { exerciseId: 'plank', durationSec: 45, restSec: 60 }
    ] }
  ]);

  insertSession('demo-upper-1', daysAgo(11), 'Upper A (Week 1)', 'completed', [
    { sets: [
      { exerciseId: 'barbell-bench-press', lb: 155, reps: 8, isPr: true },
      { exerciseId: 'barbell-bench-press', lb: 155, reps: 8 },
      { exerciseId: 'barbell-bench-press', lb: 155, reps: 7 }
    ] },
    { blockType: 'superset', title: 'Push/Pull A', sets: [
      { exerciseId: 'overhead-press', lb: 95, reps: 8, isPr: true },
      { exerciseId: 'barbell-row', lb: 135, reps: 8, isPr: true },
      { exerciseId: 'overhead-press', lb: 95, reps: 8 },
      { exerciseId: 'barbell-row', lb: 135, reps: 8 }
    ] },
    { sets: [
      { exerciseId: 'pull-up', reps: 8 },
      { exerciseId: 'pull-up', reps: 7 }
    ] }
  ]);

  insertSession('demo-lower-2', daysAgo(7), 'Lower A (Week 2)', 'completed', [
    { sets: [
      { exerciseId: 'back-squat', lb: 195, reps: 8, isPr: true },
      { exerciseId: 'back-squat', lb: 195, reps: 8 },
      { exerciseId: 'back-squat', lb: 195, reps: 8 }
    ] },
    { sets: [
      { exerciseId: 'conventional-deadlift', lb: 245, reps: 5, restSec: 120, isPr: true },
      { exerciseId: 'conventional-deadlift', lb: 245, reps: 5, restSec: 120 }
    ] },
    { sets: [
      { exerciseId: 'plank', durationSec: 60, restSec: 60 },
      { exerciseId: 'plank', durationSec: 60, restSec: 60 }
    ] }
  ]);

  insertSession('demo-upper-2', daysAgo(4), 'Upper A (Week 2)', 'completed', [
    { sets: [
      { exerciseId: 'barbell-bench-press', lb: 165, reps: 8, isPr: true },
      { exerciseId: 'barbell-bench-press', lb: 165, reps: 8 },
      { exerciseId: 'barbell-bench-press', lb: 165, reps: 8 }
    ] },
    { blockType: 'superset', title: 'Push/Pull A', sets: [
      { exerciseId: 'overhead-press', lb: 100, reps: 8, isPr: true },
      { exerciseId: 'barbell-row', lb: 145, reps: 8, isPr: true },
      { exerciseId: 'overhead-press', lb: 100, reps: 8 },
      { exerciseId: 'barbell-row', lb: 145, reps: 8 }
    ] },
    { sets: [
      { exerciseId: 'pull-up', reps: 9 },
      { exerciseId: 'pull-up', reps: 8 }
    ] }
  ]);

  insertSession('demo-today', todayStr, "Today's Upper (Demo)", 'planned', [
    { sets: [
      { exerciseId: 'barbell-bench-press', lb: null, reps: null },
      { exerciseId: 'barbell-bench-press', lb: null, reps: null },
      { exerciseId: 'barbell-bench-press', lb: null, reps: null }
    ] },
    { blockType: 'superset', title: 'Push/Pull A', sets: [
      { exerciseId: 'overhead-press', lb: null, reps: null },
      { exerciseId: 'barbell-row', lb: null, reps: null },
      { exerciseId: 'overhead-press', lb: null, reps: null },
      { exerciseId: 'barbell-row', lb: null, reps: null }
    ] },
    { sets: [
      { exerciseId: 'pull-up', reps: null },
      { exerciseId: 'pull-up', reps: null }
    ] }
  ]);
  return 5;
}
