/**
 * FitNotes 2 CSV export (#25).
 *
 * PURE: program + start date + state in, CSV text out. No DOM, no clock.
 *
 * COLUMN CONTRACT, verified against a real FitNotes export:
 *   Date,Exercise,Category,Weight (kg),Weight (lbs),Reps,Distance,
 *   Distance Unit,Time,Notes,Kind
 *
 * `Weight (lbs)` is populated and kg left blank: a probe import supplying both
 * stored the lbs value and ignored kg. Supplying kg alone stored 0.
 *
 * MARKER ROWS, not full sets. One row per exercise at the prescribed weight
 * with ZERO REPS. CSV import always lands is_complete = 1 -- measured, every
 * shape tried -- so exported sets would be indistinguishable from performed
 * work, and a skipped session would leave phantom history that feeds ADR-023.
 * A row with no reps cannot feed e1RM: there is nothing to estimate from.
 */

const CSV_COLUMNS = [
  'Date', 'Exercise', 'Category', 'Weight (kg)', 'Weight (lbs)', 'Reps',
  'Distance', 'Distance Unit', 'Time', 'Notes', 'Kind'
];

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export class ExportError extends Error {
  constructor(message) { super(message); this.name = 'ExportError'; }
}

/**
 * Add days to a YYYY-MM-DD string without constructing a Date.
 *
 * Date arithmetic crossing a DST boundary can land on the wrong calendar day,
 * and #25 rules that these are LOCAL calendar dates. So: civil-date maths.
 */
export function addDays(iso, n) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new ExportError(`start date must be YYYY-MM-DD, got ${JSON.stringify(iso)}`);
  }
  const [y, m, d] = iso.split('-').map(Number);
  // Days since epoch via a fixed-point algorithm, no Date involved.
  const g = (yy, mm, dd) => {
    const a = mm <= 2 ? yy - 1 : yy;
    const b = mm <= 2 ? mm + 12 : mm;
    return 365 * a + Math.floor(a / 4) - Math.floor(a / 100) + Math.floor(a / 400)
      + Math.floor((153 * (b - 3) + 2) / 5) + dd + 58;
  };
  let days = g(y, m, d) + n;
  // Invert: walk years then months. Bounded and exact.
  let yy = Math.floor(days / 365.2425) + 1;
  while (g(yy, 1, 1) > days) yy -= 1;
  while (g(yy + 1, 1, 1) <= days) yy += 1;
  let mm = 1;
  while (mm < 12 && g(yy, mm + 1, 1) <= days) mm += 1;
  const dd = days - g(yy, mm, 1) + 1;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Concrete date for session `index`, given a start date and a weekday schedule.
 *
 * The start date does NOT have to be a scheduled weekday. The schedule is the
 * pattern; the start date says when to begin. Session 0 lands on the first
 * scheduled weekday at or after the start.
 */
/**
 * Whole days from `a` to `b`, both YYYY-MM-DD. Negative when b precedes a.
 *
 * Civil-date maths, not Date: #25 rules these are LOCAL calendar dates, and
 * subtracting two Dates across a DST boundary is off by an hour and can round
 * to the wrong day. Needed by #54 to measure the real gap a MOVED session lands
 * on, which no weekday-based helper can answer.
 */
export function daysBetween(a, b) {
  const n = (iso) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      throw new ExportError(`date must be YYYY-MM-DD, got ${JSON.stringify(iso)}`);
    }
    const [y, m, d] = iso.split('-').map(Number);
    const yy = m <= 2 ? y - 1 : y;
    const mm = m <= 2 ? m + 12 : m;
    return 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400)
      + Math.floor((153 * (mm - 3) + 2) / 5) + d;
  };
  return n(b) - n(a);
}

