/**
 * The ADR-011 gate, as a test rather than a manual check in Safari.
 *
 *   export -> wipe -> import -> identical canonical state
 *
 * ADR-011 says no later milestone begins until that passes, so it has to be
 * something CI can run on every commit. That is the whole reason the
 * serialisation logic lives in state.js with no IndexedDB reference: Node has
 * no `indexedDB` and this project ships no DOM shim, so a gate written against
 * the browser API would be a gate nobody runs.
 *
 * The state under test is built from a REAL generated program, including the
 * kind of in-place edit app.js actually performs, because the failure this
 * gate exists to catch is a field that survives generation but not a round
 * trip.
 */
import { validateProfile, putProfile, removeProfile,
  replaceImportedDayNotes, putSessionNote, notesForDate } from '../js/storage/state.js';
import { STORES } from '../js/storage/db.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../js/engine/index.js';
import { defs } from '../js/engine/defs.js';
import { setGroupAt } from '../js/engine/blocks.js';
import {
  STATE_VERSION,
  EXPORT_FORMAT,
  StateError,
  emptyState,
  canonical,
  serialise,
  putPlan,
  removePlan,
  replaceImportedSets,
  appendExerciseMax,
  currentMax,
  toExport,
  toExportJSON,
  fromImport,
  fromImportJSON,
  validate,
  validateImportedSet,
  toCSV,
  CSV_COLUMNS
} from '../js/storage/state.js';

/**
 * The real request shape, read from the engine rather than from SPEC.md.
 * SPEC's request block omits `athlete` entirely and still says `history: []`
 * is "empty until M6"; persisting against that illustration would drop a field
 * the engine reads.
 */
const request = {
  schemaVersion: 1,
  styleId: 'strength',
  daysPerWeek: 3,
  sessionMinutes: 70,
  equipmentProfile: 'commercial-gym',
  blockWeeks: 2,
  seed: 20260813,
  athlete: { skillLevel: 3, hasCoaching: false, strictReps: {} },
  history: []
};

/**
 * A conforming set record with every nullable field present. Written as a helper
 * so a shape change is one edit rather than one per fixture - and so a test
 * cannot accidentally assert against a row the validator would reject.
 */
function setRow(over = {}) {
  return {
    id: 'fn:1:2026-08-01:1',
    source: 'fitnotes-import',
    // Defaults to a RESOLVED row. Tests override exerciseId to null for the
    // review path; a default with no identity at all is refused, correctly.
    exerciseId: 'barbell-bench-press',
    sourceExerciseId: 205,
    sourceExerciseName: 'Flat Barbell Bench Press',
    date: '2026-08-01',
    setIndex: 1,
    weight: null,
    weightUnit: 'kg',
    reps: null,
    seconds: null,
    distance: null,
    distanceUnit: null,
    rpe: null,
    notes: null,
    ...over
  };
}

function planFrom(id, over = {}) {
  const req = { ...request, ...over };
  return {
    id,
    createdAt: '2026-08-19T00:00:00.000Z',
    edited: false,
    request: req,
    program: generate(req, defs)
  };
}

