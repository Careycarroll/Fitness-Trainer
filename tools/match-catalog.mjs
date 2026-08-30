#!/usr/bin/env node
/**
 * match-catalog.mjs — free-exercise-db (873 rows) against our 307, both directions.
 *
 *   node tools/match-catalog.mjs                      # report
 *   node tools/match-catalog.mjs --json /tmp/m.json   # + full pairing dump
 *
 * READ-ONLY. Reads import-sources/free-exercise-db/dist/exercises.json and
 * js/engine/defs.js. Writes nothing unless --json is given.
 *
 * WHY GLOBAL, NOT PER BODY PART
 *
 * Matching 01_quads.csv only against source rows tagged `quadriceps` looks like
 * a sensible way to shrink the batch. It is not: free-exercise-db tags several
 * squat variants primary `glutes`, so a per-body-part pass reports them NEW and
 * the import creates a duplicate. 873 x 307 is 268k comparisons and runs in
 * under a second. Match globally; REVIEW in batches, which is what the
 * by-file grouping at the end is for.
 *
 * THE TIER THAT MATTERS IS CONFLICT
 *
 * `Dumbbell Bench Press` and `barbell-bench-press` share three of four words.
 * Any name-similarity score ranks them highly and they are different exercises.
 * A false match is worse than a miss twice over: it attaches the wrong
 * instructions AND suppresses a genuinely new row. So implement tokens
 * (barbell, dumbbell, cable, machine, band, kettlebell, smith, ez, landmine)
 * are a VETO, not a signal. Disagreement forces CONFLICT no matter how well the
 * rest of the name scores.
 *
 * WHAT EACH DIRECTION ANSWERS
 *
 *   ours -> theirs   how many of our 307 can inherit instructions, and which
 *                    of the rows that actually get programmed are left without
 *   theirs -> ours   how many of the 873 are genuinely new, which is the real
 *                    import size. The 464 figure predates this tool.
 *
 * ONLY the EXACT tier is safe to apply unattended. STRONG is a one-line glance,
 * LIKELY and CONFLICT are judgement, WEAK is usually noise.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const SRC = join(REPO, 'import-sources/free-exercise-db/dist/exercises.json');

const { defs } = await import(join(REPO, 'js/engine/defs.js'));

let source;
try {
  source = JSON.parse(readFileSync(SRC, 'utf8'));
} catch (err) {
  console.error(`FAILED to read ${SRC}\n  ${err.message}`);
  console.error('  import-sources/ is gitignored — clone free-exercise-db there first.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Words that carry no identity. `Alternate Hammer Curl` and `hammer-curl` are
 * the same movement; `alternate` is a cue, not a distinction.
 *
 * `bench` is deliberately NOT here and NOT an implement: in `bench press` it is
 * part of the movement name, and dropping it would collapse bench press into
 * press.
 */
const FILLER = new Set([
  'the', 'a', 'an', 'with', 'and', 'or', 'to', 'on', 'in', 'of', 'for',
  'alternate', 'alternating', 'exercise', 'version', 'variation', 'style'
]);

/**
 * Spelling and vocabulary differences that are NOT distinctions.
 *
 * Measured against the two catalogs: they write `pushdown`, we write `pushdown`
 * too, but HIIT-100 and several sources write `pressdown`. `flye` vs `fly` is
 * split across both catalogs. Normalising these is safe; anything that changes
 * WHICH muscle or WHICH implement is not and is absent here.
 */
const SYNONYM = new Map(Object.entries({
  pressdown: 'pushdown',
  flye: 'fly',
  flyes: 'fly',
  flys: 'fly',
  situp: 'sit-up',
  situps: 'sit-up',
  pullup: 'pull-up',
  pullups: 'pull-up',
  pushup: 'push-up',
  pushups: 'push-up',
  chinup: 'chin-up',
  dumbbells: 'dumbbell',
  bands: 'band',
  kettlebells: 'kettlebell',
  barbells: 'barbell',
  cables: 'cable',
  machines: 'machine',
  raises: 'raise',
  curls: 'curl',
  presses: 'press',
  rows: 'row',
  extensions: 'extension',
  squats: 'squat',
  lunges: 'lunge',
  crunches: 'crunch',
  bodyonly: 'bodyweight',
  ezbar: 'ez',
  'e-z': 'ez'
}));

/**
 * IMPLEMENT TOKENS — the veto set.
 *
 * These decide whether two similar names are the same exercise. Disagreement
 * between two NON-EMPTY implement sets forces CONFLICT regardless of how well
 * the remaining words score, because `Dumbbell Bench Press` scoring 0.75
 * against `barbell-bench-press` is exactly the false match this tool exists to
 * prevent.
 *
 * One side empty is NOT disagreement: our `squat` against their `Barbell Squat`
 * is a real candidate and the human decides.
 */