export function sessionDates(startDate, schedule, count) {
  if (!Array.isArray(schedule) || !schedule.length) {
    throw new ExportError('schedule is required to compute dates (#25)');
  }
  const idx = schedule.map((d) => {
    const i = WEEKDAYS.indexOf(d);
    if (i === -1) throw new ExportError(`unknown weekday ${JSON.stringify(d)}`);
    return i;
  });

  // Weekday of the start date, Monday = 0.
  const [y, m, d] = startDate.split('-').map(Number);
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  const dow = (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400)
    + t[m - 1] + d) % 7;          // 0 = Sunday
  const startMon = (dow + 6) % 7; // 0 = Monday

  const out = [];
  let offset = 0;
  let pos = 0;
  // Walk to the first scheduled day at or after the start.
  while (!idx.includes((startMon + offset) % 7)) offset += 1;
  while (out.length < count) {
    const wd = (startMon + offset) % 7;
    if (idx.includes(wd)) { out.push(addDays(startDate, offset)); pos += 1; }
    offset += 1;
    if (offset > 400) throw new ExportError('date walk failed to terminate');
  }
  return out;
}
// ---------------------------------------------------------------- name lookup

/**
 * Trainer slug -> the FitNotes name a PRESCRIPTION is written to.
 *
 * Thirteen Trainer exercises receive several FitNotes definitions, so the target
 * is AUTHORED in the manifest (`export_preferred`) rather than guessed. Writing
 * to an untouched stock row would split one lift across two FitNotes entries and
 * starve ADR-023 of comparable sets.
 *
 * A slug with no mapping falls back to its own catalog NAME. That is safe
 * because CSV import AUTO-CREATES exercises -- measured: `Zercher Squat`, absent
 * from all 149 manifest rows, was created by importing a row naming it. So an
 * unmapped exercise lands as a new FitNotes row rather than failing.
 */
/**
 * FitNotes categories, keyed on our primary muscle (#36).
 *
 * The CSV import REQUIRES a non-empty Category: a probe with a blank one is
 * refused outright ("invalid row 0"), and the same rows with "Chest" import
 * cleanly. The shipped exporter wrote a blank on every row, so no plan has ever
 * reached the phone -- #25's column contract was verified by READING a real
 * export, never by feeding our own output back in.
 *
 * These are the eight categories FitNotes actually uses, taken from a real
 * export rather than invented. Two joins are rulings rather than lookups:
 * traps, upper_back and erectors file under Back, because that is where
 * FitNotes puts shrugs and back extensions; hip_flexors, adductors and
 * abductors file under Legs.
 */
const CATEGORY_BY_MUSCLE = Object.freeze({
  chest: 'Chest',
  lats: 'Back', mid_back: 'Back', upper_back: 'Back', traps: 'Back', erectors: 'Back',
  quads: 'Legs', hamstrings: 'Legs', glutes: 'Legs', calves: 'Legs',
  adductors: 'Legs', abductors: 'Legs', hip_flexors: 'Legs',
  front_delts: 'Shoulders', side_delts: 'Shoulders', rear_delts: 'Shoulders',
  biceps: 'Biceps', forearms: 'Biceps',
  triceps: 'Triceps',
  abs: 'Abs', obliques: 'Abs', neck: 'Abs'
});

/** Fallback when FitNotes has never seen the exercise. Never empty. */
const DEFAULT_CATEGORY = 'Cardio';

/**
 * Category per catalog slug: FitNotes' own where it knows the exercise, ours
 * derived from the primary muscle otherwise. Mirrors buildNameLookup exactly --
 * prefer what FitNotes calls it, fall back to what we know.
 */
export function buildCategoryLookup(manifest, catalog) {
  const byslug = new Map();
  for (const row of manifest.exercises ?? []) {
    if (row.exerciseId && row.exportPreferred && row.fitnotesCategory) {
      byslug.set(row.exerciseId, row.fitnotesCategory);
    }
  }
  for (const ex of catalog) {
    if (byslug.has(ex.id)) continue;
    const muscle = (ex.primaryMuscles ?? [])[0];
    byslug.set(ex.id, CATEGORY_BY_MUSCLE[muscle] ?? DEFAULT_CATEGORY);
  }
  return byslug;
}