/** A state exercising every store, so the gate cannot pass by covering none. */
function populated() {
  let s = emptyState();

  s = putPlan(s, planFrom('plan-strength'));

  // An edited plan, mutated the way app.js mutates: assignment onto the
  // setGroup, and a splice that can empty a block. If either survives
  // generation but not serialisation, the gate should fail here.
  const edited = planFrom('plan-edited', { styleId: 'hiit' });
  const session = edited.program.weeks[0].sessions[0];
  const group = setGroupAt(session, 0, 0);
  if (group.sets != null) group.sets = 99;
  if (group.workSeconds != null) group.workSeconds = 33;
  session.blocks[0].setGroups.splice(1, 1);
  edited.edited = true;
  s = putPlan(s, edited);

  // Conforms to docs/INTERCHANGE.md section 2. The previous fixture did not:
  // it used `fitnotesId` where the spec says `sourceExerciseId` and `unit` where
  // it says `weightUnit`, and carried no `source` or `setIndex`. It was written
  // when nothing validated rows, which is precisely the accident #26 exists to
  // prevent - the first writer defining the format. Now it cannot.
  s = replaceImportedSets(s, [
    setRow({ id: 'fn:205:2026-08-01:1', sourceExerciseId: 205, sourceExerciseName: 'Flat Barbell Bench Press',
             exerciseId: 'barbell-bench-press', date: '2026-08-01', setIndex: 1, weight: 100, reps: 3 }),
    setRow({ id: 'fn:205:2026-08-08:1', sourceExerciseId: 205, sourceExerciseName: 'Flat Barbell Bench Press',
             exerciseId: 'barbell-bench-press', date: '2026-08-08', setIndex: 1, weight: 102.5, reps: 2 }),
    setRow({ id: 'fn:213:2026-08-08:1', sourceExerciseId: 213, sourceExerciseName: 'Barbell Squat',
             exerciseId: 'back-squat', date: '2026-08-08', setIndex: 1, weight: 140, reps: 1 }),
    // An UNRESOLVED row. Legal, and the review mechanism (#24): it keeps both
    // source identity fields and contributes nothing to e1RM until mapped.
    setRow({ id: 'fn:222:2026-08-08:1', sourceExerciseId: 222, sourceExerciseName: 'Shoulder Curl',
             exerciseId: null, date: '2026-08-08', setIndex: 1, weight: 20, reps: 8,
             notes: 'curl into press, one movement' })
  ], '2026-08-19T09:00:00.000Z');

  s = appendExerciseMax(s, {
    id: 'max-1', exerciseId: 'barbell-bench-press', e1rm: 110,
    source: 'estimated', effectiveDate: '2026-08-01'
  });
  s = appendExerciseMax(s, {
    id: 'max-2', exerciseId: 'barbell-bench-press', e1rm: 109.5,
    source: 'estimated', effectiveDate: '2026-08-08'
  });
  s = appendExerciseMax(s, {
    id: 'max-3', exerciseId: 'back-squat', e1rm: 144.7,
    source: 'tested', effectiveDate: '2026-08-08'
  });

  return s;
}

describe('ADR-011 persistence gate', () => {
  test('export -> wipe -> import reproduces identical canonical state', () => {
    const before = populated();

    // Export, then wipe: `emptyState()` is the post-eviction condition ADR-004
    // describes, not a metaphor for one.
    const json = toExportJSON(before, '2026-08-19T12:00:00.000Z');
    const wiped = emptyState();
    assert.equal(wiped.plans.length, 0, 'wipe did not clear plans');

    const after = fromImportJSON(json);

    assert.deepEqual(after, canonical(before), 'round trip changed the state structurally');
    assert.equal(serialise(after), serialise(before), 'round trip changed the canonical bytes');
  });

  test('an edited draft survives the round trip, edits included', () => {
    const before = populated();
    const after = fromImportJSON(toExportJSON(before));

    const a = before.plans.find((p) => p.id === 'plan-edited');
    const b = after.plans.find((p) => p.id === 'plan-edited');
    assert.ok(b, 'the edited plan did not survive');
    assert.equal(b.edited, true, 'the edited flag was lost');
    assert.equal(serialise(a.program), serialise(b.program), 'the edited program tree changed');
  });

  test('re-exporting an imported state is byte-stable', () => {
    // If this drifts, something in the pipeline is not order-stable and the
    // gate above would pass by luck on one run.
    const first = toExportJSON(populated());
    const second = toExportJSON(fromImportJSON(first));
    assert.equal(
      serialise(fromImportJSON(second)),
      serialise(fromImportJSON(first)),
      'export is not stable across a second trip'
    );
  });

  test('exportedAt lives in the envelope, never in the state', () => {
    const s = populated();
    const a = toExport(s, '2026-01-01T00:00:00.000Z');
    const b = toExport(s, '2026-12-31T23:59:59.000Z');
    assert.notEqual(a.exportedAt, b.exportedAt, 'the timestamp was not carried');
    assert.equal(serialise(a.state), serialise(b.state),
      'a timestamp leaked into state, so the round trip can never be byte-stable');
  });
});

