/**
 * Check 12 — the many-to-one merge precondition holds.
 *
 * `data/fitnotes/README.md` documents the reason the FitNotes merge is safe:
 * ten Trainer exercises receive more than one FitNotes definition, and **in
 * every group at most one source carries completed sets**. No two histories
 * combine, so no estimated 1RM is affected.
 *
 * That README also says "re-check on every new export" — a human promise, of
 * exactly the kind this directory exists to replace. ADR-023 derives e1RM from
 * logged sets, so two populated sources merging changes future prescriptions
 * rather than sitting inert. A precondition that load-bearing must fail the
 * build, not a reader's attention.
 *
 * GROUPING IS ON THE RESOLVED `exerciseId`, NOT ON THE CSV's `trainer_id`
 * COLUMN. This is the whole reason the check is written this way. The two rows
 * that violate the precondition today do not share a column value:
 *
 *     181  Lying Triceps Extension  trainer_id=ez-bar-skullcrusher  trainer_name=(empty)  3 sets
 *     202  EZ-Bar Skullcrusher      trainer_id=(empty)              trainer_name=EZ-Bar…  2 sets
 *
 * One authored its target as a slug, the other by name. Grouping on
 * `trainer_id` finds no duplicate at all and the check passes vacuously —
 * indistinguishable from a check that does not exist, which is precisely the
 * defect check 11's header records. So we group on what the BUILD resolved
 * (`exerciseId` in the generated manifest) and join back to the CSV on the
 * numeric `fitnotes_id` only to read `completed_sets`.
 *
 * KNOWN_UNSAFE is a DECLARATION, not a relaxation, on the ADR-026 /
 * DEFERRED_PATTERNS model. An entry names the issue that removes it and the
 * milestone that must not ship with it present. It is printed loudly on every
 * run, and it goes STALE-CHECKED: if a listed group stops violating the
 * precondition, the entry itself fails, so a fixed defect cannot leave a
 * permanent exemption behind.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..');

const CSV_PATH = join(REPO, 'data', 'fitnotes', 'fitnotes-mapping.csv');
const MANIFEST_PATH = join(REPO, 'js', 'data', 'fitnotes-mapping.json');

/**
 * Groups permitted to violate the precondition, keyed on resolved exerciseId.
 *
 * Deferred because nothing reads merged history yet: #16 (e1RM from logged
 * sets) and #44 (weekly volume) are both open, so the combined value is
 * computed by no one. A bulk catalog import will re-slug targets and re-tier
 * the manifest, so resolving the mapping by hand now means resolving it twice.
 *
 * Each entry MUST be gone before the issue named in `blocks` lands.
 */
const KNOWN_UNSAFE = {
  'ez-bar-skullcrusher': {
    issue: '#55',
    blocks: '#16',
    note: 'ids 181 (3 sets) and 202 (2 sets); resolve during the bulk catalog import'
  }
};

/** Minimal RFC-4180 reader: quoted fields may contain commas and "" escapes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const [header, ...body] = rows;
  return body
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** Manifest rows, tolerating either a bare array or a `{ exercises: [...] }`. */
function manifestRows(raw) {
  const node = raw?.exercises ?? raw ?? [];
  return Array.isArray(node) ? node : Object.values(node);
}

const idOf = (row) => String(row.fitnotesId ?? row.fitnotes_id ?? row.id ?? '');

export default {
  id: '12',
  name: 'Many-to-one FitNotes merges keep one populated source',

  run(defs, assert, rawFiles) {
    const manifest = manifestRows(
      rawFiles?.['fitnotes-mapping.json'] ??
      JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    );
    const csv = parseCsv(readFileSync(CSV_PATH, 'utf8'));

    // Completed-set counts live in the authored CSV, never in the built
    // manifest — the manifest is identity, the CSV is provenance. Joined on the
    // numeric id because FitNotes lets the athlete rename any row.
    const setsById = new Map(
      csv.map((r) => [String(r.fitnotes_id), Number(r.completed_sets || 0)])
    );

    // A vacuous pass is worse than a failure. If the manifest is unreadable or
    // carries no resolved targets, this check has silently stopped protecting
    // anything.
    assert(manifest.length > 0, 'fitnotes-mapping.json holds no rows — check 12 would pass vacuously');
    assert(csv.length > 0, 'fitnotes-mapping.csv holds no rows — check 12 would pass vacuously');

    const groups = new Map();
    for (const row of manifest) {
      const target = row.exerciseId;
      if (!target) continue; // unmapped: reviewable, carries no merge risk
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target).push({
        id: idOf(row),
        name: row.fitnotesName ?? row.fitnotes_name ?? '(unnamed)',
        sets: setsById.get(idOf(row)) ?? 0
      });
    }

    const manyToOne = [...groups.entries()].filter(([, rows]) => rows.length > 1);
    assert(manyToOne.length > 0,
      'no many-to-one groups found — the merge rule this check guards is not being exercised, ' +
      'which means grouping has broken rather than the data having improved');

    const violations = new Map();
    for (const [target, rows] of manyToOne) {
      const populated = rows.filter((r) => r.sets > 0);
      if (populated.length > 1) violations.set(target, populated);
    }

    // Deferrals are printed, never silent.
    for (const [target, entry] of Object.entries(KNOWN_UNSAFE)) {
      const populated = violations.get(target);
      console.log(
        `        SKIP  "${target}" — deferred to ${entry.issue}, must land before ${entry.blocks}: ${entry.note}`
      );
      // Staleness guard: a fixed group must not keep its exemption.
      assert(populated !== undefined,
        `"${target}" is listed in KNOWN_UNSAFE but no longer has two populated sources. ` +
        `The deferral is stale — delete the entry and close ${entry.issue}.`);
    }

    for (const [target, populated] of violations) {
      if (target in KNOWN_UNSAFE) continue;
      const detail = populated.map((r) => `${r.name} (id ${r.id}, ${r.sets} sets)`).join(' + ');
      assert(false,
        `"${target}" receives completed sets from ${populated.length} FitNotes sources: ${detail}. ` +
        'data/fitnotes/README.md states that at most one source per group may carry sets; ' +
        'ADR-023 computes e1RM from logged sets, so merging two histories changes future ' +
        'prescriptions. Decide the merge rule (combine / prefer one / refuse) and record it, ' +
        'or add a KNOWN_UNSAFE entry naming the issue that resolves it.'
      );
    }

    // Presence of the claim itself: if the README stops making it, this check
    // is guarding a rule nobody has written down.
    const readme = readFileSync(join(REPO, 'data', 'fitnotes', 'README.md'), 'utf8');
    assert(/at most one\s+source carries completed sets/s.test(readme),
      'data/fitnotes/README.md no longer states the one-populated-source rule; ' +
      'check 12 enforces a precondition that is no longer documented');
  }
};
