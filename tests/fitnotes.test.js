/**
 * Tests for the FitNotes import adapter (#24).
 *
 * Runs against SYNTHETIC rows, never the athlete's export. Personal training
 * data is not in this repo (ADR-031), and a fixture can be built to contain the
 * cases the real file happens not to have -- a kilogram-logged weight, a
 * renamed exercise, an unapproved mapping tier.
 *
 * The real export is still the source of the NUMBERS asserted below. Measured
 * via js/storage/sqlite.js: 1323 log rows, 748 complete, 706 weighted and all
 * reversing to a clean 0.25 lb step, 42 zero-weight, 0 ambiguous, `unit` = 2
 * throughout.
 *
 * `db` here is a plain object with a `table()` method. importFitNotes takes the
 * reader structurally for exactly this reason: the transformation is testable
 * without a database file.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LB_PER_KG,
  ImportError,
  parseManifest,
  reverseWeight,
  importFitNotes
} from '../js/storage/fitnotes.js';

/** The manifest's real column order, so a header change breaks these tests. */
const HEADER = 'fitnotes_id,fitnotes_name,fitnotes_category,trainer_id,trainer_name,' +
  'trainer_file,pattern,tracking,match_tier,action,completed_sets,log_rows,authorised_by,basis';

const manifestCsv = [
  HEADER,
  '205,Flat Barbell Bench Press,Chest,,Barbell Bench Press,06_chest.csv,push_h,weight_reps,alias,rename,107,115,#33,',
  '213,Barbell Squat,Legs,back-squat,Back Squat,01_quads.csv,squat,weight_reps,alias,rename,52,52,#33,',
  '222,Shoulder Curl,Arms,,,,,,review,none,17,22,,combo lift',
  // A basis field containing commas, quoted per RFC 4180. A naive split shifts
  // every later column on this row.
  '232,Bulgarian Split Hinge,Legs,b-stance-romanian-deadlift,B-Stance Romanian Deadlift,' +
    '03_hamstrings.csv,hinge,weight_reps,judgement,rename,8,8,#38,' +
    '"Hinged split stance, posterior chain, not a squat"'
].join('\n');

/** Trainer display name -> catalog slug. The caller owns the catalog (#26). */
const resolveName = (name) => ({
  'Barbell Bench Press': 'barbell-bench-press',
  'Back Squat': 'back-squat',
  'B-Stance Romanian Deadlift': 'b-stance-romanian-deadlift'
}[name] ?? null);

const mapping = () => parseManifest(manifestCsv, resolveName);

/** One training_log row, with every column the real table has. */
function logRow(over = {}) {
  return {
    _id: 1,
    exercise_id: 205,
    date: '2026-08-01',
    metric_weight: 102.0582,        // 225 lb
    reps: 3,
    unit: 2,
    routine_section_exercise_set_id: 0,
    timer_auto_start: 0,
    is_personal_record: 0,
    is_personal_record_first: 0,
    is_complete: 1,
    is_pending_update: 0,
    distance: 0,
    duration_seconds: 0,
    ...over
  };
}

const reader = (log, exercise = []) => ({
  table: (name) => {
    if (name === 'training_log') return log;
    if (name === 'exercise') return exercise;
    throw new Error(`unexpected table ${name}`);
  }
});

const EXERCISES = [
  { _id: 205, name: 'Flat Barbell Bench Press', category_id: 1 },
  { _id: 213, name: 'Barbell Squat', category_id: 2 },
  { _id: 222, name: 'Shoulder Curl', category_id: 3 }
];

