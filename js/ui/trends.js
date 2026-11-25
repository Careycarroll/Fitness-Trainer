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
 * Query performance trend points for a single exercise.
 */
export function queryExerciseTrend(appDb, exerciseId) {
  const exRow = appDb.exec(
    'SELECT name, scoring, COALESCE(active_epoch, 1) FROM exercises WHERE id = ?',
    [exerciseId]
  )[0]?.values?.[0];

  const activeEpoch = Number(exRow?.[2] ?? 1);
  const scoring = exRow?.[1] || 'load';
  const name = exRow?.[0] || exerciseId;

  const rows = appDb.exec(`
    SELECT date, epoch, record_type, value_primary, is_pr, is_epoch_pr
    FROM performance_records
    WHERE exercise_id = ?
    ORDER BY date ASC, created_at ASC
  `, [exerciseId])[0]?.values ?? [];

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
 * Query completed workouts & sets grouped by ISO week (last N weeks).
 */
export function queryWeeklyWorkouts(appDb, limitWeeks = 12) {
  const rows = appDb.exec(`
    SELECT
      strftime('%Y-W%W', s.date) AS week_key,
      MIN(s.date) AS week_start,
      COUNT(DISTINCT s.id) AS workout_count,
      COUNT(ls.id) AS set_count
    FROM workout_sessions s
    LEFT JOIN logged_sets ls ON ls.session_id = s.id AND ls.is_complete = 1
    WHERE s.status = 'completed'
    GROUP BY week_key
    ORDER BY week_key DESC
    LIMIT ?
  `, [limitWeeks])[0]?.values ?? [];

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
export function queryBodyweightTrend(appDb) {
  const rows = appDb.exec(`
    SELECT id, date, weight_kg, notes
    FROM body_metrics
    WHERE weight_kg IS NOT NULL
    ORDER BY date ASC, created_at ASC
  `)[0]?.values ?? [];

  return rows.map(([id, date, weightKg, notes]) => ({
    id,
    date,
    weightKg: Number(weightKg),
    notes: notes || ''
  }));
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
  const dots = coords.map((c) => `
    <circle cx="${c.x}" cy="${c.y}" r="${c.isPr ? 5 : 3.5}" fill="${c.isPr ? '#facc15' : 'var(--accent, #e5484d)'}">
      <title>${escSvg(`${c.date}: ${c.value}${unitSuffix}${c.isPr ? ' (PR)' : ''}`)}</title>
    </circle>
  `).join('');

  const firstDate = points[0].date;
  const lastDate = points[points.length - 1].date;

  return `
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
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="var(--accent, #e5484d)">
        <title>${escSvg(`Week of ${b.weekStart}: ${b.workouts} workouts (${b.sets} sets)`)}</title>
      </rect>
      <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" fill="var(--text-muted, #9aa)" font-size="10">${b.workouts}</text>
    `;
  }).join('');

  return `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly workouts chart">
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="var(--border, #333)" stroke-width="1" />
      <text x="${padL}" y="${height - 6}" text-anchor="start" fill="var(--text-muted, #9aa)" font-size="11">${escSvg(bars[0].weekStart)}</text>
      <text x="${padL + plotW}" y="${height - 6}" text-anchor="end" fill="var(--text-muted, #9aa)" font-size="11">${escSvg(bars[bars.length - 1].weekStart)}</text>
      ${rects}
    </svg>
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
