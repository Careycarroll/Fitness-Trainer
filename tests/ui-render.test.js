/**
 * #56 — the UI actually renders, across every request the sidebar can express.
 *
 * ui-contract.test.js scans app.js textually for setGroup field names. That
 * catches a rename; it cannot catch a render that throws on a value the engine
 * legitimately emits. Both UI defects found in the #51 session were the latter:
 *
 *   - renderOmitted() called patternLabel(null).replace(), refusing the WHOLE
 *     plan for every bodybuilding request at 5, 6 or 7 sessions. `pattern` is
 *     null by design on a count-not-reachable omission.
 *   - requestedSessions / resolvedSessions / sessionMismatch are program-level
 *     reads with no contract test at all.
 *
 * 218 tests passed through both, because nothing rendered a session. This does.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generate, CoverageError, RequestError } from '../js/engine/index.js';
import { planDates, toFitNotesCSV } from '../js/storage/fitnotes-export.js';
import { emptyState, currentMax } from '../js/storage/state.js';
import mappingFile from '../js/data/fitnotes-mapping.json' with { type: 'json' };
import { defs } from '../js/engine/defs.js';
import {
  renderSession, renderOmitted, sessionNoticeHtml, emptySession, patternLabel, omitReason,
  buildReviewQueue, renderDatePreview
} from '../js/ui/app.js';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Every request the sidebar can express: style x profile x 1-7 sessions. */
function* everyRequest() {
  for (const style of defs.styles) {
    for (const profile of defs.equipment) {
      for (let n = 1; n <= 7; n += 1) {
        yield {
          schemaVersion: 1,
          styleId: style.id,
          daysPerWeek: n,
          availableDays: WEEKDAYS,
          blockWeeks: 1,
          equipmentProfile: profile.id,
          sessionMinutes: 70,
          seed: 1218782818,
          athlete: { skillLevel: 2 },
          history: []
        };
      }
    }
  }
}

describe('the UI renders every program the engine can produce (#56)', () => {
  test('no session render throws, and none leaks undefined or NaN', () => {
    let rendered = 0;
    const failures = [];

    for (const request of everyRequest()) {
      const where = `${request.styleId}/${request.equipmentProfile}/${request.daysPerWeek}`;
      let program;
      try {
        program = generate(request, defs);
      } catch (err) {
        // A refusal is a different contract: coverage and request errors have
        // their own render path and are not this test's business.
        if (err instanceof CoverageError || err instanceof RequestError) continue;
        failures.push(`${where}: engine threw ${err.constructor.name}: ${err.message}`);
        continue;
      }

      const style = defs.styles.find((s) => s.id === program.styleId);

      // Program-level reads. The fields #51 added, asserted where the UI uses them.
      try {
        sessionNoticeHtml(program);
      } catch (err) {
        failures.push(`${where}: sessionNoticeHtml threw ${err.message}`);
      }

      program.weeks.forEach((week, w) => {
        week.sessions.forEach((session, s) => {
          let html;
          try {
            html = renderSession(session, w, s, style);
          } catch (err) {
            failures.push(`${where} day ${s + 1}: renderSession threw ${err.constructor.name}: ${err.message}`);
            return;
          }
          rendered += 1;

          // A field read under the wrong name resolves to undefined and lands in
          // the markup rather than throwing. That is how the warmupRequired bug
          // rendered a badge on nothing while every test passed.
          if (html.includes('undefined')) failures.push(`${where} day ${s + 1}: "undefined" in markup`);
          if (html.includes('NaN')) failures.push(`${where} day ${s + 1}: "NaN" in markup`);
          // An omission rendered with a blank label -- the null-pattern bug's
          // silent cousin, had it degraded instead of throwing.
          if (html.includes('<strong></strong>')) failures.push(`${where} day ${s + 1}: empty label in markup`);
        });
      });
    }

    assert.ok(rendered > 100, `only ${rendered} sessions rendered — the sweep is not covering the app`);
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
  });

  test('a null-pattern omission renders as a session-level fact', () => {
    // The exact shape that crashed. Asserted directly so a refactor of
    // renderOmitted cannot quietly reintroduce patternLabel(null).
    const omission = { pattern: null, reason: 'count-not-reachable', requested: 9, placed: 8 };
    const html = renderOmitted([omission]);
    assert.match(html, /This session/, 'a pattern-less omission must not be labelled as a pattern');
    assert.match(html, /8 of 9/, 'the numbers the engine knows must reach the athlete (#43)');
    assert.doesNotMatch(html, /<strong><\/strong>/);
  });

  test('patternLabel tolerates a null pattern', () => {
    assert.equal(patternLabel(null), '');
    assert.equal(patternLabel('push_h'), 'Horizontal push');
    assert.equal(patternLabel('hinge'), 'Hinge');
  });

  test('every reason code the engine emits has prose', () => {
    // A reason with no case falls through to the default and shows the athlete a
    // raw enum. Collected from real output rather than from the switch, so a new
    // engine reason fails here instead of shipping untranslated.
    const seen = new Set();
    for (const request of everyRequest()) {
      let program;
      try { program = generate(request, defs); } catch { continue; }
      for (const week of program.weeks) {
        for (const session of week.sessions) {
          for (const o of session.omitted ?? []) seen.add(o.reason);
        }
      }
    }
    assert.ok(seen.size > 0, 'no omissions found — this test would pass vacuously');
    for (const reason of seen) {
      const prose = omitReason({ reason, placed: 1, requested: 2, target: 2 });
      assert.ok(prose && !prose.includes(reason),
        `reason "${reason}" renders as its own code — omitReason has no case for it`);
    }
  });

  test('an empty session says so rather than rendering blank', () => {
    const html = emptySession({ blocks: [], omitted: [{ pattern: 'hinge', reason: 'equipment' }] });
    assert.match(html, /Nothing could be prescribed/);
    assert.match(html, /equipment profile/);
  });
});

