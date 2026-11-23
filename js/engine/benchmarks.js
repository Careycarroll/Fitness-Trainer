/**
 * benchmarks.js — Preset benchmark WOD definitions and expansion.
 *
 * ADR-032 / ADR-012: CrossFit benchmarks are fixed, named structures ("The Girls",
 * Hero WODs) whose movements, rep schemes, and time caps are authored as data
 * rather than synthesized procedurally.
 *
 * This module expands a benchmark preset into a fully valid Program (SPEC.md)
 * that is immediately renderable, editable, and exportable to FitNotes.
 */
import benchmarksData from '../data/benchmarks.json' with { type: 'json' };
import { makeBlock, makeSetGroup } from './blocks.js';

export const BENCHMARKS = benchmarksData.benchmarks;

/** List all available benchmark presets. */
export function listBenchmarks() {
  return BENCHMARKS.map((b) => ({
    id: b.id,
    name: b.name,
    category: b.category,
    format: b.format,
    timeCapSeconds: b.timeCapSeconds,
    rounds: b.rounds,
    description: b.description
  }));
}

/** Find a benchmark preset by its id. */
export function getBenchmark(id) {
  return BENCHMARKS.find((b) => b.id === id) ?? null;
}

/**
 * Expand a benchmark preset into a standard Program.
 *
 * @param {object|string} benchmarkOrId  benchmark definition or id
 * @param {object} defs                  { exercises, styles }
 * @param {object} [options]             { seed, schedule }
 * @returns {object} Program             conforming to SPEC.md
 */
export function expandBenchmark(benchmarkOrId, defs, options = {}) {
  const benchmark = typeof benchmarkOrId === 'string'
    ? getBenchmark(benchmarkOrId)
    : benchmarkOrId;

  if (!benchmark) {
    throw new Error(`Benchmark preset not found: "${benchmarkOrId}"`);
  }

  const catalog = defs.exercises instanceof Map
    ? defs.exercises
    : new Map(defs.exercises.map((e) => [e.id, e]));

  const setGroups = benchmark.movements.map((m) => {
    const exercise = catalog.get(m.exerciseId);
    if (!exercise) {
      throw new Error(
        `Benchmark "${benchmark.name}" references unknown exerciseId: "${m.exerciseId}"`
      );
    }
    return makeSetGroup(exercise, {
      sets: 1,
      reps: m.reps ?? null,
      workSeconds: m.workSeconds ?? null,
      restSeconds: m.restSeconds ?? 0,
      loadNote: m.loadNote ?? null,
      role: 'main'
    });
  });

  const blockType = benchmark.blockType ?? (benchmark.format === 'amrap' ? 'amrap' : 'circuit');
  const block = makeBlock(blockType, setGroups, {
    rounds: benchmark.rounds ?? null,
    timeCapSeconds: benchmark.timeCapSeconds ?? null
  });

  const session = {
    domain: 'time',
    label: `${benchmark.name} — ${benchmark.description}`,
    styleId: 'crossfit',
    format: benchmark.format ?? 'intervals',
    rounds: benchmark.rounds ?? null,
    capSeconds: benchmark.timeCapSeconds,
    blocks: [block],
    omitted: [],
    estimatedSeconds: benchmark.timeCapSeconds ?? 1200,
    fatigueUsed: setGroups.reduce((acc, g) => acc + (g.fatigueCost ?? 0), 0),
    fatigueBudget: 18,
    blockedByGates: []
  };

  return {
    schemaVersion: 1,
    id: `preset-${benchmark.id}`,
    name: benchmark.name,
    styleId: 'crossfit',
    splitId: 'conditioning-3',
    domain: 'time',
    seed: options.seed ?? 20261123,
    schedule: options.schedule ?? ['mon'],
    splitFit: null,
    weeks: [
      {
        week: 1,
        sessions: [session]
      }
    ]
  };
}
