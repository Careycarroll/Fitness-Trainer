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
import { defs } from '../js/engine/defs.js';
import {
  renderSession, renderOmitted, sessionNoticeHtml, emptySession, patternLabel, omitReason,
  buildReviewQueue
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
          athlete: { skillLevel: 2, hasCoaching: false, strictReps: {} },
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
