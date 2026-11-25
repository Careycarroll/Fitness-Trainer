/**
 * ADR-023 ExerciseMax derivation and read-only maxes/staleness readout (#16, #49).
 *
 * Pure module: no DOM, no SQLite, no storage writes.
 *
 * Rules (ADR-023):
 * - Only compound barbell / trap_bar weight_reps lifts with fatigueCost >= 3
 *   are percentage-anchored.
 * - Epley: e1RM = load * (1 + reps / 30).
 * - Two-tier confidence in an 8-week (56-day) window:
 *     1-3 reps -> 'estimated' (authoritative)
 *     4-6 reps -> 'estimated_low_confidence' (used only when no 1-3 rep
 *                 qualifying set exists in the 8-week window)
 *     7+ reps  -> ignored
 *     RPE <= 7 -> ignored (when RPE is recorded)
 * - Precedence: tested > estimated > entered > estimated_low_confidence.
 *   A higher estimate flags rather than silently overwriting a tested/entered max.
 */

import { appendExerciseMax, currentMax } from '../storage/state.js';

const LB_PER_KG = 0.453592;
const WINDOW_DAYS = 56;
const STALE_IMPORT_DAYS = 14;

const SOURCE_RANK = Object.freeze({
  tested: 4,
  estimated: 3,
  entered: 2,
  estimated_low_confidence: 1
});

/** Predicate for ADR-023 percentage-anchored lifts. */
export function isAnchoredLift(exercise) {
  if (!exercise) return false;
  return Boolean(
    exercise.isCompound &&
    exercise.trackingType === 'weight_reps' &&
    (exercise.fatigueCost ?? 0) >= 3 &&
    (exercise.equipment ?? []).some((t) => t === 'barbell' || t === 'trap_bar')
  );
}

