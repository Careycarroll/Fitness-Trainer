import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { defs } from '../js/engine/defs.js';
import {
  listBenchmarks,
  getBenchmark,
  expandBenchmark,
  BENCHMARKS
} from '../js/engine/benchmarks.js';
import { renderSession } from '../js/ui/app.js';
import { toFitNotesCSV } from '../js/storage/fitnotes-export.js';
import { emptyState, currentMax } from '../js/storage/state.js';
import mappingFile from '../js/data/fitnotes-mapping.json' with { type: 'json' };

describe('CrossFit benchmark presets (ADR-032)', () => {
  test('listBenchmarks enumerates all shipped benchmarks', () => {
    const list = listBenchmarks();
    assert.ok(list.length >= 22, `expected >= 22 benchmarks, got ${list.length}`);
    const ids = list.map((b) => b.id);
    const expected = [
      'angie', 'barbara', 'chelsea', 'cindy', 'diane', 'elizabeth', 'fran',
      'grace', 'helen', 'isabel', 'jackie', 'karen', 'kelly', 'linda',
      'mary', 'nancy', 'annie', 'eva', 'lynne', 'nicole', 'amanda', 'gwen', 'murph'
    ];
    for (const id of expected) {
      assert.ok(ids.includes(id), `missing benchmark: ${id}`);
    }
  });

  test('getBenchmark resolves existing benchmark and returns null for unknown', () => {
    const cindy = getBenchmark('cindy');
    assert.ok(cindy);
    assert.equal(cindy.name, 'Cindy');
    assert.equal(cindy.format, 'amrap');

    const missing = getBenchmark('nonexistent-wod');
    assert.equal(missing, null);
  });

  test('expandBenchmark creates a valid Program conforming to SPEC.md', () => {
    const program = expandBenchmark('cindy', defs, { seed: 20261123, schedule: ['mon'] });
    assert.equal(program.schemaVersion, 1);
    assert.equal(program.styleId, 'crossfit');
    assert.equal(program.domain, 'time');
    assert.equal(program.weeks.length, 1);

    const session = program.weeks[0].sessions[0];
    assert.ok(session);
    assert.equal(session.domain, 'time');
    assert.equal(session.blocks.length, 1);

    const block = session.blocks[0];
    assert.equal(block.blockType, 'amrap');
    assert.equal(block.timeCapSeconds, 1200);
    assert.equal(block.setGroups.length, 3);

    const [pullUp, pushUp, squat] = block.setGroups;
    assert.equal(pullUp.exerciseId, 'pull-up');
    assert.equal(pullUp.reps, 5);
    assert.equal(pullUp.loadNote, '5 reps');

    assert.equal(pushUp.exerciseId, 'push-up');
    assert.equal(pushUp.reps, 10);
    assert.equal(pushUp.loadNote, '10 reps');

    assert.equal(squat.exerciseId, 'bodyweight-squat');
    assert.equal(squat.reps, 15);
    assert.equal(squat.loadNote, '15 reps');
  });

  test('every shipped benchmark expands and every exerciseId exists in the catalog', () => {
    for (const b of BENCHMARKS) {
      const prog = expandBenchmark(b, defs);
      assert.ok(prog.weeks[0].sessions[0].blocks[0].setGroups.length > 0);
    }
  });

  test('expanding unknown benchmark or movement throws loudly', () => {
    assert.throws(
      () => expandBenchmark('unknown-wod', defs),
      /Benchmark preset not found/
    );

    const badBenchmark = {
      id: 'bad',
      name: 'Bad',
      format: 'amrap',
      movements: [{ exerciseId: 'phantom-exercise-id-xyz', reps: 10 }]
    };
    assert.throws(
      () => expandBenchmark(badBenchmark, defs),
      /references unknown exerciseId/
    );
  });

  test('every benchmark renders cleanly via UI renderSession without undefined or NaN', () => {
    const crossfitStyle = defs.styles.find((s) => s.id === 'crossfit');
    assert.ok(crossfitStyle);

    for (const b of BENCHMARKS) {
      const program = expandBenchmark(b, defs);
      const session = program.weeks[0].sessions[0];
      const html = renderSession(session, 0, 0, crossfitStyle);
      assert.ok(html.length > 0);
      assert.ok(!html.includes('undefined'), `${b.id} leaked undefined`);
      assert.ok(!html.includes('NaN'), `${b.id} leaked NaN`);
    }
  });

  test('benchmarks export cleanly to FitNotes CSV with load notes intact', () => {
    const state = emptyState();
    const program = expandBenchmark('cindy', defs, { schedule: ['mon'] });
    const { csv, rows } = toFitNotesCSV(program, '2026-11-23', state, {
      manifest: mappingFile,
      catalog: defs.exercises,
      currentMax
    });

    assert.equal(rows, 3);
    assert.ok(csv.includes('Pull Up'));
    assert.ok(csv.includes('Push Up'));
    assert.ok(csv.includes('Bodyweight Squat'));
    assert.ok(csv.includes('1x5 · 5 reps'));
    assert.ok(csv.includes('1x10 · 10 reps'));
    assert.ok(csv.includes('1x15 · 15 reps'));
  });

  test('expandBenchmark sets program name and description for UI header rendering', () => {
    const program = expandBenchmark('fran', defs);
    assert.equal(program.name, 'Fran');
    assert.equal(typeof program.description, 'string');
    assert.ok(program.description.includes('Thrusters'));
  });
});
