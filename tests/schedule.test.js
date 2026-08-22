import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseTrainingDays,
  gapClass,
  normalizeDays,
  scheduleView,
  weekdayForSession,
  WEEKDAYS,
  ScheduleError
} from '../js/engine/schedule.js';

test('schedule: gap classification (ADR-015)', async (t) => {
  await t.test('Tue/Fri/Sat marks only Saturday compressed', () => {
    const days = ['tue', 'fri', 'sat'];
    assert.equal(gapClass(days, 0), 'recovered'); // tue, 3d after sat
    assert.equal(gapClass(days, 1), 'recovered'); // fri, 3d after tue
    assert.equal(gapClass(days, 2), 'compressed'); // sat, 1d after fri
  });

  await t.test('Mon/Wed/Fri marks all three recovered', () => {
    const days = ['mon', 'wed', 'fri'];
    for (let i = 0; i < 3; i++) assert.equal(gapClass(days, i), 'recovered');
  });

  await t.test('Sat/Sun wraps across the week boundary', () => {
    const days = ['sat', 'sun'];
    assert.equal(gapClass(days, 0), 'recovered'); // sat, 6d after sun
    assert.equal(gapClass(days, 1), 'compressed'); // sun, 1d after sat
  });

  await t.test('input order does not matter', () => {
    assert.equal(gapClass(['sat', 'tue', 'fri'], 2), 'compressed');
    assert.equal(gapClass(['tue', 'fri', 'sat'], 2), 'compressed');
  });

  await t.test('a single training day is always recovered', () => {
    assert.equal(gapClass(['wed'], 0), 'recovered');
    assert.equal(gapClass(['wed'], 5), 'recovered');
  });

  await t.test('seven consecutive days: every session is compressed', () => {
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    for (let i = 0; i < 7; i++) assert.equal(gapClass(days, i), 'compressed');
  });

  await t.test('classification cycles with the block, not the calendar', () => {
    const days = ['tue', 'fri', 'sat'];
    assert.equal(gapClass(days, 5), gapClass(days, 2));
    assert.equal(gapClass(days, 3), gapClass(days, 0));
  });
});

test('schedule: validation is loud', async (t) => {
  await t.test('rejects unknown tokens', () => {
    assert.throws(() => gapClass(['monday'], 0), ScheduleError);
  });
  await t.test('rejects duplicates', () => {
    assert.throws(() => gapClass(['mon', 'mon'], 0), /Duplicate/);
  });
  await t.test('rejects empty', () => {
    assert.throws(() => normalizeDays([]), ScheduleError);
  });
  await t.test('rejects more than seven', () => {
    assert.throws(
      () => normalizeDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'mon']),
      ScheduleError
    );
  });
  await t.test('rejects a negative index', () => {
    assert.throws(() => gapClass(['mon'], -1), ScheduleError);
  });
});

test('schedule: presentation mapping', async (t) => {
  await t.test('sessions cycle through weekdays in calendar order', () => {
    const days = ['sat', 'tue', 'fri'];
    assert.equal(weekdayForSession(days, 0), 'tue');
    assert.equal(weekdayForSession(days, 1), 'fri');
    assert.equal(weekdayForSession(days, 2), 'sat');
    assert.equal(weekdayForSession(days, 3), 'tue');
  });

  await t.test('scheduleView reports week numbers and gaps', () => {
    const view = scheduleView(['tue', 'fri', 'sat'], 6);
    assert.equal(view.length, 6);
    assert.equal(view[0].week, 1);
    assert.equal(view[3].week, 2);
    assert.equal(view[2].gap, 1);
    assert.equal(view[2].gapClass, 'compressed');
    assert.equal(view[5].gapClass, 'compressed');
  });
});

/**
 * Availability and frequency are DIFFERENT FACTS (#25). "I can train six days"
 * and "I want four sessions" are both true at once. Forcing them equal made the
 * athlete solve the spacing puzzle by hand, and made a 7-day request resolve
 * silently to a 5-day split because no 7-day template exists.
 */
