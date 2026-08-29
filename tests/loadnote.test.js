/**
 * #78 — an authored loadNote survives the anchorable gate.
 *
 * Written against the REAL signature, read from js/storage/fitnotes-export.js:
 *
 *   toFitNotesCSV(program, startDate, state, { manifest, catalog, currentMax, dates })
 *
 * `manifest` and `catalog` are only read by buildNameLookup/buildCategoryLookup,
 * and `currentMax` is INJECTED, so this constructs all three rather than
 * importing state.js. That keeps the test about the note, not about storage.
 *
 * The worked example is HIIT-100's triceps pressdown: cable, fatigueCost 1, so
 * it fails `anchorable` on both clauses. Before #78 it exported as
 * `10x10 . rest 40s` with no load information for a program whose source says
 * "use 50% of your 10RM".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { toFitNotesCSV } from '../js/storage/fitnotes-export.js';

const MANIFEST = { exercises: [] };

const PRESSDOWN = {
  id: 'triceps-pressdown', name: 'Triceps Pressdown', pattern: 'isolation',
  equipment: ['cable'], primaryMuscles: ['triceps'], fatigueCost: 1
};
const BENCH = {
  id: 'barbell-bench-press', name: 'Barbell Bench Press', pattern: 'push_h',
  equipment: ['barbell', 'bench'], primaryMuscles: ['chest'], fatigueCost: 4
};
const CATALOG = [PRESSDOWN, BENCH];

const noMax = () => null;

/** A one-session program carrying whatever prescription the case needs. */
const programOf = (fields, exercise = PRESSDOWN) => ({
  schemaVersion: 1,
  styleId: 'preset',
  splitId: null,
  domain: 'load',
  seed: 1,
  schedule: ['mon'],
  weeks: [{
    week: 1,
    sessions: [{
      domain: 'load',
      label: 'Day 1',
      blocks: [{
        blockType: 'straight',
        rounds: null,
        timeCapSeconds: null,
        setGroups: [{
          exerciseId: exercise.id,
          name: exercise.name,
          pattern: exercise.pattern,
          equipment: exercise.equipment,
          primaryMuscles: exercise.primaryMuscles,
          fatigueCost: exercise.fatigueCost,
          ...fields
        }]
      }],
      omitted: []
    }]
  }]
});

const noteOf = (out) => {
  const [, row] = out.csv.trim().split('\n');
  // Notes is column index 9. Quoted only when it holds a comma or quote, and
  // none of these do, so a split is safe here.
  return row.split(',')[9];
};

const run = (program) => toFitNotesCSV(program, '2026-09-07', { exerciseMax: [] }, {
  manifest: MANIFEST, catalog: CATALOG, currentMax: noMax
});

describe('an authored loadNote reaches the export (#78)', () => {
  test('a cable row with loadNote prints it, though anchorable is false', () => {
    const out = run(programOf({
      role: 'main', sets: 10, reps: 10, restSeconds: 40,
      loadNote: '50% of 10RM'
    }));
    const note = noteOf(out);
    assert.match(note, /10x10/, 'the set scheme must survive');
    assert.match(note, /50% of 10RM/, 'the authored load must be printed');
    assert.match(note, /rest 40s/, 'rest is independent and must still print');
  });

  test('without loadNote the same row prints no load at all', () => {
    // The defect, pinned. If this ever starts printing a load, the anchorable
    // gate has changed and #78's premise needs re-reading.
    const out = run(programOf({
      role: 'main', sets: 10, reps: 10, restSeconds: 40, intensityOf1RM: 0.35
    }));
    const note = noteOf(out);
    assert.match(note, /10x10/);
    assert.doesNotMatch(note, /%/, 'a cable row must not be given a 1RM percentage');
  });

  test('loadNote does not put an authored row in the unpriced list', () => {
    const out = run(programOf({
      role: 'main', sets: 5, reps: 5, intensityOf1RM: 0.8, loadNote: '225 lb'
    }, BENCH));
    assert.deepEqual(out.unpriced, [],
      'a row that states its own load does not need a max');
  });

  test('a barbell row with no loadNote still reports as unpriced', () => {
    const out = run(programOf({
      role: 'main', sets: 5, reps: 5, intensityOf1RM: 0.8
    }, BENCH));
    assert.deepEqual(out.unpriced, ['barbell-bench-press'],
      'the ADR-023 behaviour must be unchanged where no load is authored');
  });

  test('generated shape is untouched: no loadNote means the old note exactly', () => {
    const out = run(programOf({
      role: 'accessory', sets: 3, reps: 12, rir: 2, restSeconds: 60
    }));
    assert.equal(noteOf(out), '3x12 \u00b7 RIR 2 \u00b7 rest 60s');
  });
});
