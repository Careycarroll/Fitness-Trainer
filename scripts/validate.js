#!/usr/bin/env node
/**
 * Definition-file validator. Runs in CI; `npm run build` will not proceed if it fails.
 *
 * ADR-003: unvalidated data is worse than code, because it fails silently at runtime rather
 * than loudly at commit. ADR-012: the validator is code and is tested independently of the
 * generators it protects.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'js', 'data');

const read = (f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));

const rawFiles = Object.fromEntries(
  readdirSync(dataDir).filter((f) => f.endsWith('.json')).map((f) => [f, read(f)])
);

const defs = {
  exercises: rawFiles['exercises.seed.json'].exercises,
  styles: rawFiles['styles.json'].styles,
  landmarks: rawFiles['landmarks.json'].landmarks,
  splits: rawFiles['splits.json'].splits,
  equipment: rawFiles['equipment.json'].profiles,
  substitutionWeights: rawFiles['substitution-weights.json'].weights,
  progression: rawFiles['progression.json']
};

const checkFiles = readdirSync(join(here, 'checks'))
  .filter((f) => /^\d\d-.*\.js$/.test(f))
  .sort();

let total = 0;
const failures = [];

for (const file of checkFiles) {
  const { default: check } = await import(join(here, 'checks', file));
  let checkCount = 0;
  const assert = (cond, message) => {
    checkCount++;
    total++;
    if (!cond) failures.push(`[${check.id}] ${message}`);
  };
  try {
    check.run(defs, assert, rawFiles);
  } catch (err) {
    failures.push(`[${check.id}] threw: ${err.message}`);
  }
  const bad = failures.filter((f) => f.startsWith(`[${check.id}]`)).length;
  const mark = bad === 0 ? 'PASS' : 'FAIL';
  console.log(`  ${mark}  ${check.id}  ${check.name.padEnd(52)} ${String(checkCount).padStart(5)} checks`);
}

console.log(`\n  ${checkFiles.length} validators, ${total} checks, ${defs.exercises.length} exercises, ${defs.styles.length} styles.`);

if (failures.length) {
  console.error(`\n  ${failures.length} FAILURE(S):\n`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log('  All definition files valid.\n');