test('schedule: choosing training days from availability', async (t) => {
  /** Cycle gaps, computed independently of the implementation. */
  const gapsOf = (days) => days.map((d, i) => {
    const prev = days[(i - 1 + days.length) % days.length];
    const raw = WEEKDAYS.indexOf(d) - WEEKDAYS.indexOf(prev);
    const g = ((raw % 7) + 7) % 7;
    return g === 0 ? 7 : g;
  });

  const combinations = (pool, k) => {
    const out = [];
    const walk = (start, picked) => {
      if (picked.length === k) { out.push([...picked]); return; }
      for (let i = start; i < pool.length; i += 1) walk(i + 1, [...picked, pool[i]]);
    };
    walk(0, []);
    return out;
  };

  /**
   * THE PROPERTY, not a pinned output. For every availability and every count,
   * the chosen days must have a gap profile no worse than any other candidate,
   * compared lexicographically on the SORTED gaps.
   *
   * Asserting the property rather than specific days matters: 4-of-7 admits
   * mon/tue/thu/sat and mon/wed/fri/sun, whose profiles are both [1,2,2,2].
   * Either is correct, and a test naming one would fail on a tie resolving
   * differently for reasons that are not defects.
   */
  await t.test('the choice is optimal for every availability and count', () => {
    const worse = (a, c) => {
      for (let i = 0; i < a.length; i += 1) if (a[i] !== c[i]) return a[i] < c[i];
      return false;
    };

    let checked = 0;
    for (let mask = 1; mask < 128; mask += 1) {
      const avail = WEEKDAYS.filter((_, i) => mask & (1 << i));
      for (let n = 1; n <= avail.length; n += 1) {
        const got = gapsOf(chooseTrainingDays(avail, n)).sort((x, y) => x - y);
        for (const cand of combinations(avail, n)) {
          const alt = gapsOf(cand).sort((x, y) => x - y);
          assert.ok(!worse(got, alt),
            `${n} of [${avail}]: chose ${got} but ${cand} scores ${alt}`);
        }
        checked += 1;
      }
    }
    assert.ok(checked > 300, `only ${checked} combinations checked`);
  });

  await t.test('maximises the SMALLEST gap, not the average', () => {
    // Gaps around a week always sum to 7 whichever days are picked, so a total
    // or mean can never discriminate. An early version scored on (min, total)
    // and chose mon/tue/wed/thu for 4-of-7: four consecutive days then a
    // four-day break, tied on min gap and settled by weekday order.
    const days = chooseTrainingDays(WEEKDAYS, 4);
    const gaps = gapsOf(days).sort((x, y) => x - y);
    assert.deepEqual(gaps, [1, 2, 2, 2], `${days} gives gaps ${gaps}`);
  });

  await t.test('three of six is the textbook answer', () => {
    assert.deepEqual(
      chooseTrainingDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], 3),
      ['mon', 'wed', 'fri']
    );
  });

  await t.test('taking every available day returns them all, in order', () => {
    assert.deepEqual(chooseTrainingDays(['fri', 'mon', 'wed'], 3), ['mon', 'wed', 'fri']);
  });

  await t.test('input order never changes the answer (ADR-002)', () => {
    const a = chooseTrainingDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], 3);
    const c = chooseTrainingDays(['sat', 'wed', 'mon', 'fri', 'tue', 'thu'], 3);
    assert.deepEqual(a, c);
  });

  await t.test('the same inputs always give the same days', () => {
    for (let i = 0; i < 20; i += 1) {
      assert.deepEqual(chooseTrainingDays(WEEKDAYS, 3), chooseTrainingDays(WEEKDAYS, 3));
    }
  });

  await t.test('more sessions than days available throws', () => {
    // A contradiction, not something to resolve by training twice in one day.
    assert.throws(() => chooseTrainingDays(['mon', 'tue'], 3), ScheduleError);
    assert.throws(() => chooseTrainingDays(['mon', 'tue'], 3), /only 2 day/);
  });

  await t.test('a non-positive or non-integer count throws', () => {
    for (const n of [0, -1, 1.5, '3', null, undefined]) {
      assert.throws(() => chooseTrainingDays(WEEKDAYS, n), ScheduleError, `count ${n}`);
    }
  });

  await t.test('availability is validated by normalizeDays', () => {
    assert.throws(() => chooseTrainingDays(['monday'], 1), ScheduleError);
    assert.throws(() => chooseTrainingDays(['mon', 'mon'], 1), /Duplicate/);
    assert.throws(() => chooseTrainingDays([], 1), ScheduleError);
  });

  await t.test('one session lands on the first available day', () => {
    assert.equal(chooseTrainingDays(['wed', 'sat'], 1)[0], 'wed');
  });
});
