/**
 * FitNotes adapter: SQLite rows in, normalised set records out (#24).
 *
 * PURE. No file loading, no browser API, no IndexedDB. It takes a reader and a
 * parsed manifest and returns records plus a summary, so the whole import is
 * testable in `node --test` and the wiring question -- how the manifest reaches
 * the browser -- stays separable from the transformation.
 *
 * This is an ADAPTER at the edge (#26). FitNotes identity does not cross it:
 * every record leaves with a catalog slug in `exerciseId`, or with `null` and
 * both source identity fields intact so it can be reviewed.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS MEASURED, on the real export via js/storage/sqlite.js
 *
 *   training_log            1323 rows
 *   is_complete = 1          748 rows      <- the only rows imported
 *   weighted completed       706 rows      all reverse to a clean 0.25 lb step
 *   zero-weight completed     42 rows      bodyweight work
 *   ambiguous                  0 rows      none land on a kg step instead
 *   unit column                  2         on every completed row
 *
 * Two things follow. The pound rule holds on this export without exception, so
 * it is ASSERTED per row rather than assumed. And `unit = 2` accompanies pounds
 * here, which is NOT the 0/1 usually described for this schema, so the code is
 * recorded and cross-checked rather than trusted as a lookup.
 * ---------------------------------------------------------------------------
 *
 * THE CONVERSION RUNS BACKWARDS, DELIBERATELY. `training_log.metric_weight` is
 * always kilograms; the athlete logged pounds. Storing 102.0582 for a 225 lb
 * bench would show a number never entered, carry false precision, and feed
 * ADR-023's e1RM. The factor is 0.453592 -- FitNotes' own, read off the data
 * (102.0582 / 0.453592 = 225 exactly), not the international 0.45359237.
 *
 * `notes` IS ALWAYS NULL. `training_log` has no notes column. Its 14 columns
 * are _id, exercise_id, date, metric_weight, reps, unit,
 * routine_section_exercise_set_id, timer_auto_start, is_personal_record,
 * is_personal_record_first, is_complete, is_pending_update, distance,
 * duration_seconds. docs/INTERCHANGE.md keeps the field for other sources; this
 * adapter cannot populate it.
 */

/** FitNotes' own pound factor, read off the export. Not 0.45359237 (#26). */
export const LB_PER_KG = 0.453592;

/** Weights land on 0.25 lb steps: the smallest plate pair the athlete owns. */
const LB_STEP = 0.25;

/** Floating-point slack. A 0.25 lb step at 1000 lb is still exact to ~1e-9. */
const EPSILON = 1e-6;

/**
 * Tiers the manifest authorises for automatic application.
 *
 * `review` is EXCLUDED. Those 40 rows are explicitly unapproved (#33), and an
 * early automated pass scored `Incline Barbell Bench Press` against
 * `Barbell Bench Press` while `Incline Barbell Press` existed -- 18 sets onto
 * the wrong lift. A review row therefore imports UNRESOLVED rather than mapped,
 * which is the honest outcome: the sets are kept and the decision is pending.
 */
const APPROVED_TIERS = new Set([
  'exact', 'exact/normalised', 'alias', 'alias-manual', 'token-set', 'judgement'
]);

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

// ------------------------------------------------------------------ manifest

/**
 * Split one CSV line, honouring RFC 4180 quoting.
 *
 * The manifest's `basis` column is authored prose and contains commas. A naive
 * split shifts every later column on those rows, which would silently
 * misattribute mappings -- the exact failure this file exists to prevent.
 */