describe('imports fail closed (#35)', () => {
  const rejects = {
    'not JSON at all': () => fromImportJSON('{nope'),
    'a bare array': () => fromImport([]),
    'null': () => fromImport(null),
    'no formatVersion': () => fromImport({ state: emptyState() }),
    'a future format': () => fromImport({ formatVersion: EXPORT_FORMAT + 1, state: emptyState() }),
    'no state': () => fromImport({ formatVersion: EXPORT_FORMAT }),
    'a future state version': () =>
      fromImport({ formatVersion: EXPORT_FORMAT, state: { ...emptyState(), version: STATE_VERSION + 1 } }),
    'plans that are not an array': () =>
      fromImport({ formatVersion: EXPORT_FORMAT, state: { ...emptyState(), plans: {} } }),
    'a plan with no program': () =>
      fromImport({ formatVersion: EXPORT_FORMAT, state: { ...emptyState(), plans: [{ id: 'x', request: {} }] } }),
    'a duplicate plan id': () =>
      fromImport({
        formatVersion: EXPORT_FORMAT,
        state: {
          ...emptyState(),
          plans: [
            { id: 'dup', request: {}, program: {} },
            { id: 'dup', request: {}, program: {} }
          ]
        }
      }),
    'an unknown exerciseMax source': () =>
      fromImport({
        formatVersion: EXPORT_FORMAT,
        state: {
          ...emptyState(),
          exerciseMax: [{ id: 'm', exerciseId: 'back-squat', e1rm: 100, source: 'vibes', effectiveDate: '2026-01-01' }]
        }
      })
  };

  for (const [what, run] of Object.entries(rejects)) {
    test(`refuses ${what}`, () => {
      assert.throws(run, StateError, `${what} was accepted`);
    });
  }

  test('a refused import throws before returning anything partial', () => {
    // The caller must not be able to mistake a rejection for an empty state.
    let result = 'untouched';
    try {
      result = fromImportJSON('{"formatVersion":1,"state":{"version":1}}');
    } catch { /* expected */ }
    assert.equal(result, 'untouched');
  });
});

describe('the normalised set record (#26)', () => {
  test('a conforming row validates', () => {
    assert.doesNotThrow(() => validateImportedSet(setRow({ weight: 100, reps: 3 })));
  });

  test('an unresolved row is legal and keeps its source identity', () => {
    // #24: unmatched exercises remain reviewable and are not silently
    // discarded. If this ever throws, the import has no review path.
    const row = setRow({ exerciseId: null, sourceExerciseId: 222, sourceExerciseName: 'Shoulder Curl' });
    assert.doesNotThrow(() => validateImportedSet(row));
  });

  const rejects = {
    'an unknown field': { fitnotesId: 205 },
    'a missing id': { id: '' },
    'a missing source': { source: '' },
    'a timestamp instead of a local date': { date: '2026-08-01T00:00:00.000Z' },
    'a setIndex of zero': { setIndex: 0 },
    'a non-integer setIndex': { setIndex: 1.5 },
    'a weight with no unit': { weight: 100, weightUnit: null },
    'a distance with no unit': { distance: 5, distanceUnit: null },
    'an unknown weight unit': { weight: 100, weightUnit: 'stone' },
    'an unknown distance unit': { distance: 5, distanceUnit: 'furlong' },
    'a string weight': { weight: '100' },
    'NaN reps': { reps: NaN },
    'numeric notes': { notes: 42 },
    'an unresolved row with no source identity': {
      exerciseId: null, sourceExerciseId: null, sourceExerciseName: null
    }
  };

  for (const [what, over] of Object.entries(rejects)) {
    test(`refuses ${what}`, () => {
      assert.throws(() => validateImportedSet(setRow(over)), StateError, `${what} was accepted`);
    });
  }

  test('validate() checks every row, not just the array', () => {
    // The whole point of #26: `importedSets` was validated as "an array" and
    // nothing more, so any row shape was storable.
    assert.throws(
      () => validate({ ...emptyState(), importedSets: [{ id: 'x' }] }),
      StateError,
      'a malformed row passed whole-state validation'
    );
  });

  test('a malformed row cannot be imported', () => {
    const envelope = {
      formatVersion: EXPORT_FORMAT,
      state: { ...emptyState(), importedSets: [setRow({ weight: 100, weightUnit: null })] }
    };
    assert.throws(() => fromImport(envelope), StateError);
  });
});