/** Epley 1RM formula per ADR-023: load * (1 + reps / 30). */
export function epley1RM(weight, reps) {
  if (!(weight > 0) || !(reps >= 1)) return null;
  if (reps === 1) return Math.round(weight * 10) / 10;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

/** Convert weight to canonical lb. */
export function toCanonicalLb(weight, weightUnit = 'lb') {
  if (!(weight > 0) || !Number.isFinite(weight)) return null;
  if (weightUnit === 'kg') return Math.round((weight / LB_PER_KG) * 10) / 10;
  return weight;
}

function daysBetween(olderYmd, newerYmd) {
  if (!olderYmd || !newerYmd) return Infinity;
  const a = Date.parse(`${olderYmd.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${newerYmd.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.floor((b - a) / 86400000);
}

function todayYmd() {
  return new Date().toLocaleDateString('en-CA');
}

/**
 * Derive 8-week Epley estimates from logged sets for anchored lifts (#16).
 */
export function deriveEstimatedMaxes(sets = [], catalog = [], asOfDate = todayYmd()) {
  const anchored = catalog.filter(isAnchoredLift);
  const anchoredIds = new Set(anchored.map((e) => e.id));

  const tier1 = new Map(); // 1-3 reps
  const tier2 = new Map(); // 4-6 reps
  const anyLogged = new Set();

  for (const s of sets) {
    if (!s || !s.exerciseId || !anchoredIds.has(s.exerciseId)) continue;
    anyLogged.add(s.exerciseId);

    const age = daysBetween(s.date, asOfDate);
    if (age < 0 || age > WINDOW_DAYS) continue;
    if (s.rpe != null && Number(s.rpe) <= 7) continue;

    const reps = Number(s.reps);
    const weightLb = toCanonicalLb(Number(s.weight), s.weightUnit ?? 'lb');
    if (!(weightLb > 0) || !(reps >= 1) || reps > 6) continue;

    const e1rm = epley1RM(weightLb, reps);
    if (e1rm == null) continue;

    const candidate = {
      exerciseId: s.exerciseId,
      e1rm,
      source: reps <= 3 ? 'estimated' : 'estimated_low_confidence',
      effectiveDate: s.date.slice(0, 10),
      reps,
      weightLb
    };

    const bucket = reps <= 3 ? tier1 : tier2;
    const prev = bucket.get(s.exerciseId);
    if (
      !prev ||
      candidate.e1rm > prev.e1rm ||
      (candidate.e1rm === prev.e1rm && candidate.effectiveDate > prev.effectiveDate)
    ) {
      bucket.set(s.exerciseId, candidate);
    }
  }

  const byExerciseId = new Map();
  const reasons = new Map();

  for (const ex of anchored) {
    const est = tier1.get(ex.id) ?? tier2.get(ex.id) ?? null;
    if (est) {
      byExerciseId.set(ex.id, est);
    } else if (anyLogged.has(ex.id)) {
      reasons.set(ex.id, 'No qualifying set at 1\u20136 reps (RPE > 7) in the last 8 weeks');
    } else {
      reasons.set(ex.id, 'No sets logged yet');
    }
  }

  return { byExerciseId, reasons };
}

/**
 * Resolve the working max for one anchored lift, preserving tested/entered
 * precedence and flagging higher estimates rather than silently overwriting (#16).
 */
export function resolveWorkingMax(state, exerciseId, derivedEstimate = null) {
  const stored = state ? currentMax(state, exerciseId) : null;
  if (!stored && !derivedEstimate) {
    return { workingMax: null, precedenceFlag: null };
  }
  if (!stored) {
    return { workingMax: derivedEstimate, precedenceFlag: null };
  }
  if (!derivedEstimate) {
    return { workingMax: stored, precedenceFlag: null };
  }

  const storedRank = SOURCE_RANK[stored.source] ?? 0;
  const derivedRank = SOURCE_RANK[derivedEstimate.source] ?? 0;

  if (stored.source === 'tested' || stored.source === 'entered') {
    const flag = derivedEstimate.e1rm > stored.e1rm
      ? `Logged ${derivedEstimate.reps}-rep set estimates ${derivedEstimate.e1rm} lb (above ${stored.source} ${stored.e1rm} lb)`
      : null;
    return { workingMax: stored, precedenceFlag: flag };
  }

  const winner = (derivedRank > storedRank || (derivedRank === storedRank && derivedEstimate.e1rm > stored.e1rm))
    ? derivedEstimate
    : stored;
  return { workingMax: winner, precedenceFlag: null };
}

/**
 * Append derived ExerciseMax rows to state without overwriting tested/entered rows (#16).
 */
export function syncEstimatedMaxes(state, catalog = [], asOfDate = todayYmd()) {
  const { byExerciseId } = deriveEstimatedMaxes(state.importedSets ?? [], catalog, asOfDate);
  let next = state;

  for (const [exerciseId, est] of byExerciseId) {
    const live = currentMax(next, exerciseId);
    if (live && (live.source === 'tested' || live.source === 'entered')) continue;
    if (live && live.e1rm === est.e1rm && live.source === est.source && live.effectiveDate === est.effectiveDate) {
      continue;
    }
    next = appendExerciseMax(next, {
      id: `est:${exerciseId}:${est.effectiveDate}:${est.e1rm}`,
      exerciseId,
      e1rm: est.e1rm,
      source: est.source,
      effectiveDate: est.effectiveDate
    });
  }

  return next;
}

/**
 * Build the read-only maxes, estimates, personal bests, and staleness readout (#49).
 * Reads stored state + logged sets only; persists nothing.
 */
export function buildMaxReadout({ state, loggedSets = [], catalog = [], asOfDate = todayYmd() }) {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const importedSets = state?.importedSets ?? [];
  const combinedSets = [...importedSets, ...loggedSets];

  const lastImportAt = state?.meta?.lastImportAt ?? null;
  const daysSinceImport = lastImportAt ? daysBetween(lastImportAt.slice(0, 10), asOfDate) : null;
  const isStale = lastImportAt == null || (daysSinceImport != null && daysSinceImport > STALE_IMPORT_DAYS);

  const unresolvedSets = importedSets.filter((s) => s.exerciseId == null);
  const unresolvedNames = new Set(unresolvedSets.map((s) => s.sourceExerciseName || 'unnamed'));

  // Actual heaviest set performed (PB) per exercise — never conflated with e1RM.
  const pbByExercise = new Map();
  for (const s of combinedSets) {
    if (!s || !s.exerciseId) continue;
    const weightLb = toCanonicalLb(Number(s.weight), s.weightUnit ?? 'lb');
    const reps = Number(s.reps ?? 0);
    if (!(weightLb > 0) || !(reps >= 1)) continue;

    const prev = pbByExercise.get(s.exerciseId);
    if (
      !prev ||
      weightLb > prev.weightLb ||
      (weightLb === prev.weightLb && reps > prev.reps) ||
      (weightLb === prev.weightLb && reps === prev.reps && (s.date ?? '') > prev.date)
    ) {
      pbByExercise.set(s.exerciseId, {
        exerciseId: s.exerciseId,
        name: byId.get(s.exerciseId)?.name ?? s.exerciseId,
        weight: Number(s.weight),
        weightUnit: s.weightUnit ?? 'lb',
        weightLb,
        reps,
        date: (s.date ?? '').slice(0, 10)
      });
    }
  }

  const { byExerciseId, reasons } = deriveEstimatedMaxes(combinedSets, catalog, asOfDate);

  const anchoredLifts = catalog
    .filter(isAnchoredLift)
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((ex) => {
      const est = byExerciseId.get(ex.id) ?? null;
      const { workingMax, precedenceFlag } = resolveWorkingMax(state, ex.id, est);
      return {
        exerciseId: ex.id,
        name: ex.name,
        workingMax,
        estimatedMax: est,
        precedenceFlag,
        personalBest: pbByExercise.get(ex.id) ?? null,
        missingReason: workingMax ? null : (reasons.get(ex.id) ?? 'No qualifying max')
      };
    });

  const personalBests = [...pbByExercise.values()]
    .sort((a, b) => (b.weightLb - a.weightLb) || (a.name < b.name ? -1 : 1));

  return {
    asOfDate,
    lastImportAt,
    daysSinceImport,
    isStale,
    unresolvedSetCount: unresolvedSets.length,
    unresolvedExerciseCount: unresolvedNames.size,
    anchoredLifts,
    personalBests
  };
}