function splitRow(line) {
  const out = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

/**
 * Parse `data/fitnotes/fitnotes-mapping.csv` into a Map keyed on the FitNotes
 * NUMERIC id.
 *
 * Keyed on the id, never the name, because FitNotes lets the athlete rename any
 * row. A name-keyed join is how a renamed row lands its history on a different
 * lift, and it is why `fitnotes_id` was added to the manifest (#33).
 *
 * @param {string} csvText the manifest, verbatim
 * @param {(name: string) => string|null} [resolveName]
 *   Turns a Trainer display name into a catalog slug. Needed because most
 *   manifest rows carry `trainer_name` and leave `trainer_id` blank, and
 *   slugifying a name here would be a guess at the catalog's own ids. The
 *   caller owns the catalog, so the caller resolves. Without it, name-only rows
 *   arrive unresolved rather than wrongly resolved.
 */
export function parseManifest(csvText, resolveName = () => null) {
  const lines = String(csvText).trim().split(/\r?\n/);
  if (lines.length < 2) throw new ImportError('manifest is empty');

  const header = splitRow(lines[0]);
  const col = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new ImportError(`manifest has no ${name} column`);
    return i;
  };

  const iId = col('fitnotes_id');
  const iName = col('fitnotes_name');
  const iTrainerId = col('trainer_id');
  const iTrainerName = col('trainer_name');
  const iTier = col('match_tier');

  const map = new Map();

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitRow(line);
    const id = Number(cells[iId]);
    if (!Number.isInteger(id)) {
      throw new ImportError(`manifest row has a non-numeric fitnotes_id: ${JSON.stringify(cells[iId])}`);
    }
    if (map.has(id)) throw new ImportError(`manifest has two rows for fitnotes_id ${id}`);

    const tier = (cells[iTier] || '').trim();
    const trainerId = (cells[iTrainerId] || '').trim();
    const trainerName = (cells[iTrainerName] || '').trim();

    // An unapproved tier is recorded but never applied. The sets still import;
    // they import as reviewable.
    const approved = APPROVED_TIERS.has(tier);
    const exerciseId = approved
      ? (trainerId || (trainerName ? resolveName(trainerName) : null) || null)
      : null;

    map.set(id, {
      fitnotesId: id,
      fitnotesName: (cells[iName] || '').trim(),
      exerciseId,
      tier: tier || null
    });
  }

  return map;
}

// ------------------------------------------------------------------- weights

/**
 * Reverse FitNotes' kilogram conversion, asserting the result rather than
 * trusting the `unit` column.
 *
 * The codes are NOT decoded: this export holds 2 on every completed row, the
 * `MeasurementUnit` table does not map it, and it is not the 0/1 usually
 * described for this schema (#26). So the unit is DERIVED -- a weight whose
 * reversal lands on a 0.25 lb step while its kilogram value does not was logged
 * in pounds -- and a row satisfying neither throws.
 *
 * Failing loudly matters more than it looks. A wrong unit is a silently wrong
 * weight, and ADR-023 feeds weights into e1RM, so the error would surface as a
 * prescription rather than as a fault.
 */
export function reverseWeight(metricWeight, unitCode, rowId) {
  if (typeof metricWeight !== 'number' || !Number.isFinite(metricWeight)) {
    throw new ImportError(`row ${rowId}: metric_weight is not a number`);
  }
  if (metricWeight === 0) return { weight: null, weightUnit: null };
  if (metricWeight < 0) throw new ImportError(`row ${rowId}: negative metric_weight ${metricWeight}`);

  const asPounds = metricWeight / LB_PER_KG;
  const onStep = (v, step) => Math.abs(v / step - Math.round(v / step)) < EPSILON;

  if (onStep(asPounds, LB_STEP)) {
    // Two decimals represents a 0.25 lb step exactly, and drops the float noise
    // that dividing by 0.453592 leaves behind (120.00000000000001).
    return { weight: Math.round(asPounds * 100) / 100, weightUnit: 'lb' };
  }

  if (onStep(metricWeight, LB_STEP)) {
    return { weight: Math.round(metricWeight * 100) / 100, weightUnit: 'kg' };
  }

  throw new ImportError(
    `row ${rowId}: ${metricWeight} kg reverses to ${asPounds.toFixed(4)} lb, and neither ` +
    `value lands on a ${LB_STEP} step. The unit cannot be derived and unit=${unitCode} is ` +
    'not a decoded mapping, so this row is refused rather than guessed at (#26).'
  );
}

// -------------------------------------------------------------------- import

const nullIfZero = (v) => (typeof v === 'number' && v > 0 ? v : null);

/**
 * Normalise a FitNotes export into `importedSets` records.
 *
 * Imports ONLY `is_complete = 1`. 575 of 1323 rows in the real export are
 * incomplete -- templates and abandoned entries -- and #24 is explicit that
 * pending rows never affect planning metrics.
 *
 * @param {{ table: (name: string) => object[] }} db a SqliteFile, or anything
 *   exposing `table()`. Kept structural so tests need no database.
 * @param {Map<number, object>} mapping from `parseManifest`
 * @returns {{ sets: object[], review: object[], summary: object }}
 */