describe('generic CSV export (#26)', () => {
  test('header is the documented column order', () => {
    const [header] = toCSV(populated()).split('\n');
    assert.equal(header, CSV_COLUMNS.join(','));
    assert.equal(
      header,
      'id,source,exerciseId,sourceExerciseId,sourceExerciseName,date,setIndex,' +
      'weight,weightUnit,reps,seconds,distance,distanceUnit,rpe,notes',
      'the column contract changed - that is a format change, not a tidy-up'
    );
  });

  test('one row per set, unresolved rows included', () => {
    const state = populated();
    const lines = toCSV(state).trim().split('\n');
    assert.equal(lines.length, state.importedSets.length + 1, 'row count disagrees with the store');
    assert.ok(
      lines.some((l) => l.includes('Shoulder Curl')),
      'the unresolved row was omitted, so the CSV disagrees with the store'
    );
  });

  test('null is an empty field, never 0 and never NULL', () => {
    const csv = toCSV(replaceImportedSets(emptyState(), [setRow({ reps: 5 })], '2026-08-19T00:00:00.000Z'));
    const row = csv.trim().split('\n')[1];
    assert.ok(!/,0,/.test(row), 'a null was written as 0');
    assert.ok(!/NULL/i.test(row), 'a null was written as NULL');
  });

  test('free text with a comma, a quote or a newline cannot shift columns', () => {
    // Notes are typed on a phone. An unquoted comma silently corrupts every
    // later column of that row, which is the kind of defect a spreadsheet hides.
    const nasty = 'went well, "felt light"\nsecond line';
    const csv = toCSV(replaceImportedSets(
      emptyState(), [setRow({ notes: nasty })], '2026-08-19T00:00:00.000Z'
    ));
    assert.ok(csv.includes('"went well, ""felt light""'), 'quoting or escaping is wrong');
    assert.equal(csv.split('\n')[0].split(',').length, CSV_COLUMNS.length, 'header width changed');
  });

  test('output is deterministic and ordered', () => {
    const state = populated();
    assert.equal(toCSV(state), toCSV(state), 'CSV is not stable across two calls');
    const dates = toCSV(state).trim().split('\n').slice(1).map((l) => l.split(',')[5]);
    assert.deepEqual([...dates].sort(), dates, 'rows are not in ascending date order');
  });
});