describe('the unmapped-import review queue (#57)', () => {
  // Extracted from inside `if (csvBtn)` in paintStatus, where a markup change
  // dropping #export-csv would have silently stopped the queue rebuilding on
  // reload. Untestable in that position, which is why it went unnoticed.
  const set = (o) => ({ exerciseId: null, sourceExerciseId: null, sourceExerciseName: null, ...o });

  test('mapped rows are excluded; unmapped rows group by source', () => {
    const q = buildReviewQueue([
      set({ sourceExerciseId: 181, sourceExerciseName: 'Lying Triceps Extension' }),
      set({ sourceExerciseId: 181, sourceExerciseName: 'Lying Triceps Extension' }),
      set({ sourceExerciseId: 202, sourceExerciseName: 'EZ-Bar Skullcrusher' }),
      set({ exerciseId: 'barbell-bench-press', sourceExerciseId: 1, sourceExerciseName: 'Bench' })
    ]);
    assert.equal(q.length, 2, 'a resolved row is not awaiting review');
    assert.deepEqual(q.map((r) => r.sets), [2, 1], 'ordered by set count, descending');
    assert.equal(q[0].fitnotesId, 181);
  });

  test('a row with no source id groups on its name', () => {
    const q = buildReviewQueue([
      set({ sourceExerciseName: 'Mystery Lift' }),
      set({ sourceExerciseName: 'Mystery Lift' })
    ]);
    assert.equal(q.length, 1);
    assert.equal(q[0].sets, 2);
  });

  test('no imported sets yields an empty queue rather than throwing', () => {
    assert.deepEqual(buildReviewQueue([]), []);
    assert.deepEqual(buildReviewQueue(), []);
  });
});