export function buildNameLookup(manifest, catalog) {
  const byslug = new Map();
  for (const row of manifest.exercises) {
    if (row.exerciseId && row.exportPreferred) byslug.set(row.exerciseId, row.fitnotesName);
  }
  for (const ex of catalog) if (!byslug.has(ex.id)) byslug.set(ex.id, ex.name);
  return byslug;
}

const quote = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Nearest 5 lb. A plate calculator is backlog; 2.5s make this loadable. */
const toFive = (n) => Math.round(n / 5) * 5;

/**
 * One CSV row per exercise per session.
 *
 * @param program   from generate(), carrying `schedule`
 * @param startDate YYYY-MM-DD, local calendar date
 * @param state     canonical state, read for exerciseMax only
 * @param deps      { manifest, catalog, currentMax }
 */
export function toFitNotesCSV(program, startDate, state, { manifest, catalog, currentMax, dates: override }) {
  if (!program?.schedule?.length) {
    throw new ExportError(
      'This plan has no schedule, so it has no dates. Pick training days and regenerate.'
    );
  }

  const names = buildNameLookup(manifest, catalog);
  const categories = buildCategoryLookup(manifest, catalog);
  const sessions = program.weeks.flatMap((w) => w.sessions);
  // #54: the athlete may have moved individual sessions in the preview. An
  // override REPLACES the computed dates rather than adjusting the start, so a
  // single moved session does not shift the block. Length is checked because a
  // short array would silently export undefined dates for the tail.
  if (override && override.length !== sessions.length) {
    throw new ExportError(
      `${override.length} dates supplied for ${sessions.length} sessions`
    );
  }
  const dates = override ?? sessionDates(startDate, program.schedule, sessions.length);

  const rows = [];
  const unpriced = new Set();

  sessions.forEach((session, i) => {
    const date = dates[i];
    for (const block of session.blocks) {
      for (const g of block.setGroups) {
        const max = currentMax(state, g.exerciseId);
        const pct = g.intensityOf1RM;
        const weight = max && pct != null ? toFive(max.e1rm * pct) : null;

        // ANCHORABLE: could a max ever exist for this lift? ADR-023 anchors
        // percentages to barbell and trap-bar compounds at fatigueCost >= 3,
        // roughly 38 of 301 rows. The rest fall back to RIR, which the ADR
        // states outright: nobody knows their cable fly 1RM.
        //
        // So "@ 77%" on a suspension row is a percentage of NOTHING. The engine
        // does emit intensityOf1RM for every setGroup, but printing it where no
        // max is possible implies a weight is derivable and none is.
        //
        // Read off the SETGROUP, not the catalog: ADR-027 carries equipment,
        // fatigueCost and pattern on the setGroup precisely so a consumer never
        // re-joins against 301 rows.
        const anchorable =
          (g.equipment ?? []).some((t) => t === 'barbell' || t === 'trap_bar') &&
          (g.fatigueCost ?? 0) >= 3 &&
          g.pattern !== 'carry';

        // Only lifts that NEED a max and lack one. Counting every weightless row
        // conflated "needs a max, has none" with "will never have one", and only
        // the first is actionable.
        if (anchorable && !weight && pct != null) unpriced.add(g.exerciseId);

        // The note is the ONLY channel for what FitNotes has no column for.
        // Verified to round-trip verbatim through both CSV and .fitnotes.
        const scheme = g.sets != null && g.reps != null ? `${g.sets}x${g.reps}` : null;
        const note = [
          // Joined, not separated: "5x5 @ 82%" is ONE prescription, where
          // "5x5 . @ 82%" read as two unrelated facts.
          anchorable && pct != null && scheme
            ? `${scheme} @ ${Math.round(pct * 100)}%`
            : scheme,
          weight ? `${weight} lb` : null,
          // RIR only where a percentage cannot apply. Constant 2 today, which is
          // #47's problem rather than this one's.
          !anchorable && g.rir != null ? `RIR ${g.rir}` : null,
          g.restSeconds ? `rest ${g.restSeconds}s` : null
        ].filter(Boolean).join(' · ');

        rows.push([
          date,
          names.get(g.exerciseId) ?? g.exerciseId,
          // REQUIRED. A blank category is refused with "invalid row 0" (#36).
          categories.get(g.exerciseId) ?? DEFAULT_CATEGORY,
          // Explicit zeros, not blanks: a real FitNotes export writes 0.00 in
          // both weight columns on an unweighted row and never leaves them
          // empty. Matching what it emits beats guessing what it tolerates.
          '0.00',        // Weight (kg): the lbs column is what import reads
          weight ?? '0.00',
          0,             // Reps: ZERO. Cannot feed e1RM, so a skipped session leaves nothing false
          '', '', '',    // Distance, Distance Unit, Time
          note,
          'wr'
        ]);
      }
    }
  });

  const csv = [CSV_COLUMNS, ...rows].map((r) => r.map(quote).join(',')).join('\n') + '\n';
  return { csv, rows: rows.length, dates, unpriced: [...unpriced].sort() };
}