describe('ADR-031 retention rules', () => {
  test('an import replaces imported history in full, and is idempotent', () => {
    let s = populated();
    assert.equal(s.importedSets.length, 4);

    // The same export again: a no-op, which is #24's no-duplicates criterion
    // satisfied by construction rather than by a dedupe table.
    const same = [...s.importedSets];
    s = replaceImportedSets(s, same, '2026-08-19T10:00:00.000Z');
    assert.equal(s.importedSets.length, 4, 're-import duplicated rows');

    // A newer export with one set edited and one deleted. Under replacement an
    // edit is a new value and a deletion is an absence; no diff logic runs.
    s = replaceImportedSets(s, [
      setRow({ id: 'fn:205:2026-08-01:1', sourceExerciseId: 205, sourceExerciseName: 'Flat Barbell Bench Press',
               exerciseId: 'barbell-bench-press', date: '2026-08-01', setIndex: 1, weight: 105, reps: 3 }),
      setRow({ id: 'fn:213:2026-08-08:1', sourceExerciseId: 213, sourceExerciseName: 'Barbell Squat',
               exerciseId: 'back-squat', date: '2026-08-08', setIndex: 1, weight: 140, reps: 1 })
    ], '2026-08-20T09:00:00.000Z');

    assert.equal(s.importedSets.length, 2, 'the deleted set survived');
    assert.equal(s.importedSets.find((r) => r.id === 'fn:205:2026-08-01:1').weight, 105,
      'the edit did not land');
    assert.equal(s.meta.lastImportAt, '2026-08-20T09:00:00.000Z');
  });

  test('replacement does not touch authored planner state', () => {
    // The whole reason replacement is safe: it discards only data FitNotes
    // still holds. Anything the app authored has no other copy.
    let s = populated();
    const plansBefore = serialise(s.plans);
    s = replaceImportedSets(s, [], '2026-08-21T09:00:00.000Z');
    assert.equal(serialise(s.plans), plansBefore, 'an import mutated authored plans');
    assert.equal(s.importedSets.length, 0);
  });

  test('exerciseMax is append-only and supersedes rather than overwrites', () => {
    const s = populated();
    const bench = s.exerciseMax.filter((r) => r.exerciseId === 'barbell-bench-press');
    assert.equal(bench.length, 2, 'an append overwrote instead of appending');

    const live = bench.filter((r) => r.supersededAt == null);
    assert.equal(live.length, 1, 'more than one live row for one exercise');
    assert.equal(live[0].id, 'max-2');
    assert.equal(bench.find((r) => r.id === 'max-1').supersededAt, '2026-08-08');
  });

  test('a replacement import does not delete derived maxes', () => {
    let s = populated();
    const maxesBefore = serialise(s.exerciseMax);
    s = replaceImportedSets(s, [], '2026-08-21T09:00:00.000Z');
    assert.equal(serialise(s.exerciseMax), maxesBefore, 'an import destroyed append-only history');
  });

  test('currentMax reads the latest live row', () => {
    const s = populated();
    assert.equal(currentMax(s, 'barbell-bench-press').id, 'max-2');
    assert.equal(currentMax(s, 'back-squat').source, 'tested');
    assert.equal(currentMax(s, 'never-logged'), null);
  });

  test('an unknown max source throws rather than being stored', () => {
    assert.throws(
      () => appendExerciseMax(emptyState(), {
        id: 'x', exerciseId: 'back-squat', e1rm: 100, source: 'guessed', effectiveDate: '2026-01-01'
      }),
      StateError
    );
  });

  test('there is no store for a raw FitNotes database', () => {
    // ADR-031 ruling 3. Asserted so that adding one is a deliberate act that
    // breaks a test, rather than a quiet convenience someone adds at import.
    // `equipmentProfiles` (#8) is user-authored state: the athlete built it, it
    // is the only copy, and ADR-011 is why it lives here rather than in
    // localStorage. That is categorically different from a raw FitNotes
    // database, which is someone else's file, reproducible from source, and
    // excluded by ruling 3. The list stays exact so the next addition also has
    // to justify itself here.
    assert.deepEqual(
      Object.keys(emptyState()).sort(),
      // #50 adds two date-keyed text slices. `importedDayNotes` is FitNotes'
      // data, replaced wholesale per import like importedSets; `sessionNotes` is
      // authored by the app and durable like plans. Neither is a raw FitNotes
      // database, which is what ruling 3 excludes.
      ['equipmentProfiles', 'exerciseMax', 'importedDayNotes', 'importedSets',
       'meta', 'plans', 'sessionNotes', 'version']
    );
  });

  test('meta.lastImportAt exists so the UI can show plan staleness', () => {
    // ADR-031 carries this as an M7 UI requirement: a forgotten import
    // otherwise stales the plan with nothing on screen saying so.
    assert.equal(emptyState().meta.lastImportAt, null);
    assert.equal(populated().meta.lastImportAt, '2026-08-19T09:00:00.000Z');
  });
});

describe('canonical form', () => {
  test('key order does not change the bytes', () => {
    const a = { version: STATE_VERSION, meta: { lastImportAt: null }, plans: [], importedSets: [], exerciseMax: [] };
    const b = { exerciseMax: [], importedSets: [], plans: [], meta: { lastImportAt: null }, version: STATE_VERSION };
    assert.equal(serialise(a), serialise(b));
  });

  test('array order is preserved, because setGroup order is the prescription', () => {
    const ordered = { a: [3, 1, 2] };
    assert.deepEqual(canonical(ordered).a, [3, 1, 2]);
  });

  test('nulls survive; the engine emits them deliberately', () => {
    // `rounds: null` on an AMRAP means "not prescribed" (#42). Collapsing it to
    // undefined would drop the field on serialise and change the meaning.
    const s = { version: STATE_VERSION, meta: { lastImportAt: null }, plans: [], importedSets: [], exerciseMax: [] };
    assert.match(serialise(s), /"lastImportAt":null/);
  });

  test('plans are stored id-sorted so insertion order cannot change the bytes', () => {
    const one = putPlan(putPlan(emptyState(), planFrom('b')), planFrom('a'));
    const two = putPlan(putPlan(emptyState(), planFrom('a')), planFrom('b'));
    assert.equal(serialise(one), serialise(two));
  });
});

