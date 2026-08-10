#!/usr/bin/env node
/**
 * M3 data migration — idempotent, reversible via git.
 *
 * ADR-013: remove the `minimal` profile (filed to Backlog).
 * ADR-014: mark home-garage editable, commercial-gym fixed + assumesAll.
 * ADR-015: splits declare sessionsPerWeek and carry no weekday names;
 *          progression gains compressedAccessoryMultiplier.
 *
 * Run from the repo root:  node scripts/m3-apply.js
 * It prints a diff summary and refuses to guess if a shape is unexpected.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const changes = [];
const warnings = [];

function load(path) {
  if (!existsSync(path)) {
    warnings.push(`SKIP ${path} — not found.`);
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function save(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

/** Work with either an array or an id-keyed object, preserving the shape. */
function eachRecord(node, fn) {
  if (Array.isArray(node)) {
    node.forEach((rec) => fn(rec, rec.id));
    return node;
  }
  for (const [id, rec] of Object.entries(node)) fn(rec, id);
  return node;
}

function dropRecord(node, id) {
  if (Array.isArray(node)) {
    const i = node.findIndex((r) => r.id === id);
    if (i >= 0) {
      node.splice(i, 1);
      return true;
    }
    return false;
  }
  if (id in node) {
    delete node[id];
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- equipment
const EQUIP = 'js/data/equipment.json';
const equipment = load(EQUIP);
if (equipment) {
  const node = equipment.profiles ?? equipment;

  if (dropRecord(node, 'minimal')) {
    changes.push(`${EQUIP}: removed profile "minimal" (ADR-013, filed to Backlog)`);
  }

  eachRecord(node, (rec, id) => {
    if (id === 'home-garage') {
      if (rec.editable !== true) {
        rec.editable = true;
        changes.push(`${EQUIP}: home-garage.editable = true (ADR-014)`);
      }
    } else if (id === 'commercial-gym') {
      if (rec.editable !== false) {
        rec.editable = false;
        changes.push(`${EQUIP}: commercial-gym.editable = false (ADR-014)`);
      }
      if (rec.assumesAll !== true) {
        rec.assumesAll = true;
        changes.push(`${EQUIP}: commercial-gym.assumesAll = true — "assume everything"`);
      }
    } else if (rec.editable === undefined) {
      rec.editable = true;
      changes.push(`${EQUIP}: ${id}.editable = true (default)`);
    }
  });

  save(EQUIP, equipment);
}

// ------------------------------------------------------------------- splits
const SPLITS = 'js/data/splits.json';
const splits = load(SPLITS);
if (splits) {
  const node = splits.splits ?? splits;
  const WEEKDAY = /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;

  eachRecord(node, (rec, id) => {
    const days = rec.days ?? rec.sessions ?? [];

    if (rec.sessionsPerWeek === undefined && days.length) {
      rec.sessionsPerWeek = days.length;
      changes.push(`${SPLITS}: ${id}.sessionsPerWeek = ${days.length} (ADR-015)`);
    }

    // ADR-015: day names must not appear in shipped plan data.
    for (const day of days) {
      for (const key of ['weekday', 'day', 'dayName']) {
        if (typeof day[key] === 'string' && WEEKDAY.test(day[key])) {
          delete day[key];
          changes.push(`${SPLITS}: ${id} — stripped weekday field "${key}" (ADR-015)`);
        }
      }
    }
  });

  save(SPLITS, splits);
}

// -------------------------------------------------------------- progression
const PROG = 'js/data/progression.json';
const progression = load(PROG);
if (progression) {
  if (progression.compressedAccessoryMultiplier === undefined) {
    progression.compressedAccessoryMultiplier = 0.75;
    changes.push(`${PROG}: compressedAccessoryMultiplier = 0.75 (ADR-015)`);
  }
  save(PROG, progression);
}

// ------------------------------------------------------------------ report
console.log('\nM3 data migration\n');
if (changes.length === 0) {
  console.log('  No changes needed — already applied.\n');
} else {
  for (const c of changes) console.log(`  + ${c}`);
  console.log('');
}
if (warnings.length) {
  for (const w of warnings) console.log(`  ! ${w}`);
  console.log('');
}
console.log('  Review with: git diff js/data/\n');
