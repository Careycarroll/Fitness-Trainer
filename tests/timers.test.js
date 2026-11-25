import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClock,
  computeElapsedSec,
  computeConditioningState
} from '../js/ui/timers.js';

describe('Workout, Rest & Conditioning Timers (#107)', () => {
  test('formatClock formats mm:ss and hh:mm:ss cleanly', () => {
    assert.equal(formatClock(0), '00:00');
    assert.equal(formatClock(65), '01:05');
    assert.equal(formatClock(3661), '1:01:01');
  });

  test('computeElapsedSec calculates non-negative elapsed seconds', () => {
    const start = '2026-11-25T10:00:00.000Z';
    const now = Date.parse('2026-11-25T10:05:30.000Z');
    assert.equal(computeElapsedSec(start, now), 330);
    assert.equal(computeElapsedSec(start, Date.parse('2026-11-25T09:59:00.000Z')), 0);
  });

  test('computeConditioningState handles EMOM (Chelsea 30 min)', () => {
    const cfg = {
      mode: 'emom',
      rounds: 30,
      intervalSec: 60,
      movements: ['5 Pull-Up', '10 Push-Up', '15 Bodyweight Squat']
    };

    const start = computeConditioningState(cfg, 0);
    assert.equal(start.currentRound, 1);
    assert.equal(start.totalRounds, 30);
    assert.equal(start.displayClock, '01:00');
    assert.equal(start.completed, false);

    const min2 = computeConditioningState(cfg, 75);
    assert.equal(min2.currentRound, 2);
    assert.equal(min2.displayClock, '00:45');

    const end = computeConditioningState(cfg, 1800);
    assert.equal(end.completed, true);
    assert.equal(end.displayClock, '00:00');
  });

  test('computeConditioningState handles Tabata work/rest transitions', () => {
    const cfg = {
      mode: 'tabata',
      rounds: 8,
      workSec: 20,
      restSec: 10,
      movements: ['Burpees', 'Air Squats']
    };

    const work = computeConditioningState(cfg, 5);
    assert.equal(work.phase, 'work');
    assert.equal(work.currentRound, 1);
    assert.equal(work.phaseRemaining, 15);
    assert.equal(work.currentMovement, 'Burpees');

    const rest = computeConditioningState(cfg, 22);
    assert.equal(rest.phase, 'rest');
    assert.equal(rest.currentRound, 1);
    assert.equal(rest.phaseRemaining, 8);
    assert.equal(rest.nextMovement, 'Air Squats');
  });

  test('computeConditioningState handles AMRAP countdown and For Time stopwatch', () => {
    const amrap = computeConditioningState({ mode: 'amrap', timeCapSec: 600, movements: ['Pull-Up', 'Push-Up'] }, 120);
    assert.equal(amrap.displayClock, '08:00');
    assert.equal(amrap.completed, false);

    const forTime = computeConditioningState({ mode: 'for_time', timeCapSec: 900, rounds: 5, movements: ['Thruster', 'Pull-Up'] }, 245);
    assert.equal(forTime.displayClock, '04:05');
    assert.equal(forTime.completed, false);
  });

  test('computeConditioningState steps through timed circuit stations with work, rest, and round transitions', () => {
    const cfg = {
      mode: 'circuit',
      rounds: 2,
      stations: [
        { name: 'Walking', workSec: 30, restSec: 15 },
        { name: 'Wall Sit', workSec: 30, restSec: 15 }
      ]
    };

    const s1Work = computeConditioningState(cfg, 25);
    assert.equal(s1Work.phase, 'work');
    assert.equal(s1Work.currentRound, 1);
    assert.equal(s1Work.currentMovement, 'Walking');
    assert.equal(s1Work.nextMovement, 'Rest');
    assert.equal(s1Work.phaseRemaining, 5);

    const s1Rest = computeConditioningState(cfg, 40);
    assert.equal(s1Rest.phase, 'rest');
    assert.equal(s1Rest.currentMovement, 'Rest');
    assert.equal(s1Rest.nextMovement, 'Wall Sit');
    assert.equal(s1Rest.phaseRemaining, 5);

    const s2Work = computeConditioningState(cfg, 45);
    assert.equal(s2Work.phase, 'work');
    assert.equal(s2Work.currentMovement, 'Wall Sit');

    const done = computeConditioningState(cfg, 165);
    assert.equal(done.completed, true);
    assert.equal(done.phase, 'done');
  });
});
