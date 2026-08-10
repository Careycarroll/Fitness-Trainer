import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gapClass,
  normalizeDays,
  scheduleView,
  weekdayForSession,
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