/**
 * Every destination date with the session that lands on it — #54.
 *
 * Pure, and the ONE place dates and sessions are paired. The export computed
 * this internally and told the athlete afterwards, in a status line, once the
 * file was already on disk. Same computation, surfaced before the download.
 *
 * `gap` is read off the session, not recomputed: the engine decided it at
 * generation time and a second opinion here is how two copies of a rule drift
 * apart. `collides` marks a date that already holds imported history — the
 * export ADDS rows rather than replacing them, so a clash means two lots of work
 * on one day.
 */
export function planDates(program, startDate, importedSets, overrides = {}) {
  const sessions = (program?.weeks ?? []).flatMap((w) => w.sessions);
  if (!sessions.length) throw new ExportError('this plan has no sessions');

  const dates = sessionDates(startDate, program.schedule, sessions.length);
  // Delegated, not reimplemented. A second copy of "what counts as a clash" is
  // how two copies of a rule drift apart.
  const taken = new Set(dateCollisions(dates, importedSets));

  // #54: an override moves ONE session without shifting the block.
  const final = dates.map((d, i) => overrides[i] ?? d);
  const clashes = new Set(dateCollisions(final, importedSets));

  return sessions.map((session, i) => {
    const date = final[i];
    // The gap this date actually gives, versus the gap the session was BUILT
    // under. gapClass() ran at generation time and
    // compressedAccessoryMultiplier was applied while accessory volume was
    // chosen (loadDomain.js), so the sets cannot be re-derived from a new date
    // without regenerating -- which would change the exercises under an athlete
    // who has just reviewed them. So: report the divergence, never absorb it.
    const spacing = i === 0 ? null : daysBetween(final[i - 1], date);
    const actualGap = spacing == null ? null : (spacing >= 2 ? 'recovered' : 'compressed');
    const generatedGap = session.gap ?? null;

    return {
      index: i,
      date,
      computed: dates[i],
      moved: date !== dates[i],
      label: session.label,
      gap: generatedGap,
      actualGap,
      // Only a real divergence, and only when both are known.
      gapChanged: Boolean(actualGap && generatedGap && actualGap !== generatedGap),
      spacing,
      // Session order IS training order. A move that lands on or before the
      // previous session is refused rather than quietly sorted.
      outOfOrder: spacing != null && spacing <= 0,
      collides: clashes.has(date)
    };
  });
}

/**
 * Planned dates that already hold imported history.
 *
 * #25 requires warning before writing onto a day that already has work: the
 * export cannot tell FitNotes to replace, so rows are ADDED and a collision
 * means two sets of work on one day.
 */
export function dateCollisions(dates, importedSets) {
  const taken = new Set((importedSets ?? []).map((s) => s.date));
  return dates.filter((d) => taken.has(d));
}