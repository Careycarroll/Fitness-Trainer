/**
 * #76 — splitFit reports a split the style never asked for.
 *
 * chooseSplit() has a fallback that matches on day count alone and returns
 * `sessionMismatch: null`, because the session count was honoured. Eight of
 * thirty style x day-count combinations resolve to a split the style does not
 * list in preferredSplits, and before #76 nothing recorded it.
 *
 * These tests pin the four facts measured when the field was added. If the
 * catalog gains a second split at some day count, the specific expectations
 * below should be re-measured rather than adjusted until they pass.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generate } from '../js/engine/index.js';
import { defs } from '../js/engine/defs.js';

const SEED = 20260813;

const plan = (styleId, daysPerWeek) => generate({
  schemaVersion: 1, styleId, daysPerWeek, blockWeeks: 1,
  equipmentProfile: 'commercial-gym', sessionMinutes: 70, seed: SEED,
  athlete: { skillLevel: 3 }, history: []
}, defs);

const LOAD_STYLES = defs.styles.filter((s) => s.domain === 'load');

describe('splitFit reports a non-preferred split (#76)', () => {
  test('core, strength and powerlifting flag ppl-6 at 6 days', () => {
    for (const id of ['core', 'strength', 'powerlifting']) {
      const p = plan(id, 6);
      assert.equal(p.splitId, 'ppl-6', `${id}/6 resolved to ${p.splitId}`);
      assert.ok(p.splitFit, `${id}/6: splitFit must not be null`);
      assert.equal(p.splitFit.preferred, false,
        `${id}/6: ppl-6 is not in preferredSplits, so preferred must be false`);
      assert.equal(p.splitFit.splitId, 'ppl-6');
      // sessionMismatch stays null: 6 sessions were asked for and 6 delivered.
      // That is the whole point -- the day count was honoured and the split
      // still does not fit.
      assert.equal(p.sessionMismatch, null,
        `${id}/6: the session count WAS honoured; splitFit carries the rest`);
    }
  });

  test('core at 6 days names the two Legs days it cannot use', () => {
    const p = plan('core', 6);
    const labels = p.splitFit.weakDays.map((d) => d.label).sort();
    assert.deepEqual(labels, ['Legs A', 'Legs B'],
      `expected the two ppl-6 leg days, got ${JSON.stringify(labels)}`);
    for (const d of p.splitFit.weakDays) {
      assert.ok(d.best < 0.3,
        `${d.label} reported as weak but best emphasis is ${d.best}`);
    }
    assert.equal(p.splitFit.emphasisedDays, 4);
    assert.equal(p.splitFit.totalDays, 6);
  });

  test('athletic flags four day counts, not just six', () => {
    // athletic-4 is its only preferred split, so every other day count lands
    // somewhere it never asked for.
    const flagged = [1, 2, 3, 4, 5, 6].filter((n) => plan('athletic', n).splitFit);
    assert.deepEqual(flagged, [1, 2, 5, 6],
      `expected 1,2,5,6 to be flagged, got ${flagged.join(',')}`);
  });

  test('a preferred split with no weak day reports null', () => {
    // The convention this repo already applies to sessionMismatch: a field
    // permanently reading "no problem" is noise.
    const p = plan('bodybuilding', 4);
    assert.equal(p.splitId, 'upper-lower-4');
    assert.equal(p.splitFit, null,
      'upper-lower-4 is preferred by bodybuilding and every day is emphasised');
  });

  test('every flagged combination is either non-preferred or has a weak day', () => {
    // Guards against the field firing for a reason it does not state.
    for (const style of LOAD_STYLES) {
      for (let n = 1; n <= 6; n += 1) {
        let p;
        try { p = plan(style.id, n); } catch { continue; }
        if (!p.splitFit) continue;
        assert.ok(p.splitFit.preferred === false || p.splitFit.weakDays.length > 0,
          `${style.id}/${n}: splitFit populated but the split is preferred and ` +
          `no day is weak -- the field is firing without a stated reason`);
      }
    }
  });
});

describe('splitFit changes nothing about the program (#76)', () => {
  test('selection and prescription are untouched by the new field', () => {
    // splitFit is computed from the resolved split AFTER every session is
    // built, and nothing reads it during generation. This is what makes the
    // change safe to ship without an ADR-002 before/after capture -- so assert
    // it rather than claim it.
    for (const style of LOAD_STYLES) {
      for (let n = 1; n <= 6; n += 1) {
        let a, b;
        try { a = plan(style.id, n); b = plan(style.id, n); } catch { continue; }
        assert.equal(JSON.stringify(a.weeks), JSON.stringify(b.weeks),
          `${style.id}/${n} is not deterministic`);
        // The field must not have leaked into any session.
        for (const w of a.weeks) {
          for (const s of w.sessions) {
            assert.equal(s.splitFit, undefined,
              `${style.id}/${n}: splitFit leaked onto a session`);
          }
        }
      }
    }
  });
});
