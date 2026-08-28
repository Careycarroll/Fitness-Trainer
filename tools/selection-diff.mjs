#!/usr/bin/env node
/**
 * selection-diff.mjs — ADR-002 before/after evidence for #75.
 *
 * Lives in tools/, beside js/. The two relative imports assume that.
 *
 * Written against the REAL API, taken from tests/selection-quality.test.js:
 *   generate(request, defs) -> { weeks: [{ sessions: [...] }], splitId }
 *   defs.styles (array, .domain === 'load'), defs.equipment (array of {id})
 *   allSetGroups(session) -> setGroups with .exerciseId .sets .reps
 *   session.exercisesRequested / .exercisesPlaced  <- the truncation fields
 *
 * An earlier draft invented `generateProgram({style, profile, days})`, a
 * `PROFILES` module, and `session.requestedCount`. The last one mattered most:
 * undefined, the truncation counter would have reported 0 -> 0 and looked like
 * proof. Named here because that is the failure mode this file exists to avoid.
 *
 * ADR-002 requires the diff on SELECTION, not JSON.stringify(weeks), because
 * blocks.js copies `equipment` onto every setGroup and a string diff overstates
 * the change.
 *
 *   node tools/selection-diff.mjs --capture /tmp/75-before.json
 *   # apply the change
 *   node tools/selection-diff.mjs --capture /tmp/75-after.json
 *   node tools/selection-diff.mjs --compare /tmp/75-before.json /tmp/75-after.json
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { generate } from '../js/engine/index.js';
import { defs } from '../js/engine/defs.js';
import { allSetGroups } from '../js/engine/blocks.js';

const SEED = 20260813;              // same seed the test file uses
const DAY_COUNTS = [1, 2, 3, 4, 5, 6];
const LOAD_STYLES = defs.styles.filter((s) => s.domain === 'load');
const PROFILES = defs.equipment.map((p) => p.id);

const plan = (styleId, daysPerWeek, equipmentProfile) => generate({
  schemaVersion: 1, styleId, daysPerWeek, blockWeeks: 1,
  equipmentProfile, sessionMinutes: 70, seed: SEED,
  athlete: { skillLevel: 3 }, history: []
}, defs);

const rowOf = (id) => defs.exercises.find((e) => e.id === id);

/** ADR-002's signature: what was selected and how it was prescribed. */
function signatureOf(program) {
  const sigs = [];
  for (const week of program.weeks ?? []) {
    for (const session of week.sessions ?? []) {
      for (const g of allSetGroups(session)) {
        sigs.push(`${g.exerciseId}:${g.sets}x${g.reps}`);
      }
    }
  }
  return sigs;
}

function capture() {
  const out = {};
  for (const style of LOAD_STYLES) {
    for (const profile of PROFILES) {
      for (const days of DAY_COUNTS) {
        const key = `${style.id}|${profile}|${days}`;
        try {
          const program = plan(style.id, days, profile);
          out[key] = {
            splitId: program.splitId ?? null,
            selection: signatureOf(program),
            sessions: (program.weeks ?? []).flatMap((w) => w.sessions).map((s) => {
              const first = allSetGroups(s)[0];
              const pattern = first ? rowOf(first.exerciseId)?.pattern ?? null : null;
              return {
                requested: s.exercisesRequested ?? null,
                placed: s.exercisesPlaced ?? null,
                fatigueUsed: s.fatigueUsed ?? null,
                fatigueBudget: s.fatigueBudget ?? null,
                lead: first ? first.exerciseId : null,
                leadPattern: pattern,
                // test 3's actual assertion, captured so the diff shows it moving
                leadEmphasis: pattern ? (style.patternEmphasis?.[pattern] ?? 0) : null
              };
            })
          };
        } catch (err) {
          out[key] = { error: String(err && err.message) };
        }
      }
    }
  }
  return out;
}

const isTruncated  = (s) => s.requested != null && s.placed < s.requested;
const isWeakLead   = (s) => s.leadEmphasis != null && s.leadEmphasis < 0.3;
const isOverBudget = (s) => s.fatigueBudget != null && s.fatigueUsed > s.fatigueBudget;

