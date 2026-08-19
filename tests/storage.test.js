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
  validate
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

  s = replaceImportedSets(s, [
    { id: 'fn:1', fitnotesId: 205, exerciseId: 'barbell-bench-press', date: '2026-08-01', weight: 100, reps: 3, unit: 'kg' },
    { id: 'fn:2', fitnotesId: 205, exerciseId: 'barbell-bench-press', date: '2026-08-08', weight: 102.5, reps: 2, unit: 'kg' },
    { id: 'fn:3', fitnotesId: 213, exerciseId: 'back-squat', date: '2026-08-08', weight: 140, reps: 1, unit: 'kg' }
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

describe('ADR-031 retention rules', () => {
  test('an import replaces imported history in full, and is idempotent', () => {
    let s = populated();
    assert.equal(s.importedSets.length, 3);

    // The same export again: a no-op, which is #24's no-duplicates criterion
    // satisfied by construction rather than by a dedupe table.
    const same = [...s.importedSets];
    s = replaceImportedSets(s, same, '2026-08-19T10:00:00.000Z');
    assert.equal(s.importedSets.length, 3, 're-import duplicated rows');

    // A newer export with one set edited and one deleted. Under replacement an
    // edit is a new value and a deletion is an absence; no diff logic runs.
    s = replaceImportedSets(s, [
      { id: 'fn:1', fitnotesId: 205, exerciseId: 'barbell-bench-press', date: '2026-08-01', weight: 105, reps: 3, unit: 'kg' },
      { id: 'fn:3', fitnotesId: 213, exerciseId: 'back-squat', date: '2026-08-08', weight: 140, reps: 1, unit: 'kg' }
    ], '2026-08-20T09:00:00.000Z');

    assert.equal(s.importedSets.length, 2, 'the deleted set survived');
    assert.equal(s.importedSets.find((r) => r.id === 'fn:1').weight, 105, 'the edit did not land');
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
    assert.deepEqual(
      Object.keys(emptyState()).sort(),
      ['exerciseMax', 'importedSets', 'meta', 'plans', 'version']
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
