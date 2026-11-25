/**
 * Pure, wall-clock accurate workout, rest, hold, and CrossFit conditioning
 * timers + Web Speech voice coach helpers (#107).
 */

export function formatClock(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = sec % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(rem).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function computeElapsedSec(startedAtIso, nowMs = Date.now()) {
  if (!startedAtIso) return 0;
  const startMs = Date.parse(startedAtIso);
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

/**
 * Compute live state for CrossFit / conditioning timers (EMOM, AMRAP, For Time, Tabata).
 *
 * @param {object} config
 * @param {'emom'|'amrap'|'for_time'|'circuit'|'tabata'} config.mode
 * @param {number} [config.rounds]
 * @param {number} [config.intervalSec] e.g. 60 for EMOM
 * @param {number} [config.workSec] e.g. 20 for Tabata
 * @param {number} [config.restSec] e.g. 10 for Tabata
 * @param {number|null} [config.timeCapSec]
 * @param {string[]} [config.movements] ordered movement labels
 * @param {number} elapsedSec
 * @returns {object}
 */
export function computeConditioningState(config, elapsedSec) {
  const mode = config.mode || 'for_time';
  const movements = config.movements?.length ? config.movements : ['Work'];
  const elapsed = Math.max(0, Math.floor(Number(elapsedSec) || 0));

  if (mode === 'emom') {
    const intervalSec = Math.max(10, Number(config.intervalSec || 60));
    const totalRounds = Math.max(1, Number(config.rounds || Math.ceil((config.timeCapSec || 600) / intervalSec)));
    const totalSec = totalRounds * intervalSec;
    const clamped = Math.min(elapsed, totalSec);
    const completed = elapsed >= totalSec;
    const roundIdx = Math.min(totalRounds - 1, Math.floor(clamped / intervalSec));
    const inRoundElapsed = clamped % intervalSec;
    const roundRemaining = completed ? 0 : intervalSec - inRoundElapsed;
    const totalRemaining = Math.max(0, totalSec - clamped);

    // If multiple movements and rounds > movements, rotate or show all per minute
    const rotatePerMinute = movements.length > 1 && totalRounds % movements.length === 0 && movements.length <= 4 && totalRounds <= 24;
    const currentMovement = rotatePerMinute
      ? movements[roundIdx % movements.length]
      : movements.join(' · ');
    const nextMovement = completed
      ? 'Finished'
      : rotatePerMinute
        ? movements[(roundIdx + 1) % movements.length]
        : (roundIdx + 1 < totalRounds ? `Round ${roundIdx + 2}: ${movements.join(' · ')}` : 'Final Round');

    return {
      mode,
      completed,
      phase: 'work',
      displayClock: formatClock(roundRemaining),
      totalClock: formatClock(totalRemaining),
      currentRound: roundIdx + 1,
      totalRounds,
      phaseRemaining: roundRemaining,
      currentMovement,
      nextMovement
    };
  }

  if (mode === 'tabata') {
    const workSec = Math.max(5, Number(config.workSec || 20));
    const restSec = Math.max(5, Number(config.restSec || 10));
    const cycleSec = workSec + restSec;
    const totalRounds = Math.max(1, Number(config.rounds || 8));
    const totalSec = totalRounds * cycleSec;
    const completed = elapsed >= totalSec;
    const clamped = Math.min(elapsed, totalSec);
    const roundIdx = Math.min(totalRounds - 1, Math.floor(clamped / cycleSec));
    const inCycle = clamped % cycleSec;
    const isWork = !completed && inCycle < workSec;
    const phaseRemaining = completed ? 0 : (isWork ? workSec - inCycle : cycleSec - inCycle);
    const currentMovement = movements[roundIdx % movements.length];
    const nextMovement = completed
      ? 'Finished'
      : (isWork ? `Rest (${restSec}s)` : movements[(roundIdx + 1) % movements.length]);

    return {
      mode,
      completed,
      phase: completed ? 'done' : (isWork ? 'work' : 'rest'),
      displayClock: formatClock(phaseRemaining),
      totalClock: formatClock(Math.max(0, totalSec - clamped)),
      currentRound: roundIdx + 1,
      totalRounds,
      phaseRemaining,
      currentMovement,
      nextMovement
    };
  }

  if (mode === 'amrap') {
    const cap = Math.max(60, Number(config.timeCapSec || 600));
    const remaining = Math.max(0, cap - elapsed);
    const completed = elapsed >= cap;
    return {
      mode,
      completed,
      phase: completed ? 'done' : 'work',
      displayClock: formatClock(remaining),
      totalClock: formatClock(cap),
      currentRound: null,
      totalRounds: null,
      phaseRemaining: remaining,
      currentMovement: movements.join(' → '),
      nextMovement: completed ? 'Time Cap Reached' : 'Repeat circuit until cap'
    };
  }

  // timed circuit with per-station work/rest intervals
  if (mode === 'circuit' && Array.isArray(config.stations) && config.stations.length > 0) {
    const stations = config.stations.map((s) => ({
      name: s.name || 'Work',
      workSec: Math.max(5, Number(s.workSec || 30)),
      restSec: Math.max(0, Number(s.restSec ?? 15))
    }));
    const totalRounds = Math.max(1, Number(config.rounds || 1));
    const timeline = [];
    for (let r = 1; r <= totalRounds; r++) {
      for (let i = 0; i < stations.length; i++) {
        const st = stations[i];
        timeline.push({ round: r, stationIdx: i, phase: 'work', name: st.name, duration: st.workSec });
        const isVeryLast = r === totalRounds && i === stations.length - 1;
        if (st.restSec > 0 && !isVeryLast) {
          timeline.push({ round: r, stationIdx: i, phase: 'rest', name: 'Rest', duration: st.restSec });
        }
      }
    }
    const totalSec = timeline.reduce((sum, seg) => sum + seg.duration, 0);
    const completed = elapsed >= totalSec;
    if (completed) {
      return {
        mode,
        completed: true,
        phase: 'done',
        displayClock: '00:00',
        totalClock: '00:00',
        currentRound: totalRounds,
        totalRounds,
        phaseRemaining: 0,
        currentMovement: 'Complete',
        nextMovement: 'Finished'
      };
    }

    let cursor = 0;
    for (let idx = 0; idx < timeline.length; idx++) {
      const seg = timeline[idx];
      if (elapsed < cursor + seg.duration) {
        const phaseRemaining = (cursor + seg.duration) - elapsed;
        const nextSeg = timeline[idx + 1] ?? null;
        const nextMovement = nextSeg
          ? (nextSeg.phase === 'rest' ? 'Rest' : nextSeg.name)
          : 'Finish';
        return {
          mode,
          completed: false,
          phase: seg.phase,
          displayClock: formatClock(phaseRemaining),
          totalClock: formatClock(Math.max(0, totalSec - elapsed)),
          currentRound: seg.round,
          totalRounds,
          phaseRemaining,
          currentMovement: seg.name,
          nextMovement
        };
      }
      cursor += seg.duration;
    }
  }

  // for_time / untimed circuit
  const cap = config.timeCapSec ? Number(config.timeCapSec) : null;
  const completed = cap ? elapsed >= cap : false;
  return {
    mode,
    completed,
    phase: completed ? 'done' : 'work',
    displayClock: formatClock(elapsed),
    totalClock: cap ? `Cap ${formatClock(cap)}` : 'No Cap',
    currentRound: null,
    totalRounds: config.rounds || null,
    phaseRemaining: cap ? Math.max(0, cap - elapsed) : null,
    currentMovement: movements.join(' → '),
    nextMovement: config.rounds ? `${config.rounds} rounds for time` : 'Complete all movements'
  };
}

/**
 * Speak a short coaching cue via Web Speech API if available and enabled.
 * When `onDone` is provided, invokes it once after speech finishes (or immediately if muted/unavailable).
 */
export function speakAnnouncement(text, enabled = true, { onDone = null, maxWaitMs = 6000 } = {}) {
  const finishOnce = (() => {
    let called = false;
    return () => {
      if (called) return;
      called = true;
      if (typeof onDone === 'function') onDone();
    };
  })();

  if (!enabled || !text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    finishOnce();
    return false;
  }
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    if (typeof onDone === 'function') {
      const timer = setTimeout(finishOnce, maxWaitMs);
      utter.onend = () => { clearTimeout(timer); finishOnce(); };
      utter.onerror = () => { clearTimeout(timer); finishOnce(); };
    }
    window.speechSynthesis.speak(utter);
    return true;
  } catch {
    finishOnce();
    return false;
  }
}

let audioCtx = null;

/**
 * Play a crisp short tone via Web Audio API (fallback/companion to voice).
 */
export function playTimerBeep(freq = 880, durationMs = 140) {
  if (typeof window === 'undefined') return false;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;
  try {
    audioCtx ??= new Ctx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000);
    return true;
  } catch {
    return false;
  }
}