const IMPLEMENTS = new Set([
  'barbell', 'dumbbell', 'cable', 'machine', 'band', 'kettlebell',
  'smith', 'ez', 'landmine', 'ring', 'rings', 'suspension', 'sled',
  'bodyweight', 'trap-bar', 'plate', 'medicine', 'sandbag', 'hex'
]);

function tokens(name) {
  const flat = String(name)
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')     // unicode dashes
    .replace(/[^a-z0-9\s-]/g, ' ')        // punctuation, keep hyphen
    .replace(/\s+/g, ' ')
    .trim();

  const out = [];
  for (let raw of flat.split(/[\s-]+/)) {
    if (!raw) continue;
    raw = SYNONYM.get(raw) ?? raw;
    if (FILLER.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

const contentOf = (t) => new Set(t.filter((w) => !IMPLEMENTS.has(w)));
const implementOf = (t) => new Set(t.filter((w) => IMPLEMENTS.has(w)));

const jaccard = (a, b) => {
  if (!a.size && !b.size) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit += 1;
  return hit / (a.size + b.size - hit);
};

const sameSet = (a, b) => {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
};

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

const prep = (name, extra = {}) => {
  const t = tokens(name);
  return { name, tokens: t, content: contentOf(t), implement: implementOf(t), flat: t.join(' '), ...extra };
};

const ours = defs.exercises.map((e) =>
  prep(e.name, { id: e.id, file: e.sourceFile ?? '(unknown)', pattern: e.pattern }));

const theirs = source.map((r) =>
  prep(r.name, {
    id: r.id,
    equipment: r.equipment || '(blank)',
    steps: (r.instructions ?? []).length,
    primary: r.primaryMuscles ?? []
  }));

/**
 * Tier one candidate pair.
 *
 * EXACT     identical after normalisation. Safe to apply unattended.
 * STRONG    content >= 0.85 and implements agree exactly. One glance each.
 * CONFLICT  content >= 0.55 but implements DISAGREE. Never auto-apply.
 * LIKELY    content >= 0.55, implements agree or one side is silent.
 * WEAK      content >= 0.35. Usually noise, printed only in the JSON dump.
 * NEW       below that. Nothing on the other side resembles it.
 */
function tier(a, b) {
  const c = jaccard(a.content, b.content);
  const bothNamed = a.implement.size > 0 && b.implement.size > 0;
  const agree = sameSet(a.implement, b.implement);

  if (a.flat === b.flat) return { tier: 'EXACT', score: 1 };
  if (bothNamed && !agree) return c >= 0.55 ? { tier: 'CONFLICT', score: c } : { tier: 'WEAK', score: c };
  if (c >= 0.85 && agree) return { tier: 'STRONG', score: c };
  if (c >= 0.55) return { tier: 'LIKELY', score: c };
  if (c >= 0.35) return { tier: 'WEAK', score: c };
  return { tier: 'NEW', score: c };
}

const RANK = { EXACT: 5, STRONG: 4, LIKELY: 3, CONFLICT: 2, WEAK: 1, NEW: 0 };

function bestFor(a, pool) {
  let best = { tier: 'NEW', score: 0, other: null };
  for (const b of pool) {
    const r = tier(a, b);
    if (RANK[r.tier] > RANK[best.tier] || (RANK[r.tier] === RANK[best.tier] && r.score > best.score)) {
      best = { ...r, other: b };
    }
  }
  return best;
}

const oursMatched = ours.map((a) => ({ a, ...bestFor(a, theirs) }));
const theirsMatched = theirs.map((b) => ({ b, ...bestFor(b, ours) }));

// ---------------------------------------------------------------------------
// Self-test: known pairs. If these are wrong the tiering is wrong.
// ---------------------------------------------------------------------------

const PROBES = [
  // our slug            expected tier for its best match
  ['barbell-bench-press', ['EXACT', 'STRONG', 'LIKELY']],
  ['back-squat', ['EXACT', 'STRONG', 'LIKELY']],
  ['conventional-deadlift', ['EXACT', 'STRONG', 'LIKELY']]
];

console.log('SELF-TEST — three lifts free-exercise-db certainly contains\n');
let probeFail = 0;
for (const [slug, want] of PROBES) {
  const row = oursMatched.find((m) => m.a.id === slug);
  if (!row) { console.log(`  MISSING  ${slug} is not in our catalog`); probeFail += 1; continue; }
  const ok = want.includes(row.tier);
  if (!ok) probeFail += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${slug.padEnd(24)}${row.tier.padEnd(9)}` +
    `${row.score.toFixed(2)}  -> ${row.other ? row.other.name : '(nothing)'}`);
}
if (probeFail) {
  console.log('\n  The tiering does not recognise lifts that are certainly present.');
  console.log('  Treat every count below as unreliable until this passes.\n');
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const tally = (rows) => {
  const t = {};
  for (const r of rows) t[r.tier] = (t[r.tier] ?? 0) + 1;
  return t;
};

const line = (t, total) => Object.entries(RANK)
  .sort((x, y) => y[1] - x[1])
  .map(([k]) => `${k} ${t[k] ?? 0}`)
  .join('  ') + `   (of ${total})`;

console.log('\n' + '='.repeat(74));
console.log('OURS -> THEIRS   can our 307 inherit instructions?');
console.log('='.repeat(74));
console.log('  ' + line(tally(oursMatched), ours.length));

const inherit = oursMatched.filter((m) => ['EXACT', 'STRONG'].includes(m.tier) && m.other?.steps);
console.log(`  rows that would inherit instructions unattended: ${inherit.length}`);

console.log('\n--- our rows with NO match at all, by file (these stay text-less)');
const orphanByFile = {};
for (const m of oursMatched.filter((x) => x.tier === 'NEW')) {
  (orphanByFile[m.a.file] ??= []).push(m.a.id);
}
for (const f of Object.keys(orphanByFile).sort()) {
  console.log(`  ${f.padEnd(20)}${orphanByFile[f].length}`);
  console.log(`      ${orphanByFile[f].slice(0, 8).join(' ')}${orphanByFile[f].length > 8 ? ' ...' : ''}`);
}

console.log('\n--- CONFLICT on our side: similar name, different implement. NEVER auto-apply.');
for (const m of oursMatched.filter((x) => x.tier === 'CONFLICT').slice(0, 20)) {
  console.log(`  ${m.score.toFixed(2)}  ${m.a.id.padEnd(30)}vs  ${m.other.name}`);
}

console.log('\n' + '='.repeat(74));
console.log('THEIRS -> OURS   how many of the 873 are genuinely new?');
console.log('='.repeat(74));
console.log('  ' + line(tally(theirsMatched), theirs.length));

const genuinelyNew = theirsMatched.filter((m) => m.tier === 'NEW');
const needsJudgement = theirsMatched.filter((m) => ['LIKELY', 'CONFLICT', 'WEAK'].includes(m.tier));
console.log(`\n  import size if only NEW is imported:        ${genuinelyNew.length}`);
console.log(`  rows needing a human decision first:        ${needsJudgement.length}`);
console.log(`  already covered (EXACT or STRONG):          ${theirsMatched.filter((m) => ['EXACT', 'STRONG'].includes(m.tier)).length}`);

console.log('\n--- what the NEW rows are, by their primary muscle');
const newByMuscle = {};
for (const m of genuinelyNew) {
  const k = (m.b.primary[0] ?? '(none)');
  (newByMuscle[k] ??= []).push(m.b.name);
}
for (const k of Object.keys(newByMuscle).sort((a, b) => newByMuscle[b].length - newByMuscle[a].length)) {
  console.log(`  ${k.padEnd(16)}${String(newByMuscle[k].length).padStart(4)}   ${newByMuscle[k].slice(0, 3).join(' | ')}`);
}

console.log('\n--- 20 NEW rows at random-ish, to sanity check they really are new');
for (const m of genuinelyNew.filter((_, i) => i % Math.max(1, Math.floor(genuinelyNew.length / 20)) === 0).slice(0, 20)) {
  console.log(`  ${m.b.name.padEnd(44)}${m.b.equipment.padEnd(14)}${m.b.steps} steps`);
}

console.log('\n' + '='.repeat(74));
console.log('WHAT THIS DECIDES');
console.log('='.repeat(74));
console.log(`
  EXACT + STRONG on OUR side  -> instruction backfill, apply unattended
  NEW on THEIR side           -> the real import size for #63
  CONFLICT either side        -> read every one. A false match attaches wrong
                                 instructions AND hides a real new row.
  the by-file orphan list     -> which review batch is worth doing first

  Nothing has been written. Re-run with --json <path> for the full pairing.`);

const jsonAt = process.argv.indexOf('--json');
if (jsonAt !== -1 && process.argv[jsonAt + 1]) {
  const path = process.argv[jsonAt + 1];
  writeFileSync(path, JSON.stringify({
    ours: oursMatched.map((m) => ({
      id: m.a.id, name: m.a.name, file: m.a.file,
      tier: m.tier, score: Number(m.score.toFixed(3)),
      match: m.other ? { id: m.other.id, name: m.other.name, steps: m.other.steps } : null
    })),
    theirs: theirsMatched.map((m) => ({
      id: m.b.id, name: m.b.name, equipment: m.b.equipment, steps: m.b.steps,
      primary: m.b.primary,
      tier: m.tier, score: Number(m.score.toFixed(3)),
      match: m.other ? { id: m.other.id, name: m.other.name } : null
    }))
  }, null, 2));
  console.log(`\nwrote ${path}`);
}