describe('manifest parsing', () => {
  test('keys on the numeric id, not the name', () => {
    const m = mapping();
    assert.equal(m.get(205).exerciseId, 'barbell-bench-press');
    assert.equal(m.get(213).exerciseId, 'back-squat');
  });

  test('a trainer_id is used directly; a name is resolved by the caller', () => {
    // Most manifest rows carry a name and leave trainer_id blank. Slugifying
    // the name here would be a guess at the catalog's own ids.
    const m = mapping();
    assert.equal(m.get(232).exerciseId, 'b-stance-romanian-deadlift');
    assert.equal(m.get(205).exerciseId, 'barbell-bench-press');
  });

  test('an unapproved review tier is NOT applied', () => {
    // #33: no fuzzy tier is auto-approved. An early pass scored `Incline
    // Barbell Bench Press` against `Barbell Bench Press` while `Incline Barbell
    // Press` existed -- 18 sets onto the wrong lift.
    const m = mapping();
    assert.equal(m.get(222).exerciseId, null, 'a review-tier row was applied');
    assert.equal(m.get(222).tier, 'review');
  });

  test('a quoted field containing commas does not shift columns', () => {
    const m = mapping();
    assert.equal(m.get(232).fitnotesName, 'Bulgarian Split Hinge');
    assert.equal(m.get(232).tier, 'judgement');
  });

  test('an unresolvable name yields null rather than a guessed slug', () => {
    const m = parseManifest(manifestCsv, () => null);
    assert.equal(m.get(205).exerciseId, null);
  });

  test('a duplicate id throws rather than one row silently winning', () => {
    const dup = [HEADER,
      '205,A,Chest,slug-a,,,,,exact,keep,1,1,,',
      '205,B,Chest,slug-b,,,,,exact,keep,1,1,,'].join('\n');
    assert.throws(() => parseManifest(dup), ImportError);
  });

  test('a missing column throws', () => {
    assert.throws(() => parseManifest('a,b,c\n1,2,3'), ImportError);
  });
});

describe('the weight conversion runs backwards', () => {
  /**
   * FitNotes stores kilograms; the athlete logged pounds. Storing metric_weight
   * verbatim would show a 225 lb bench as 102.0582 -- never entered, falsely
   * precise, and fed to ADR-023's e1RM.
   */
  test('the pound figures the real export contains', () => {
    for (const [kg, lb] of [[1.13398, 2.5], [61.23492, 135], [102.0582, 225], [83.91452, 185]]) {
      const out = reverseWeight(kg, 2, 1);
      assert.equal(out.weight, lb, `${kg} kg should reverse to ${lb} lb`);
      assert.equal(out.weightUnit, 'lb');
    }
  });

  test('the factor is FitNotes own, not the international pound', () => {
    // 0.45359237 would still round correctly at two decimals, which is why the
    // wrong constant sat in INTERCHANGE.md unnoticed (#26).
    assert.equal(LB_PER_KG, 0.453592);
    assert.equal(Math.round(102.0582 / LB_PER_KG), 225);
  });

  test('zero weight is null, not a measurement', () => {
    // Bodyweight work: 42 completed rows in the real export. `weight: 0` with a
    // unit would assert the athlete lifted zero pounds.
    assert.deepEqual(reverseWeight(0, 2, 1), { weight: null, weightUnit: null });
  });

  test('a genuinely metric weight is recognised as kilograms', () => {
    // Not present in this export -- every completed row is pounds -- so it can
    // only be tested synthetically. 100 kg reverses to 220.46 lb, off-step.
    const out = reverseWeight(100, 0, 1);
    assert.equal(out.weightUnit, 'kg');
    assert.equal(out.weight, 100);
  });

  test('a weight on neither step throws rather than being guessed at', () => {
    // The unit codes are undecoded: 2 on every completed row, unmapped by
    // MeasurementUnit, and not the 0/1 usually described. A wrong unit is a
    // silently wrong weight that surfaces as a prescription (ADR-023).
    assert.throws(() => reverseWeight(77.7777, 2, 99), ImportError);
  });

  test('a negative weight throws', () => {
    assert.throws(() => reverseWeight(-50, 2, 1), ImportError);
  });
});

