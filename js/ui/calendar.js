/**
 * Pure calendar grid and AppDB session query helpers for the Calendar/List
 * home view (#105).
 *
 * Kept DOM-free so grid generation and SQLite queries run in `node --test`.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function formatMonthTitle(year, monthIndex) {
  return `${MONTH_NAMES[monthIndex] || ''} ${year}`;
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function toIsoDate(year, monthIndex, day) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

/**
 * Build a 7-column Sunday-Saturday calendar grid for a given year & 0-based month.
 *
 * @param {number} year
 * @param {number} monthIndex 0..11
 * @returns {Array<{ date: string, day: number, inMonth: boolean }>}
 */
export function buildMonthGrid(year, monthIndex) {
  const firstDay = new Date(year, monthIndex, 1);
  const startDow = firstDay.getDay(); // 0 = Sun .. 6 = Sat
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const prevMonthLastDay = new Date(year, monthIndex, 0).getDate();

  const cells = [];

  // Leading days from previous month
  for (let i = startDow - 1; i >= 0; i--) {
    const prevYear = monthIndex === 0 ? year - 1 : year;
    const prevMonth = monthIndex === 0 ? 11 : monthIndex - 1;
    const d = prevMonthLastDay - i;
    cells.push({ date: toIsoDate(prevYear, prevMonth, d), day: d, inMonth: false });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: toIsoDate(year, monthIndex, d), day: d, inMonth: true });
  }

  // Trailing days to complete the final week row
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    const nextYear = monthIndex === 11 ? year + 1 : year;
    const nextMonth = monthIndex === 11 ? 0 : monthIndex + 1;
    cells.push({ date: toIsoDate(nextYear, nextMonth, nextDay), day: nextDay, inMonth: false });
    nextDay += 1;
  }

  return cells;
}

/**
 * Query workout sessions for a given YYYY-MM month from AppDB, grouped by date.
 *
 * @param {object} appDb sql.js Database instance
 * @param {number} year
 * @param {number} monthIndex 0..11
 * @returns {Map<string, Array<object>>}
 */
export function querySessionsByMonth(appDb, year, monthIndex) {
  const prefix = `${year}-${pad2(monthIndex + 1)}-%`;
  const rows = appDb.exec(`
    SELECT
      s.id, s.date, s.title, s.source, s.status, s.notes,
      COUNT(ls.id) AS set_count,
      COUNT(DISTINCT ls.exercise_id) AS exercise_count
    FROM workout_sessions s
    LEFT JOIN logged_sets ls ON ls.session_id = s.id
    WHERE s.date LIKE ?
    GROUP BY s.id
    ORDER BY s.date ASC, s.started_at ASC, s.id ASC
  `, [prefix])[0]?.values ?? [];

  const byDate = new Map();
  for (const [id, date, title, source, status, notes, setCount, exerciseCount] of rows) {
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({
      id,
      date,
      title,
      source,
      status,
      notes: notes || '',
      setCount: Number(setCount || 0),
      exerciseCount: Number(exerciseCount || 0)
    });
  }
  return byDate;
}

/**
 * Query recent workout sessions in reverse chronological order for List view.
 *
 * @param {object} appDb
 * @param {number} [limit]
 * @returns {Array<object>}
 */
export function querySessionsList(appDb, limit = 100) {
  const rows = appDb.exec(`
    SELECT
      s.id, s.date, s.title, s.source, s.status, s.notes,
      COUNT(ls.id) AS set_count,
      COUNT(DISTINCT ls.exercise_id) AS exercise_count
    FROM workout_sessions s
    LEFT JOIN logged_sets ls ON ls.session_id = s.id
    GROUP BY s.id
    ORDER BY s.date DESC, s.started_at DESC, s.id DESC
    LIMIT ?
  `, [limit])[0]?.values ?? [];

  return rows.map(([id, date, title, source, status, notes, setCount, exerciseCount]) => ({
    id,
    date,
    title,
    source,
    status,
    notes: notes || '',
    setCount: Number(setCount || 0),
    exerciseCount: Number(exerciseCount || 0)
  }));
}

/**
 * Query full exercise/set breakdown for a single workout session.
 *
 * @param {object} appDb
 * @param {string} sessionId
 * @returns {Array<{ exerciseId: string, exerciseName: string, sets: Array<object> }>}
 */
export function querySessionExercises(appDb, sessionId) {
  const rows = appDb.exec(`
    SELECT
      ls.exercise_id,
      COALESCE(e.name, ls.exercise_id) AS exercise_name,
      ls.set_type,
      ls.weight_kg,
      ls.reps,
      ls.duration_sec,
      ls.is_complete,
      ls.is_pr,
      ls.notes
    FROM logged_sets ls
    LEFT JOIN exercises e ON e.id = ls.exercise_id
    WHERE ls.session_id = ?
    ORDER BY ls.order_index ASC
  `, [sessionId])[0]?.values ?? [];

  const groups = [];
  const byKey = new Map();
  for (const [exId, exName, setType, weightKg, reps, durationSec, isComplete, isPr, notes] of rows) {
    let g = byKey.get(exId);
    if (!g) {
      g = { exerciseId: exId, exerciseName: exName, sets: [] };
      byKey.set(exId, g);
      groups.push(g);
    }
    g.sets.push({
      setType,
      weightKg: weightKg !== null ? Number(weightKg) : null,
      reps: reps !== null ? Number(reps) : null,
      durationSec: durationSec !== null ? Number(durationSec) : null,
      isComplete: Boolean(isComplete),
      isPr: Boolean(isPr),
      notes: notes || ''
    });
  }
  return groups;
}

/**
 * Format canonical kg weight into display units ('lb' or 'kg').
 *
 * @param {number|null} kg
 * @param {'lb'|'kg'} unit
 * @returns {string}
 */
export function formatDisplayWeight(kg, unit = 'lb') {
  if (kg === null || kg === undefined || kg === 0) return 'BW';
  if (unit === 'kg') return `${Number(kg.toFixed(1))} kg`;
  const lbs = Math.round((kg / 0.453592) * 4) / 4;
  return `${lbs} lb`;
}