describe('plan storage', () => {
  test('putPlan replaces by id rather than accumulating', () => {
    let s = putPlan(emptyState(), planFrom('p'));
    s = putPlan(s, planFrom('p', { styleId: 'hiit' }));
    assert.equal(s.plans.length, 1);
    assert.equal(s.plans[0].request.styleId, 'hiit');
  });

  test('removePlan removes only its target', () => {
    let s = putPlan(putPlan(emptyState(), planFrom('keep')), planFrom('drop'));
    s = removePlan(s, 'drop');
    assert.deepEqual(s.plans.map((p) => p.id), ['keep']);
  });

  test('a plan without a program is refused', () => {
    assert.throws(() => putPlan(emptyState(), { id: 'x', request: {} }), StateError);
    assert.throws(() => putPlan(emptyState(), { id: '', request: {}, program: {} }), StateError);
  });

  test('the stored request carries athlete, which SPEC.md omits', () => {
    const s = putPlan(emptyState(), planFrom('p'));
    const after = fromImportJSON(toExportJSON(s));
    assert.deepEqual(after.plans[0].request.athlete, request.athlete);
  });

  test('the stored program carries splitId and domain, which SPEC.md omits', () => {
    const s = putPlan(emptyState(), planFrom('p'));
    const after = fromImportJSON(toExportJSON(s));
    assert.equal(typeof after.plans[0].program.splitId, 'string');
    assert.equal(typeof after.plans[0].program.domain, 'string');
  });
});

describe('validate', () => {
  test('accepts an empty state', () => {
    assert.equal(validate(emptyState()).version, STATE_VERSION);
  });

  test('accepts a populated state', () => {
    assert.doesNotThrow(() => validate(populated()));
  });
});

describe('authored equipment profiles (#8)', () => {
  const SHIPPED = ['home-garage', 'commercial-gym'];
  const mine = () => ({
    id: 'my-gym', name: 'My Gym',
    available: ['barbell', 'rack', 'bench'], editable: true, userDefined: true
  });

  test('a profile stores, validates and survives export -> import', () => {
    const s = putProfile(emptyState(), mine(), SHIPPED);
    assert.equal(s.equipmentProfiles.length, 1);
    const round = fromImportJSON(toExportJSON(s));
    assert.deepEqual(round.equipmentProfiles, s.equipmentProfiles,
      'ADR-011: an authored profile must survive the round-trip gate');
  });

  test('`equipment` is refused where `available` is required', () => {
    // THE ADR-026 defect, made unrepresentable. coverage.js ownedOf() reads
    // `available ?? equipment` as a compatibility shim; a profile written under
    // the wrong name would resolve to an empty owned-set at runtime while
    // looking fine in storage.
    assert.throws(() => validateProfile({
      id: 'x', name: 'X', equipment: ['barbell'], userDefined: true
    }), /unknown field "equipment"/);
  });

  test('an authored profile may not shadow a shipped id', () => {
    // Two profiles answering to one id makes which you get depend on merge order.
    assert.throws(() => putProfile(emptyState(), { ...mine(), id: 'home-garage' }, SHIPPED),
      /shipped profile id/);
  });

  test('userDefined is mandatory, because check 11 keys ADR-014 on it', () => {
    assert.throws(() => validateProfile({ id: 'x', name: 'X', available: [] }),
      /userDefined must be true/);
  });

  test('a duplicate token is refused rather than silently deduped', () => {
    assert.throws(() => validateProfile({ ...mine(), available: ['barbell', 'barbell'] }),
      /duplicate token/);
  });

  test('an empty profile is legal — owning nothing is a true statement', () => {
    const s = putProfile(emptyState(), { ...mine(), available: [] }, SHIPPED);
    assert.deepEqual(s.equipmentProfiles[0].available, []);
  });

  test('putProfile replaces by id rather than accumulating', () => {
    let s = putProfile(emptyState(), mine(), SHIPPED);
    s = putProfile(s, { ...mine(), available: ['dumbbell'] }, SHIPPED);
    assert.equal(s.equipmentProfiles.length, 1);
    assert.deepEqual(s.equipmentProfiles[0].available, ['dumbbell']);
  });

  test('an unknown token is stored, not pruned', () => {
    // The `rings` lesson: home-garage owns a token no exercise uses, and the
    // catalog may catch up later. Dropping equipment the athlete owns because
    // the catalog lags is silent data loss.
    const s = putProfile(emptyState(), { ...mine(), available: ['barbell', 'ghd'] }, SHIPPED);
    assert.ok(s.equipmentProfiles[0].available.includes('ghd'));
  });

  test('removing is a no-op when absent', () => {
    assert.equal(removeProfile(emptyState(), 'nope').equipmentProfiles.length, 0);
  });
});