export function importFitNotes(db, mapping) {
  if (!db || typeof db.table !== 'function') {
    throw new ImportError('importFitNotes: expected a reader exposing table()');
  }
  if (!(mapping instanceof Map)) {
    throw new ImportError('importFitNotes: expected a manifest Map from parseManifest()');
  }

  const log = db.table('training_log');
  const exercises = db.table('exercise');

  // Source names come from the DATABASE, not the manifest, so a row renamed
  // since the manifest was authored still shows the athlete what they called
  // it. That is the whole point of keeping `sourceExerciseName`.
  const nameById = new Map(exercises.map((e) => [e._id, e.name]));

  const complete = log.filter((r) => r.is_complete === 1);
  const skippedIncomplete = log.length - complete.length;

  // setIndex is order within one exercise on one date. Rowid order IS insertion
  // order here, and sqlite.js now walks the b-tree in rowid order (711c754), so
  // the derived id is stable across re-imports -- which is what makes a
  // replacement import a genuine no-op rather than a dedupe problem (ADR-031).
  const seen = new Map();
  const sets = [];
  const unresolved = new Map();

  for (const row of complete) {
    const sourceExerciseId = row.exercise_id;
    const sourceExerciseName = nameById.get(sourceExerciseId) ?? null;

    if (sourceExerciseId == null) {
      throw new ImportError(`training_log row ${row._id} has no exercise_id`);
    }
    if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      throw new ImportError(
        `training_log row ${row._id} has date ${JSON.stringify(row.date)}, ` +
        'which is not a YYYY-MM-DD local calendar date'
      );
    }

    const key = `${sourceExerciseId}:${row.date}`;
    const setIndex = (seen.get(key) ?? 0) + 1;
    seen.set(key, setIndex);

    const { weight, weightUnit } = reverseWeight(row.metric_weight, row.unit, row._id);
    const entry = mapping.get(sourceExerciseId);
    const exerciseId = entry?.exerciseId ?? null;

    if (exerciseId === null) {
      const prior = unresolved.get(sourceExerciseId);
      unresolved.set(sourceExerciseId, {
        sourceExerciseId,
        sourceExerciseName,
        tier: entry?.tier ?? null,
        inManifest: Boolean(entry),
        sets: (prior?.sets ?? 0) + 1
      });
    }

    sets.push({
      // Deterministic, so re-importing an unchanged export yields identical ids
      // and the replacement is a no-op by construction (#24, ADR-031).
      id: `fn:${sourceExerciseId}:${row.date}:${setIndex}`,
      source: 'fitnotes-import',
      exerciseId,
      sourceExerciseId,
      sourceExerciseName,
      date: row.date,
      setIndex,
      weight,
      weightUnit,
      reps: nullIfZero(row.reps),
      seconds: nullIfZero(row.duration_seconds),
      distance: nullIfZero(row.distance),
      // The distance unit is genuinely undecoded. Only 3 completed rows in the
      // real export carry distance at all, so rather than guess a code this
      // reports what it cannot determine.
      // METRES, from FitNotes' own basic CSV: the one completed distance row in
      // this export (rowing machine, 800, 240s) exports as `Distance Unit: m`.
      //
      // It is not decoded from `unit`. That column holds 2 on this row, exactly
      // as it does on every pound-weighted row, so it does not distinguish
      // measure at all. `MeasurementUnit` does not map it either -- that table's
      // `type` groups BODY-measurement kinds (0 unknown, 1 weight, 2 length,
      // 3 percent, 4 BMI) and is not a foreign key from training_log.
      //
      // So this is an inference from one row, counted in the summary rather than
      // hidden. A future export logging an outdoor run in miles would import as
      // metres and be wrong; the count is what makes that visible.
      distanceUnit: nullIfZero(row.distance) === null ? null : 'm',
      rpe: null,
      // training_log HAS NO NOTES COLUMN. Always null from this source.
      notes: null
    });
  }

  const review = [...unresolved.values()].sort((a, b) => b.sets - a.sets);
  const resolved = sets.filter((s) => s.exerciseId !== null).length;

  // Distance rows carry `distanceUnit: 'unknown'`, which validateImportedSet
  // rejects -- correctly, since 'unknown' is not a unit. Surfaced here so the
  // caller can refuse the import rather than discovering it at save time.
  const undecodedDistance = sets.filter((s) => s.distance !== null).length;

  return {
    sets,
    review,
    summary: {
      logRows: log.length,
      skippedIncomplete,
      imported: sets.length,
      resolved,
      unresolved: sets.length - resolved,
      reviewExercises: review.length,
      undecodedDistance
    }
  };
}