describe('destination dates are previewed before export (#54)', () => {
  // Local fixture. `base` lives in engine.test.js and is not in scope here — the
  // first version of this block referenced it and every test using plan() threw
  // ReferenceError rather than asserting anything.
  const plan = (opts = {}) => generate({
    schemaVersion: 1,
    styleId: 'bodybuilding',
    daysPerWeek: 4,
    availableDays: ['mon', 'wed', 'fri', 'sat'],
    blockWeeks: 2,
    equipmentProfile: 'home-garage',
    sessionMinutes: 70,
    seed: 20260813,
    athlete: { skillLevel: 2 },
    history: [],
    ...opts
  }, defs);

  test('every session gets a date, in order, with its label', () => {
    const rows = planDates(plan(), '2026-09-07', []);
    assert.equal(rows.length, 8, 'a 2-week 4-day block has 8 sessions');
    assert.deepEqual(rows.map((r) => r.date), [...rows.map((r) => r.date)].sort(),
      'dates must be chronological');
    assert.equal(rows[0].date, '2026-09-07');
    assert.ok(rows.every((r) => r.label), 'every row names its session');
  });

  test('a clash with imported history is marked on the row', () => {
    const rows = planDates(plan(), '2026-09-07', [{ date: '2026-09-11' }]);
    const hit = rows.filter((r) => r.collides);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].date, '2026-09-11');
  });

  test('the gap is read off the session, never recomputed', () => {
    // compressedAccessoryMultiplier is applied during generation (loadDomain),
    // so the gap shown must be the one the sets were built under.
    const program = plan();
    const rows = planDates(program, '2026-09-07', []);
    const sessions = program.weeks.flatMap((w) => w.sessions);
    rows.forEach((r, i) => assert.equal(r.gap, sessions[i].gap));
  });

  test('the preview renders, marks clashes, and never leaks undefined', () => {
    const html = renderDatePreview(planDates(plan(), '2026-09-07', [{ date: '2026-09-11' }]));
    assert.match(html, /2026-09-07/);
    assert.match(html, /class="collides"/);
    assert.match(html, /1 date already holds/);
    assert.doesNotMatch(html, /undefined|NaN/);
  });

  test('no rows renders nothing rather than an empty shell', () => {
    assert.equal(renderDatePreview([]), '');
    assert.equal(renderDatePreview(), '');
  });

  test('a plan with no schedule refuses rather than inventing dates', () => {
    assert.throws(() => planDates({ weeks: [{ sessions: [{ label: 'A' }] }] }, '2026-09-07', []),
      /schedule is required/);
  });
});

