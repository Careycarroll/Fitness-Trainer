/**
 * Pure Analytics/Trends queries, inline SVG chart renderers, and Basic Meal
 * Tracker + Body Metric persistence helpers (#108).
 *
 * Kept DOM-free so all SQL queries, macro math, and SVG generation run in `node --test`.
 */

import { getSetting, setSetting } from '../storage/app-db.js';
import { LB_PER_KG } from '../storage/fitnotes.js';

function makeId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function escSvg(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function kgToDisplayNum(kg, unit = 'lb') {
  if (kg === null || kg === undefined) return 0;
  if (unit === 'kg') return Number(Number(kg).toFixed(1));
  return Math.round((Number(kg) / LB_PER_KG) * 10) / 10;
}

/**
 * List exercises that have at least one performance record, sorted by most recent.
 */
export function queryLoggedExercisesWithRecords(appDb) {
  const rows = appDb.exec(`
    SELECT e.id, e.name, e.scoring, COUNT(p.id) AS rec_count, MAX(p.date) AS last_date
    FROM performance_records p
    JOIN exercises e ON e.id = p.exercise_id
    GROUP BY e.id
    ORDER BY last_date DESC, rec_count DESC, e.name ASC
  `)[0]?.values ?? [];

  return rows.map(([id, name, scoring, count, lastDate]) => ({
    id,
    name,
    scoring: scoring || 'load',
    count: Number(count),
    lastDate
  }));
}

/**
 * Query performance trend points for a single exercise, optionally bounded by date range.
 */
export function queryExerciseTrend(appDb, exerciseId, { startDate = null, endDate = null } = {}) {
  const exRow = appDb.exec(
    'SELECT name, scoring, COALESCE(active_epoch, 1) FROM exercises WHERE id = ?',
    [exerciseId]
  )[0]?.values?.[0];

  const activeEpoch = Number(exRow?.[2] ?? 1);
  const scoring = exRow?.[1] || 'load';
  const name = exRow?.[0] || exerciseId;

  const clauses = ['exercise_id = ?'];
  const params = [exerciseId];
  if (startDate) { clauses.push('date >= ?'); params.push(startDate); }
  if (endDate) { clauses.push('date <= ?'); params.push(endDate); }

  const rows = appDb.exec(`
    SELECT date, epoch, record_type, value_primary, is_pr, is_epoch_pr
    FROM performance_records
    WHERE ${clauses.join(' AND ')}
    ORDER BY date ASC, created_at ASC
  `, params)[0]?.values ?? [];

  let allTimeBest = 0;
  let currentEpochBest = 0;

  const points = rows.map(([date, epoch, recordType, val, isPr, isEpochPr]) => {
    const numVal = Number(val);
    if (numVal > allTimeBest) allTimeBest = numVal;
    if (Number(epoch) === activeEpoch && numVal > currentEpochBest) currentEpochBest = numVal;
    return {
      date,
      epoch: Number(epoch),
      recordType,
      value: numVal,
      isPr: Boolean(isPr),
      isEpochPr: Boolean(isEpochPr)
    };
  });

  return {
    exerciseId,
    name,
    scoring,
    activeEpoch,
    allTimeBest,
    currentEpochBest,
    points
  };
}

/**
 * Query completed workouts & sets grouped by ISO week.
 */
export function queryWeeklyWorkouts(appDb, opts = 12) {
  const { startDate = null, endDate = null, limitWeeks = 52 } =
    typeof opts === 'number' ? { limitWeeks: opts } : (opts || {});

  const clauses = ["s.status = 'completed'"];
  const params = [];
  if (startDate) { clauses.push('s.date >= ?'); params.push(startDate); }
  if (endDate) { clauses.push('s.date <= ?'); params.push(endDate); }
  params.push(limitWeeks);

  const rows = appDb.exec(`
    SELECT
      strftime('%Y-W%W', s.date) AS week_key,
      MIN(s.date) AS week_start,
      COUNT(DISTINCT s.id) AS workout_count,
      COUNT(ls.id) AS set_count
    FROM workout_sessions s
    LEFT JOIN logged_sets ls ON ls.session_id = s.id AND ls.is_complete = 1
    WHERE ${clauses.join(' AND ')}
    GROUP BY week_key
    ORDER BY week_key DESC
    LIMIT ?
  `, params)[0]?.values ?? [];

  return rows
    .map(([weekKey, weekStart, workouts, sets]) => ({
      weekKey,
      weekStart,
      workouts: Number(workouts),
      sets: Number(sets)
    }))
    .reverse();
}

/**
 * Query bodyweight history from body_metrics.
 */
export function queryBodyweightTrend(appDb, { startDate = null, endDate = null } = {}) {
  const clauses = ['weight_kg IS NOT NULL'];
  const params = [];
  if (startDate) { clauses.push('date >= ?'); params.push(startDate); }
  if (endDate) { clauses.push('date <= ?'); params.push(endDate); }

  const rows = appDb.exec(`
    SELECT id, date, weight_kg, notes
    FROM body_metrics
    WHERE ${clauses.join(' AND ')}
    ORDER BY date ASC, created_at ASC
  `, params)[0]?.values ?? [];

  return rows.map(([id, date, weightKg, notes]) => ({
    id,
    date,
    weightKg: Number(weightKg),
    notes: notes || ''
  }));
}

const UPPER_MUSCLES = new Set([
  'chest', 'lats', 'mid_back', 'upper_back', 'traps',
  'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'forearms', 'neck'
]);
const LOWER_MUSCLES = new Set([
  'quads', 'hamstrings', 'glutes', 'adductors', 'abductors', 'calves', 'hip_flexors'
]);
const CORE_MUSCLES = new Set(['abs', 'obliques', 'erectors']);

function formatTokenLabel(tok) {
  return String(tok || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Analyze training bias across Upper/Lower/Core regions, individual muscle
 * groups (direct = 1, secondary = 0.5), and movement patterns.
 *
 * @param {object} appDb
 * @param {object} [options]
 * @param {number|null} [options.days] optional trailing day window (e.g. 30, 90, or null for all-time)
 */
export function queryTrainingBias(appDb, { days = null, startDate = null, endDate = null } = {}) {
  let effectiveStart = startDate;
  if (!effectiveStart && days && Number(days) > 0) {
    const d = new Date();
    d.setDate(d.getDate() - Number(days));
    effectiveStart = d.toISOString().slice(0, 10);
  }

  const clauses = ['ls.is_complete = 1', "ls.set_type != 'warmup'"];
  const params = [];
  if (effectiveStart) { clauses.push('ws.date >= ?'); params.push(effectiveStart); }
  if (endDate) { clauses.push('ws.date <= ?'); params.push(endDate); }

  const rows = appDb.exec(`
    SELECT e.pattern, e.primary_muscles, e.secondary_muscles
    FROM logged_sets ls
    JOIN workout_sessions ws ON ws.id = ls.session_id
    JOIN exercises e ON e.id = ls.exercise_id
    WHERE ${clauses.join(' AND ')}
  `, params)[0]?.values ?? [];

  const regions = { Upper: 0, Lower: 0, Core: 0 };
  const muscles = new Map();
  const patterns = new Map();

  for (const [pattern, primJson, secJson] of rows) {
    let prim = [];
    let sec = [];
    try { prim = JSON.parse(primJson || '[]'); } catch { prim = []; }
    try { sec = JSON.parse(secJson || '[]'); } catch { sec = []; }

    if (pattern) {
      const pLabel = formatTokenLabel(pattern);
      patterns.set(pLabel, (patterns.get(pLabel) || 0) + 1);
    }

    // Classify set region by its primary muscles
    const setRegions = new Set();
    for (const m of prim) {
      const mLabel = formatTokenLabel(m);
      muscles.set(mLabel, (muscles.get(mLabel) || 0) + 1);
      if (UPPER_MUSCLES.has(m)) setRegions.add('Upper');
      else if (LOWER_MUSCLES.has(m)) setRegions.add('Lower');
      else if (CORE_MUSCLES.has(m)) setRegions.add('Core');
    }
    for (const m of sec) {
      const mLabel = formatTokenLabel(m);
      muscles.set(mLabel, (muscles.get(mLabel) || 0) + 0.5);
    }
    for (const r of setRegions) {
      regions[r] += 1;
    }
  }

  const toSortedList = (mapOrObj) => {
    const entries = mapOrObj instanceof Map ? [...mapOrObj.entries()] : Object.entries(mapOrObj);
    const total = entries.reduce((acc, [, v]) => acc + v, 0) || 1;
    return entries
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({
        label,
        value: Number(value.toFixed(1)),
        pct: Math.round((value / total) * 100)
      }));
  };

  return {
    totalSets: rows.length,
    regions: toSortedList(regions),
    muscles: toSortedList(muscles),
    patterns: toSortedList(patterns)
  };
}

/**
 * Render clean horizontal SVG distribution bars for training bias.
 */
export function renderSvgDistributionBars(items, { width = 560 } = {}) {
  if (!items?.length) {
    return '<p class="note" style="margin:8px 0;">No completed sets in this timeframe yet.</p>';
  }

  const rowH = 26;
  const height = items.length * rowH + 10;
  const maxVal = Math.max(1, ...items.map((x) => x.value));
  const labelW = 138;
  const valW = 86;
  const barMaxW = Math.max(80, width - labelW - valW - 12);

  const rowsHtml = items.map((item, idx) => {
    const y = 6 + idx * rowH;
    const bw = Math.max(4, (item.value / maxVal) * barMaxW);
    const info = `${item.label}: ${item.value} working sets (${item.pct}%)`;
    return `
      <g class="trend-point" data-chart-info="${escSvg(info)}" tabindex="0">
        <rect x="0" y="${y}" width="${width}" height="${rowH}" fill="transparent" />
        <text x="${labelW - 8}" y="${y + 15}" text-anchor="end" fill="var(--text, #eee)" font-size="12">${escSvg(item.label)}</text>
        <rect class="trend-bar" x="${labelW}" y="${y + 4}" width="${bw.toFixed(1)}" height="15" rx="4" fill="var(--accent, #e5484d)" />
        <text x="${labelW + bw + 6}" y="${y + 15}" text-anchor="start" fill="var(--text-muted, #9aa)" font-size="11">${escSvg(`${item.value} (${item.pct}%)`)}</text>
        <title>${escSvg(info)}</title>
      </g>
    `;
  }).join('');

  return `
    <div class="trend-chart-wrap">
      <div class="trend-readout" aria-live="polite">Tap or hover a row to inspect</div>
      <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Training distribution chart">
        ${rowsHtml}
      </svg>
    </div>
  `;
}

export function addBodyMetric(appDb, { date, weightKg, notes = '' }) {
  const id = makeId('bm');
  appDb.run(
    `INSERT INTO body_metrics (id, date, weight_kg, notes, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, date, Number(weightKg), notes || null, new Date().toISOString()]
  );
  return id;
}

/**
 * Render a clean, offline inline SVG line chart for numeric series `{ date, value, isPr? }`.
 */
export function renderSvgLineChart(points, { width = 560, height = 180, unitSuffix = '' } = {}) {
  if (!points?.length) {
    return '<p class="note" style="margin:8px 0;">Not enough data yet to plot a trend.</p>';
  }

  const padL = 46;
  const padR = 16;
  const padT = 18;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const vals = points.map((p) => p.value);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const span = maxVal - minVal || 1;

  const coords = points.map((p, i) => {
    const x = points.length === 1 ? padL + plotW / 2 : padL + (i / (points.length - 1)) * plotW;
    const y = padT + plotH - ((p.value - minVal) / span) * plotH;
    return { ...p, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  });

  const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const dots = coords.map((c) => {
    const info = `${c.date}: ${c.value}${unitSuffix}${c.isPr ? ' 🏆 PR' : ''}`;
    return `
      <g class="trend-point" data-chart-info="${escSvg(info)}" tabindex="0">
        <circle cx="${c.x}" cy="${c.y}" r="12" fill="transparent" />
        <circle class="trend-dot" cx="${c.x}" cy="${c.y}" r="${c.isPr ? 5 : 3.5}" fill="${c.isPr ? '#facc15' : 'var(--accent, #e5484d)'}" />
        <title>${escSvg(info)}</title>
      </g>
    `;
  }).join('');

  const firstDate = points[0].date;
  const lastDate = points[points.length - 1].date;
  const latest = points[points.length - 1];
  const defaultReadout = `Latest — ${latest.date}: ${latest.value}${unitSuffix}${latest.isPr ? ' 🏆 PR' : ''}`;

  return `
    <div class="trend-chart-wrap">
      <div class="trend-readout" aria-live="polite">${escSvg(defaultReadout)}</div>
      <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Progression trend chart">
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="var(--border, #333)" stroke-width="1" />
        <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="var(--border, #333)" stroke-width="1" />
        <text x="${padL - 6}" y="${padT + 4}" text-anchor="end" fill="var(--text-muted, #9aa)" font-size="11">${escSvg(maxVal + unitSuffix)}</text>
        <text x="${padL - 6}" y="${padT + plotH}" text-anchor="end" fill="var(--text-muted, #9aa)" font-size="11">${escSvg(minVal + unitSuffix)}</text>
        <text x="${padL}" y="${height - 6}" text-anchor="start" fill="var(--text-muted, #9aa)" font-size="11">${escSvg(firstDate)}</text>
        <text x="${padL + plotW}" y="${height - 6}" text-anchor="end" fill="var(--text-muted, #9aa)" font-size="11">${escSvg(lastDate)}</text>
        ${coords.length > 1 ? `<polyline fill="none" stroke="var(--accent, #e5484d)" stroke-width="2.5" points="${polyline}" />` : ''}
        ${dots}
      </svg>
    </div>
  `;
}

/**
 * Render a clean inline SVG bar chart for weekly workout consistency.
 */
export function renderSvgBarChart(bars, { width = 560, height = 160 } = {}) {
  if (!bars?.length) {
    return '<p class="note" style="margin:8px 0;">Complete a workout to start tracking weekly consistency.</p>';
  }

  const padL = 32;
  const padR = 12;
  const padT = 16;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const maxVal = Math.max(1, ...bars.map((b) => b.workouts));
  const slotW = plotW / bars.length;
  const barW = Math.max(8, Math.min(34, slotW * 0.65));

  const rects = bars.map((b, i) => {
    const h = Math.max(2, (b.workouts / maxVal) * plotH);
    const x = padL + i * slotW + (slotW - barW) / 2;
    const y = padT + plotH - h;
    const info = `Week of ${b.weekStart}: ${b.workouts} workout(s) · ${b.sets} sets`;
    return `
      <g class="trend-point" data-chart-info="${escSvg(info)}" tabindex="0">
        <rect x="${x.toFixed(1)}" y="${padT}" width="${barW.toFixed(1)}" height="${plotH}" fill="transparent" />
        <rect class="trend-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="var(--accent, #e5484d)" />
        <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" fill="var(--text-muted, #9aa)" font-size="10">${b.workouts}</text>
        <title>${escSvg(info)}</title>
      </g>
    `;
  }).join('');

  return `
    <div class="trend-chart-wrap">
      <div class="trend-readout" aria-live="polite">Tap or hover a bar to inspect</div>
      <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly workouts chart">
        <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="var(--border, #333)" stroke-width="1" />
        <text x="${padL}" y="${height - 6}" text-anchor="start" fill="var(--text-muted, #9aa)" font-size="11">${escSvg(bars[0].weekStart)}</text>
        <text x="${padL + plotW}" y="${height - 6}" text-anchor="end" fill="var(--text-muted, #9aa)" font-size="11">${escSvg(bars[bars.length - 1].weekStart)}</text>
        ${rects}
      </svg>
    </div>
  `;
}

// --- Basic Meal Tracker (#108) ---

const DEFAULT_NUTRITION_TARGETS = {
  calories: 2400,
  proteinG: 180,
  carbsG: 240,
  fatG: 75
};

export function getNutritionTargets(appDb) {
  return getSetting(appDb, 'nutrition_targets', DEFAULT_NUTRITION_TARGETS);
}

export function setNutritionTargets(appDb, targets) {
  setSetting(appDb, 'nutrition_targets', {
    calories: Math.max(0, Number(targets.calories || 0)),
    proteinG: Math.max(0, Number(targets.proteinG || 0)),
    carbsG: Math.max(0, Number(targets.carbsG || 0)),
    fatG: Math.max(0, Number(targets.fatG || 0))
  });
}

export function addMealLog(appDb, { date, mealSlot = 'snack', name, calories = 0, proteinG = 0, carbsG = 0, fatG = 0, notes = '', saveAsPreset = false }) {
  const id = makeId('meal');
  const now = new Date().toISOString();
  appDb.run(
    `INSERT INTO meal_logs (id, date, meal_slot, name, calories, protein_g, carbs_g, fat_g, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, date, mealSlot, name.trim(), Number(calories || 0), Number(proteinG || 0), Number(carbsG || 0), Number(fatG || 0), notes || null, now]
  );

  if (saveAsPreset) {
    appDb.run(
      `INSERT INTO meal_presets (id, name, meal_slot, calories, protein_g, carbs_g, fat_g, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [makeId('mp'), name.trim(), mealSlot, Number(calories || 0), Number(proteinG || 0), Number(carbsG || 0), Number(fatG || 0), notes || null, now]
    );
  }
  return id;
}

export function deleteMealLog(appDb, mealId) {
  appDb.run('DELETE FROM meal_logs WHERE id = ?', [mealId]);
}

export function queryMealsForDate(appDb, date) {
  const rows = appDb.exec(`
    SELECT id, meal_slot, name, calories, protein_g, carbs_g, fat_g, notes
    FROM meal_logs
    WHERE date = ?
    ORDER BY created_at ASC
  `, [date])[0]?.values ?? [];

  const totals = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  const meals = rows.map(([id, mealSlot, name, calories, proteinG, carbsG, fatG, notes]) => {
    const c = Number(calories || 0);
    const p = Number(proteinG || 0);
    const cb = Number(carbsG || 0);
    const f = Number(fatG || 0);
    totals.calories += c;
    totals.proteinG += p;
    totals.carbsG += cb;
    totals.fatG += f;
    return { id, mealSlot, name, calories: c, proteinG: p, carbsG: cb, fatG: f, notes: notes || '' };
  });

  return { meals, totals };
}

export function queryMealPresets(appDb) {
  const rows = appDb.exec(`
    SELECT id, name, meal_slot, calories, protein_g, carbs_g, fat_g
    FROM meal_presets
    ORDER BY name ASC
  `)[0]?.values ?? [];

  return rows.map(([id, name, mealSlot, calories, proteinG, carbsG, fatG]) => ({
    id,
    name,
    mealSlot,
    calories: Number(calories || 0),
    proteinG: Number(proteinG || 0),
    carbsG: Number(carbsG || 0),
    fatG: Number(fatG || 0)
  }));
}

export function logMealFromPreset(appDb, presetId, date, mealSlot = null) {
  const row = appDb.exec(
    'SELECT name, meal_slot, calories, protein_g, carbs_g, fat_g, notes FROM meal_presets WHERE id = ?',
    [presetId]
  )[0]?.values?.[0];
  if (!row) return null;
  return addMealLog(appDb, {
    date,
    mealSlot: mealSlot || row[1],
    name: row[0],
    calories: row[2],
    proteinG: row[3],
    carbsG: row[4],
    fatG: row[5],
    notes: row[6] || ''
  });
}

/**
 * Query every logged set for one exercise, newest first, grouped by date (#71).
 */
export function queryHistoryPerLift(appDb, exerciseId) {
  const rows = appDb.exec(`
    SELECT
      ws.id AS session_id,
      ws.date,
      ws.title,
      ls.weight_kg,
      ls.reps,
      ls.duration_sec,
      ls.rir,
      ls.set_type,
      ls.is_complete,
      ls.is_pr,
      ls.notes
    FROM logged_sets ls
    JOIN workout_sessions ws ON ws.id = ls.session_id
    WHERE ls.exercise_id = ?
    ORDER BY ws.date DESC, ls.order_index ASC
  `, [exerciseId])[0]?.values ?? [];

  const groups = [];
  const byDate = new Map();
  for (const [sessionId, date, title, weightKg, reps, durationSec, rir, setType, isComplete, isPr, notes] of rows) {
    const key = `${date}::${sessionId}`;
    let g = byDate.get(key);
    if (!g) {
      g = { sessionId, date, title, sets: [] };
      byDate.set(key, g);
      groups.push(g);
    }
    g.sets.push({
      weightKg: weightKg !== null ? Number(weightKg) : null,
      reps: reps !== null ? Number(reps) : null,
      durationSec: durationSec !== null ? Number(durationSec) : null,
      rir: rir !== null ? Number(rir) : null,
      setType: setType || 'working',
      isComplete: Boolean(isComplete),
      isPr: Boolean(isPr),
      notes: notes || ''
    });
  }
  return groups;
}

/**
 * Query recent RIR values and per-lift active-epoch series for deload evaluation (#70).
 */
export function queryDeloadInputs(appDb, { days = 14 } = {}) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(days));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const rirRows = appDb.exec(`
    SELECT ls.rir
    FROM logged_sets ls
    JOIN workout_sessions ws ON ws.id = ls.session_id
    WHERE ls.is_complete = 1
      AND ls.rir IS NOT NULL
      AND ws.date >= ?
  `, [cutoffStr])[0]?.values ?? [];
  const recentRirs = rirRows.map((r) => Number(r[0]));

  const perfRows = appDb.exec(`
    SELECT p.exercise_id, COALESCE(e.name, p.exercise_id), p.value_primary
    FROM performance_records p
    JOIN exercises e ON e.id = p.exercise_id
    WHERE p.epoch = e.active_epoch
      AND p.record_type = 'e1rm'
    ORDER BY p.date ASC, p.created_at ASC
  `)[0]?.values ?? [];

  const byLift = new Map();
  for (const [exId, exName, val] of perfRows) {
    if (!byLift.has(exId)) byLift.set(exId, { exerciseId: exId, exerciseName: exName, values: [] });
    byLift.get(exId).values.push(Number(val));
  }

  return {
    recentRirs,
    liftSeries: [...byLift.values()]
  };
}

/**
 * Query completed weighted sets from AppDB for read-only max/PB readout (#49).
 */
export function queryCompletedSetsForMaxes(appDb) {
  const rows = appDb.exec(`
    SELECT ls.exercise_id, ws.date, ls.weight_kg, ls.reps, ls.rir
    FROM logged_sets ls
    JOIN workout_sessions ws ON ws.id = ls.session_id
    WHERE ls.is_complete = 1
      AND ls.weight_kg IS NOT NULL
      AND ls.weight_kg > 0
      AND ls.reps IS NOT NULL
      AND ls.reps > 0
    ORDER BY ws.date DESC
  `)[0]?.values ?? [];

  return rows.map(([exerciseId, date, weightKg, reps, rir]) => ({
    exerciseId,
    date,
    weight: Number(weightKg),
    weightUnit: 'kg',
    reps: Number(reps),
    rir: rir !== null ? Number(rir) : null
  }));
}