describe('only completed rows import', () => {
  test('is_complete = 0 rows are skipped and counted', () => {
    // 575 of 1323 real rows are templates or abandoned entries, and #24 is
    // explicit that pending rows never affect planning metrics.
    const out = importFitNotes(reader([
      logRow({ _id: 1, is_complete: 1 }),
      logRow({ _id: 2, is_complete: 0 }),
      logRow({ _id: 3, is_complete: 0 })
    ], EXERCISES), mapping());

    assert.equal(out.sets.length, 1);
    assert.equal(out.summary.skippedIncomplete, 2);
    assert.equal(out.summary.logRows, 3);
  });
});

describe('set records', () => {
  test('the id is deterministic, so a re-import is a genuine no-op', () => {
    const rows = [logRow({ _id: 1 }), logRow({ _id: 2 }), logRow({ _id: 3 })];
    const first = importFitNotes(reader(rows, EXERCISES), mapping()).sets.map((s) => s.id);
    const again = importFitNotes(reader(rows, EXERCISES), mapping()).sets.map((s) => s.id);

    assert.deepEqual(first, [
      'fn:205:2026-08-01:1', 'fn:205:2026-08-01:2', 'fn:205:2026-08-01:3'
    ]);
    assert.deepEqual(first, again, 'ids are not stable across imports');
  });

  test('setIndex counts within one exercise on one date', () => {
    const out = importFitNotes(reader([
      logRow({ _id: 1, exercise_id: 205, date: '2026-08-01' }),
      logRow({ _id: 2, exercise_id: 205, date: '2026-08-01' }),
      logRow({ _id: 3, exercise_id: 213, date: '2026-08-01', metric_weight: 61.23492 }),
      logRow({ _id: 4, exercise_id: 205, date: '2026-08-02' })
    ], EXERCISES), mapping());

    assert.deepEqual(out.sets.map((s) => s.setIndex), [1, 2, 1, 1]);
  });

  test('the source name comes from the database, not the manifest', () => {
    // A row renamed since the manifest was authored still shows the athlete
    // what THEY call it, which is what makes review possible.
    const out = importFitNotes(reader([logRow()], [
      { _id: 205, name: 'Bench Press (renamed)', category_id: 1 }
    ]), mapping());

    assert.equal(out.sets[0].sourceExerciseName, 'Bench Press (renamed)');
    assert.equal(out.sets[0].exerciseId, 'barbell-bench-press', 'the id join broke on a rename');
  });

  test('notes is always null: training_log has no such column', () => {
    assert.equal(importFitNotes(reader([logRow()], EXERCISES), mapping()).sets[0].notes, null);
  });

  test('zero reps, seconds and distance become null, not zero', () => {
    const s = importFitNotes(reader([logRow()], EXERCISES), mapping()).sets[0];
    assert.equal(s.seconds, null);
    assert.equal(s.distance, null);
    assert.equal(s.distanceUnit, null);
    assert.equal(s.rpe, null);
  });

  test('a timed row carries seconds', () => {
    const s = importFitNotes(reader([
      logRow({ metric_weight: 0, reps: 0, duration_seconds: 600 })
    ], EXERCISES), mapping()).sets[0];

    assert.equal(s.seconds, 600);
    assert.equal(s.reps, null);
    assert.equal(s.weight, null);
  });

  test('a distance row is metres, inferred from the source and counted', () => {
    // FitNotes' own basic CSV names the unit: the single completed distance row
    // in the real export (rowing machine, 800, 240s) exports as
    // `Distance Unit: m`. It is NOT decoded from `unit`, which holds 2 on that
    // row exactly as it does on every pound-weighted row.
    //
    // This previously emitted 'unknown', which validateImportedSet rightly
    // refuses -- so the import threw at save time and the UI hung mid-sentence
    // on the first real run. An illegal placeholder is not an honest unknown.
    const out = importFitNotes(reader([
      logRow({ metric_weight: 0, reps: 0, distance: 800, duration_seconds: 240 })
    ], EXERCISES), mapping());

    assert.equal(out.sets[0].distance, 800);
    assert.equal(out.sets[0].distanceUnit, 'm');
    assert.equal(out.sets[0].seconds, 240);

    // Counted, not hidden: an export logging an outdoor run in miles would
    // import as metres and be wrong, and this is what makes that visible.
    assert.equal(out.summary.undecodedDistance, 1);
  });

  test('a row with no distance carries no distance unit', () => {
    // `distance: 0` is absence, not a measurement of zero. A unit without a
    // value would fail validateImportedSet's pairing rule.
    const out = importFitNotes(reader([logRow()], EXERCISES), mapping());
    assert.equal(out.sets[0].distance, null);
    assert.equal(out.sets[0].distanceUnit, null);
  });

  test('a non-date date throws rather than being coerced', () => {
    assert.throws(() => importFitNotes(
      reader([logRow({ date: '2026-08-01T00:00:00Z' })], EXERCISES), mapping()
    ), ImportError);
  });
});