describe('a moved session keeps its work and states the change (#54)', () => {
  const plan = () => generate({
    schemaVersion: 1, styleId: 'bodybuilding', daysPerWeek: 4,
    availableDays: ['mon', 'wed', 'fri', 'sat'], blockWeeks: 1,
    equipmentProfile: 'home-garage', sessionMinutes: 70, seed: 20260813,
    athlete: { skillLevel: 2 }, history: []
  }, defs);

  test('moving one session does not shift the block', () => {
    const rows = planDates(plan(), '2026-09-07', [], { 1: '2026-09-08' });
    assert.equal(rows[1].date, '2026-09-08');
    assert.ok(rows[1].moved);
    assert.equal(rows[0].date, '2026-09-07', 'earlier sessions must not move');
    assert.equal(rows[2].date, '2026-09-11', 'later sessions must not move');
    assert.ok(!rows[2].moved);
  });

  test('a gap the session was not written for is reported, not absorbed', () => {
    // compressedAccessoryMultiplier is applied during generation, so the sets
    // cannot be re-derived from a new date without regenerating -- which would
    // change the exercises under an athlete who just reviewed them.
    const rows = planDates(plan(), '2026-09-07', [], { 1: '2026-09-08' });
    assert.equal(rows[1].gap, 'recovered', 'the gap the volume was chosen under');
    assert.equal(rows[1].actualGap, 'compressed', 'the gap this date gives');
    assert.ok(rows[1].gapChanged);
    assert.equal(rows[1].spacing, 1);
  });

  test('an unmoved session reports no change', () => {
    for (const r of planDates(plan(), '2026-09-07', [])) {
      assert.ok(!r.moved);
      assert.ok(!r.gapChanged, `${r.label} diverges as generated — the engine disagrees with itself`);
      assert.ok(!r.outOfOrder);
    }
  });

  test('the first session has no measurable gap and does not pretend to', () => {
    // Its spacing depends on whatever was trained before the block began, which
    // the app does not know.
    const first = planDates(plan(), '2026-09-07', [])[0];
    assert.equal(first.spacing, null);
    assert.equal(first.actualGap, null);
    assert.equal(first.gapChanged, false);
  });

  test('a date on or before the previous session is flagged, never sorted', () => {
    const rows = planDates(plan(), '2026-09-07', [], { 1: '2026-09-07' });
    assert.ok(rows[1].outOfOrder, 'same day as the previous session');
    assert.deepEqual(rows.map((r) => r.label), plan().weeks.flatMap((w) => w.sessions).map((x) => x.label),
      'session order is training order and must survive a bad move');
    assert.ok(planDates(plan(), '2026-09-07', [], { 2: '2026-09-08' })[2].outOfOrder,
      'a date before the previous session is out of order too');
  });

  test('moving onto imported history marks the collision at the new date', () => {
    const rows = planDates(plan(), '2026-09-07', [{ date: '2026-09-08' }], { 1: '2026-09-08' });
    assert.ok(rows[1].collides, 'the moved date must be re-checked against history');
    assert.ok(!rows.filter((_, i) => i !== 1).some((r) => r.collides));
  });

  test('the preview renders a moved row with its notice', () => {
    const html = renderDatePreview(planDates(plan(), '2026-09-07', [], { 1: '2026-09-08' }));
    assert.match(html, /class="[^"]*moved/);
    // Plain language, and no engine vocabulary: "compressed" and "recovered"
    // are gapClass values, not words an athlete has any reason to know.
    assert.match(html, /follows the previous session after 1 day/);
    assert.match(html, /more work than you can recover from/);
    assert.doesNotMatch(html, /compressed|recovered|gapClass/,
      'engine vocabulary must not reach the athlete');
    assert.match(html, /this export only/);
    assert.doesNotMatch(html, /undefined|NaN/);
  });
});

describe('toFitNotesCSV honours the dates it is given (#54)', () => {
  // The export path had NO tests before this. It produces the file that gets
  // imported onto the phone, which is what #36 goes on to verify.
  const state = emptyState();
  const opts = { manifest: mappingFile, catalog: defs.exercises, currentMax };
  const program = () => generate({
    schemaVersion: 1, styleId: 'bodybuilding', daysPerWeek: 4,
    availableDays: ['mon', 'wed', 'fri', 'sat'], blockWeeks: 1,
    equipmentProfile: 'home-garage', sessionMinutes: 70, seed: 20260813,
    athlete: { skillLevel: 2 }, history: []
  }, defs);

  test('without an override the dates are unchanged', () => {
    const out = toFitNotesCSV(program(), '2026-09-07', state, opts);
    assert.deepEqual(out.dates, ['2026-09-07', '2026-09-09', '2026-09-11', '2026-09-12']);
    assert.ok(out.rows > 0);
  });

  test('an override replaces the dates rather than shifting the start', () => {
    const dates = ['2026-09-07', '2026-09-08', '2026-09-11', '2026-09-12'];
    const out = toFitNotesCSV(program(), '2026-09-07', state, { ...opts, dates });
    assert.deepEqual(out.dates, dates);
    assert.ok(out.csv.includes('2026-09-08'), 'the moved date must reach the file');
  });

  test('a short date array is refused rather than exporting undefined', () => {
    assert.throws(() => toFitNotesCSV(program(), '2026-09-07', state, { ...opts, dates: ['2026-09-07'] }),
      /1 dates supplied for 4 sessions/);
  });

  test('a plan with no schedule refuses', () => {
    assert.throws(() => toFitNotesCSV({ weeks: [] }, '2026-09-07', state, opts), /no schedule/);
  });
});