describe('every store round-trips through save/load (#8)', () => {
  // save() carried a hardcoded store list, so `equipmentProfiles` was created
  // and read but never written: a saved profile survived until reload and then
  // vanished. db.js needs a real IndexedDB and cannot run here, so this asserts
  // the invariant that failed -- every key in state must be covered by STORES,
  // which is what save() now iterates.
  test('STORES covers every key emptyState() produces except `version`', () => {
    const keys = Object.keys(emptyState()).filter((k) => k !== 'version').sort();
    assert.deepEqual(keys, [...STORES].sort(),
      'a state key with no store is silently never persisted');
  });
});

describe('day-level notes live in two slices (#50)', () => {
  const withNotes = () => replaceImportedDayNotes(emptyState(), [
    { date: '2024-03-02', note: 'Go up 10lbs on row / Keep shoulder press at 75lbs' }
  ]);

  test('an import REPLACES imported notes but never authored ones', () => {
    // The whole reason these are two slices. Imported notes are FitNotes' data
    // and replaceable (ADR-031 ruling 2); a session instruction the app wrote is
    // the only copy. One store would mean every import destroyed the athlete's
    // own writing.
    let s = putSessionNote(withNotes(), '2026-09-07', 'Deload week — leave the top set');
    s = replaceImportedDayNotes(s, [{ date: '2025-01-01', note: 'different import' }]);

    assert.equal(s.importedDayNotes.length, 1);
    assert.equal(s.importedDayNotes[0].date, '2025-01-01', 'imported notes are replaced wholesale');
    assert.equal(notesForDate(s, '2026-09-07').authored, 'Deload week — leave the top set',
      'an import must not touch an authored note');
  });

  test('both notes can exist on one date and stay distinguishable', () => {
    const s = putSessionNote(withNotes(), '2024-03-02', 'my own note');
    const both = notesForDate(s, '2024-03-02');
    assert.match(both.imported, /Go up 10lbs/);
    assert.equal(both.authored, 'my own note');
  });

  test('an empty note clears rather than storing blank text', () => {
    let s = putSessionNote(emptyState(), '2026-09-07', 'temporary');
    s = putSessionNote(s, '2026-09-07', '   ');
    assert.equal(s.sessionNotes.length, 0);
    assert.equal(notesForDate(s, '2026-09-07').authored, null);
  });

  test('a malformed date is refused rather than stored unreachably', () => {
    // A note on a date no set can share would display against nothing.
    assert.throws(() => putSessionNote(emptyState(), '02/03/2024', 'x'), /YYYY-MM-DD/);
    assert.throws(() => replaceImportedDayNotes(emptyState(), [{ date: 'nope', note: 'x' }]),
      /YYYY-MM-DD/);
  });

  test('notes survive export -> import (ADR-011)', () => {
    const s = putSessionNote(withNotes(), '2026-09-07', 'mine');
    const round = fromImportJSON(toExportJSON(s));
    assert.deepEqual(round.importedDayNotes, s.importedDayNotes);
    assert.deepEqual(round.sessionNotes, s.sessionNotes);
  });

  test('nothing parses the text (ADR-002)', () => {
    // A note is displayed, never interpreted. Stored verbatim including the
    // characters a parser would be tempted by.
    const raw = '3x5 @ 80% — if RPE > 8, stop. #deload';
    assert.equal(notesForDate(putSessionNote(emptyState(), '2026-09-07', raw), '2026-09-07').authored, raw);
  });
});