function multisetDiff(before, after) {
  const count = (arr) => arr.reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map());
  const b = count(before);
  const a = count(after);
  const lines = [];
  for (const [sig, n] of b) {
    const d = n - (a.get(sig) ?? 0);
    for (let i = 0; i < d; i++) lines.push(`- ${sig}`);
  }
  for (const [sig, n] of a) {
    const d = n - (b.get(sig) ?? 0);
    for (let i = 0; i < d; i++) lines.push(`+ ${sig}`);
  }
  return lines;
}

function compare(beforePath, afterPath) {
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

  let changed = 0;
  let identical = 0;
  let reorderOnlyCount = 0;
  const trunc = { before: 0, after: 0 };
  const weakLead = { before: 0, after: 0 };
  const overspend = { before: 0, after: 0 };
  const splitMoves = [];
  const leadMoves = [];

  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (!b || !a) { console.log(`MISSING  ${key}`); continue; }
    if (b.error || a.error) { console.log(`ERROR    ${key}  ${b.error ?? a.error}`); continue; }

    if (b.splitId !== a.splitId) splitMoves.push(`${key}: ${b.splitId} -> ${a.splitId}`);

    trunc.before     += b.sessions.filter(isTruncated).length;
    trunc.after      += a.sessions.filter(isTruncated).length;
    weakLead.before  += b.sessions.filter(isWeakLead).length;
    weakLead.after   += a.sessions.filter(isWeakLead).length;
    overspend.before += b.sessions.filter(isOverBudget).length;
    overspend.after  += a.sessions.filter(isOverBudget).length;

    b.sessions.forEach((s, i) => {
      const t = a.sessions[i];
      if (t && s.lead !== t.lead) {
        leadMoves.push(
          `${key} s${i + 1}: ${s.lead} (${s.leadPattern} @${s.leadEmphasis}) -> ` +
          `${t.lead} (${t.leadPattern} @${t.leadEmphasis})`
        );
      }
    });

    if (b.selection.join('\n') === a.selection.join('\n')) { identical++; continue; }
    changed++;

    console.log(`\n=== ${key}`);
    // Multiset diff, not positional: reordering slots within a session would
    // make a positional diff report every row as changed when only the order
    // moved. Order change is real, but it is not selection change.
    for (const line of multisetDiff(b.selection, a.selection)) console.log(`  ${line}`);
    const reorderOnly = [...b.selection].sort().join() === [...a.selection].sort().join();
    if (reorderOnly) { reorderOnlyCount++; console.log('  (order only — same rows, same prescriptions)'); }
  }

  console.log('\n--- summary');
  console.log(`programs identical  : ${identical}`);
  console.log(`programs changed    : ${changed}  (of which order-only: ${reorderOnlyCount})`);
  console.log(`split assignment    : ${splitMoves.length} changed`);
  for (const line of splitMoves) console.log(`  ${line}`);
  console.log(`sessions truncated  : ${trunc.before} -> ${trunc.after}      (test 1)`);
  console.log(`leads below 0.3     : ${weakLead.before} -> ${weakLead.after}      (test 3)`);
  console.log(`over fatigue budget : ${overspend.before} -> ${overspend.after}      (must stay 0)`);
  console.log(`session leads moved : ${leadMoves.length}`);
  for (const line of leadMoves) console.log(`  ${line}`);
}

const [, , cmd, ...args] = process.argv;
if (cmd === '--capture') {
  const path = args[0] ?? 'selection.json';
  const data = capture();
  writeFileSync(path, JSON.stringify(data, null, 2));
  const combos = Object.keys(data).length;
  const errors = Object.values(data).filter((v) => v.error).length;
  const rows = Object.values(data).reduce((n, v) => n + (v.selection?.length ?? 0), 0);
  console.log(`wrote ${path}`);
  console.log(`  ${combos} style x profile x days combinations (${errors} did not generate)`);
  console.log(`  ${rows} selected set groups captured`);
  if (rows === 0) console.log('  WARNING: nothing captured — check the imports resolve.');
} else if (cmd === '--compare') {
  if (!args[0] || !args[1]) { console.error('--compare needs two files'); process.exit(1); }
  compare(args[0], args[1]);
} else {
  console.error('usage: selection-diff.mjs --capture <out.json> | --compare <before> <after>');
  process.exit(1);
}