describe('unmapped exercises stay reviewable', () => {
  /**
   * #24: "unmatched exercises remain reviewable and are not silently
   * discarded." The consequence is invisible and worth asserting: ADR-023 keys
   * e1RM on exerciseId, so an unresolved row contributes nothing to
   * progression until it is mapped.
   */
  test('an unapproved row imports with null exerciseId and both source fields', () => {
    const out = importFitNotes(reader([
      logRow({ _id: 1, exercise_id: 222, metric_weight: 9.07184, reps: 8 })
    ], EXERCISES), mapping());

    const s = out.sets[0];
    assert.equal(s.exerciseId, null, 'a review-tier row was mapped anyway');
    assert.equal(s.sourceExerciseId, 222);
    assert.equal(s.sourceExerciseName, 'Shoulder Curl');
    assert.equal(s.weight, 20, 'the weight was lost with the mapping');
  });

  test('an exercise absent from the manifest imports rather than being dropped', () => {
    const out = importFitNotes(reader([
      logRow({ _id: 1, exercise_id: 999 })
    ], [{ _id: 999, name: 'Something New', category_id: 1 }]), mapping());

    assert.equal(out.sets.length, 1, 'an unknown exercise was discarded');
    assert.equal(out.sets[0].exerciseId, null);
    assert.equal(out.review[0].inManifest, false);
  });

  test('the review queue groups by exercise and counts sets', () => {
    const out = importFitNotes(reader([
      logRow({ _id: 1, exercise_id: 222, metric_weight: 9.07184 }),
      logRow({ _id: 2, exercise_id: 222, metric_weight: 9.07184 }),
      logRow({ _id: 3, exercise_id: 205 })
    ], EXERCISES), mapping());

    assert.equal(out.review.length, 1);
    assert.equal(out.review[0].sets, 2);
    assert.equal(out.summary.resolved, 1);
    assert.equal(out.summary.unresolved, 2);
  });

  test('the summary is enough to show a review count in the UI', () => {
    // ADR-031 carries this as a UI requirement: an unresolved backlog quietly
    // starves the maxes, so the count must be visible rather than discoverable.
    const out = importFitNotes(reader([
      logRow({ _id: 1, exercise_id: 222, metric_weight: 9.07184 }),
      logRow({ _id: 2, exercise_id: 205 })
    ], EXERCISES), mapping());

    assert.deepEqual(out.summary, {
      logRows: 2,
      skippedIncomplete: 0,
      imported: 2,
      resolved: 1,
      unresolved: 1,
      reviewExercises: 1,
      undecodedDistance: 0
    });
  });
});

describe('malformed input is refused', () => {
  test('a reader without table() throws', () => {
    assert.throws(() => importFitNotes({}, mapping()), ImportError);
  });

  test('a mapping that is not a Map throws', () => {
    assert.throws(() => importFitNotes(reader([], []), {}), ImportError);
  });

  test('a row with no exercise_id throws', () => {
    assert.throws(() => importFitNotes(
      reader([logRow({ exercise_id: null })], EXERCISES), mapping()
    ), ImportError);
  });
});
