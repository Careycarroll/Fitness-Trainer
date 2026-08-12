/**
 * The UI reads setGroup fields by name. Nothing previously asserted that those
 * names match what the engine emits, so a rename on either side failed silently:
 * the warm-up badge read `needsWarmup` while engine/blocks.js emitted
 * `warmupRequired`, the ternary went falsy on every exercise, and 82/82 stayed
 * green because no test crosses the engine/UI boundary.
 *
 * This closes that gap without a DOM harness. It scans app.js for property
 * accesses on setGroup-shaped locals and checks each name against setGroups the
 * engine actually produces from shipped data. A field the UI reads but the
 * engine never sets is a bug; a field the UI itself assigns is not, so those are
 * listed explicitly in UI_OWNED below.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generate } from '../js/engine/index.js';
import { allSetGroups } from '../js/engine/blocks.js';
import { defs } from '../js/engine/defs.js';

const here = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(here, '..', 'js', 'ui', 'app.js');

/**
 * Fields the UI creates or mutates on its own copy of a setGroup — edit state,
 * not engine output. These are legitimately absent from a freshly generated
 * session, so they are exempt. Anything else the UI reads must come from the
 * engine.
 */
const UI_OWNED = new Set([
  // Assigned by the swap handler (app.js:453) so repeated swaps keep pointing at
  // the ORIGINAL exercise rather than the previous replacement. Never emitted.
  'swappedFrom',
]);

/** Locals in app.js that hold a setGroup. Keep in sync with the render path. */
/**
 * `p` is deliberately absent: app.js also uses it for equipment profiles
 * (`defs.equipment.some((p) => p.id === id)`), and a textual scan cannot tell
 * the two apart. Prescription fields are reachable through `group` anyway.
 */
const SETGROUP_LOCALS = ['group', 'sg'];


/** Every setGroup the engine can emit across all shipped styles. */
function everySetGroup() {
  const groups = [];

  for (const style of defs.styles) {
    const request = {
      schemaVersion: 1,
      styleId: style.id,
      daysPerWeek: 4,
      blockWeeks: 1,
      equipmentProfile: 'commercial-gym',
      sessionMinutes: 70,
      seed: 20260812,
      athlete: { skillLevel: 5, hasCoaching: true, strictReps: {} },
      history: [],
    };

    const program = generate(request, defs);

    for (const week of program.weeks ?? []) {
      for (const session of week.sessions ?? []) {
        groups.push(...allSetGroups(session));
      }
    }
  }

  return groups;
}

/** Property names app.js reads off a setGroup. */
function fieldsReadByUi(source) {
  const found = new Set();

  for (const local of SETGROUP_LOCALS) {
    const pattern = new RegExp(`\\b${local}\\.([A-Za-z_$][\\w$]*)`, 'g');
    for (const [, field] of source.matchAll(pattern)) found.add(field);
  }

  return [...found].filter((f) => !UI_OWNED.has(f)).sort();
}

test('setGroup contract: the UI reads only fields the engine emits', async (t) => {
  const groups = everySetGroup();

  await t.test('shipped styles produce setGroups to check against', () => {
    assert.ok(groups.length > 0, 'no setGroups generated — fixture is not real');
  });

  const emitted = new Set();
  for (const group of groups) {
    for (const key of Object.keys(group)) emitted.add(key);
  }

  await t.test('every field the UI reads exists on some emitted setGroup', () => {
    const read = fieldsReadByUi(readFileSync(APP_JS, 'utf8'));
    assert.ok(read.length > 0, 'scanned no setGroup field reads — check SETGROUP_LOCALS');

    const missing = read.filter((field) => !emitted.has(field));

    assert.deepEqual(
      missing,
      [],
      `app.js reads setGroup fields the engine never sets: ${missing.join(', ')}.\n` +
        `Either the UI has the name wrong, or the field is UI-owned edit state ` +
        `and belongs in UI_OWNED.\nEngine emits: ${[...emitted].sort().join(', ')}`,
    );
  });

  await t.test('warmupRequired survives on the exact field the UI renders', () => {
    // The specific regression: present in SPEC.md and the seed, dropped by the UI.
    assert.ok(
      emitted.has('warmupRequired'),
      'engine no longer emits warmupRequired — the warm-up badge cannot render',
    );

    const flagged = groups.filter((g) => g.warmupRequired === true);
    assert.ok(
      flagged.length > 0,
      'no generated setGroup requires a warm-up, so the badge is untestable in practice',
    );
  });
});
