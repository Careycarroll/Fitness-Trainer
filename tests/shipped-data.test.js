/**
 * shipped-data.test.js — assertions against the REAL shipped definition files.
 *
 * Why this file exists, stated plainly so it does not get deleted as redundant:
 *
 * `tests/coverage.test.js` is entirely synthetic. Its fixtures use
 * `horizontal-push`, `vertical-pull`, `plates`, `pullup-bar` — a kebab-case
 * vocabulary that appears in NO shipped file. It therefore passed continuously
 * while two real defects sat in the codebase:
 *
 *   1. check 11 exported a bare function while the runner expects
 *      `{ id, name, run }`. It threw on every run, the runner's try/catch
 *      swallowed it, and it reported "0 checks" for its entire life. Shipped
 *      profile coverage was never verified.
 *
 *   2. `coverage.js` read `profile.equipment` while `equipment.json` ships
 *      `profile.available`. Every shipped profile resolved to an EMPTY owned-set,
 *      so only zero-equipment movements were performable. `commercial-gym`
 *      masked it via `assumesAll: true`; `home-garage` — the one profile that
 *      exercised the path — was only checked by the validator that wasn't running.
 *
 * Both are the same failure: a test that reports PASS while verifying nothing.
 * Synthetic fixtures cannot catch it, because they are internally consistent
 * with themselves and disconnected from the data the app loads.
 *
 * The rule this file enforces: every vocabulary the engine reads must agree with
 * every vocabulary the data ships. A deliberate typo in equipment.json must
 * fail `npm test`, not just `npm run validate`.
 *
 * Keep tests/coverage.test.js — it covers edge cases (empty profiles, single-token
 * suggestions, multi-gap reporting) that the real data does not exercise.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeCoverage, isPerformable } from '../js/engine/coverage.js';
import { defs } from '../js/engine/defs.js';
import { DEFERRED_PATTERNS, isDeferred } from '../scripts/checks/_deferred.js';
import { PATTERNS, MUSCLES, LOAD_TYPES } from '../scripts/checks/_enums.js';

const catalog = defs.exercises;
const profiles = defs.equipment;
const splits = defs.splits;

/** Every pattern any shipped split asks for. */
const splitPatterns = [
  ...new Set(splits.flatMap((s) => s.days.flatMap((d) => d.patterns)))
];

/** The patterns the catalog is actually expected to supply today. */
const livePatterns = splitPatterns.filter((p) => !isDeferred(p));

const ownedOf = (profile) => new Set(profile.available ?? profile.equipment ?? []);

// ---------------------------------------------------------------------------
// Preconditions. If these fail, the rest of the file is meaningless — a
// vacuous pass here is exactly the failure mode this file was written to catch.
// ---------------------------------------------------------------------------

describe('shipped data: the fixtures are real', () => {
  test('the catalog is the generated 285-row build, not the M2 seed', () => {
    assert.ok(catalog.length > 200,
      `catalog has ${catalog.length} rows — looks like the retired M2 scaffolding seed`);
  });

  test('shipped profiles exist and expose an equipment list', () => {
    assert.ok(profiles.length >= 2, 'expected at least commercial-gym and home-garage');
    for (const p of profiles) {
      const owned = ownedOf(p);
      assert.ok(owned.size > 0 || p.assumesAll === true,
        `profile "${p.id}" resolves to an empty owned-set — ` +
        'this is the available/equipment key mismatch, not a data gap');
    }
  });

  test('home-garage is present and is not an assumesAll profile', () => {
    const garage = profiles.find((p) => p.id === 'home-garage');
    assert.ok(garage, 'home-garage missing — it is the ADR-013 authoring baseline');
    assert.notEqual(garage.assumesAll, true,
      'home-garage with assumesAll would make every coverage assertion vacuous');
  });

  test('splits reference at least one non-deferred pattern', () => {
    assert.ok(livePatterns.length > 0,
      'every split pattern is deferred — coverage assertions would pass vacuously');
  });
});

// ---------------------------------------------------------------------------
// The assertion that would have caught both defects.
// ---------------------------------------------------------------------------

describe('shipped data: profile coverage (ADR-013/014)', () => {
  test('every shipped profile covers every non-deferred split pattern', () => {
    for (const profile of profiles) {
      const { gaps } = analyzeCoverage(profile, livePatterns, catalog);
      assert.deepEqual(
        gaps.map((g) => g.pattern),
        [],
        `profile "${profile.id}" cannot cover: ${gaps.map((g) => g.pattern).join(', ')}`
      );
    }
  });

  test('home-garage has >= 2 options per pattern so substitution has somewhere to go', () => {
    const garage = profiles.find((p) => p.id === 'home-garage');
    const { optionsByPattern } = analyzeCoverage(garage, livePatterns, catalog);
    for (const p of livePatterns) {
      const n = optionsByPattern.get(p)?.length ?? 0;
      assert.ok(n >= 2,
        `home-garage has ${n} option(s) for "${p}"; ADR-013 requires at least 2`);
    }
  });

  test('a profile that owns nothing still covers bodyweight patterns', () => {
    // Guards the inverse of defect 2: if isPerformable ever became permissive,
    // an empty profile would cover everything and the check above would pass
    // for the wrong reason.
    const nothing = { id: 'nothing', name: 'Nothing', available: [] };
    const { gaps } = analyzeCoverage(nothing, livePatterns, catalog);
    assert.ok(gaps.length > 0,
      'an empty profile covered every pattern — equipment filtering is not running');
  });
});

// ---------------------------------------------------------------------------
// Vocabulary agreement across surfaces. ADR-026 reconciled five of them; this
// is what stops them drifting apart again.
// ---------------------------------------------------------------------------

describe('shipped data: vocabularies agree across surfaces', () => {
  test('every catalog pattern is in _enums PATTERNS', () => {
    for (const ex of catalog) {
      assert.ok(PATTERNS.includes(ex.pattern),
        `${ex.id}: pattern "${ex.pattern}" is not in _enums.js`);
    }
  });

  test('every catalog muscle token is in _enums MUSCLES', () => {
    for (const ex of catalog) {
      for (const m of [...ex.primaryMuscles, ...ex.secondaryMuscles]) {
        assert.ok(MUSCLES.includes(m), `${ex.id}: muscle "${m}" is not in _enums.js`);
      }
    }
  });

  test('every catalog loadType is in _enums LOAD_TYPES', () => {
    for (const ex of catalog) {
      assert.ok(LOAD_TYPES.includes(ex.loadType),
        `${ex.id}: loadType "${ex.loadType}" is not in _enums.js`);
    }
  });

  test('every split pattern is either supplied by the catalog or declared deferred', () => {
    for (const p of splitPatterns) {
      const supply = catalog.filter((ex) => ex.pattern === p).length;
      assert.ok(supply > 0 || isDeferred(p),
        `split pattern "${p}" has no catalog rows and is not in DEFERRED_PATTERNS`);
    }
  });

  test('every catalog equipment token is owned by some profile', () => {
    // commercial-gym is enumerated FROM the catalog, so this fails the moment a
    // CSV row introduces a token nobody owns — which is a real authoring error,
    // not a profile gap.
    const anyProfileOwns = new Set(profiles.flatMap((p) => [...ownedOf(p)]));
    for (const ex of catalog) {
      for (const t of ex.equipment) {
        assert.ok(anyProfileOwns.has(t),
          `${ex.id}: equipment token "${t}" appears in no shipped profile`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Deferral hygiene. A deferral that outlives its milestone is worse than none:
// it silently suppresses a check that has started mattering again.
// ---------------------------------------------------------------------------

describe('shipped data: deferrals are honest', () => {
  test('every deferred pattern names its milestone', () => {
    for (const [pattern, reason] of Object.entries(DEFERRED_PATTERNS)) {
      assert.match(reason, /M\d/,
        `DEFERRED_PATTERNS["${pattern}"] must name the milestone that removes it (ADR-007)`);
    }
  });

  test('no deferred pattern has become coverable by home-garage', () => {
    // The staleness guard, duplicated here so it fails in `npm test` and not
    // only in `npm run validate`. When M7 ships ergometer rows and a profile
    // that owns one, this fires and the entry must be deleted.
    const garage = profiles.find((p) => p.id === 'home-garage');
    for (const p of Object.keys(DEFERRED_PATTERNS)) {
      const { optionsByPattern } = analyzeCoverage(garage, [p], catalog);
      const n = optionsByPattern.get(p)?.length ?? 0;
      assert.ok(n < 2,
        `"${p}" is deferred but home-garage now has ${n} option(s) — ` +
        `the deferral is stale, delete it (${DEFERRED_PATTERNS[p]})`);
    }
  });

  test('deferred patterns are actually referenced by a shipped split', () => {
    // A deferral for a pattern nothing asks for is dead configuration.
    for (const p of Object.keys(DEFERRED_PATTERNS)) {
      assert.ok(splitPatterns.includes(p),
        `"${p}" is deferred but no shipped split references it — remove the entry`);
    }
  });
});

// ---------------------------------------------------------------------------
// The build-step derivations from ADR-026, checked against real rows rather
// than against the build script's own logic.
// ---------------------------------------------------------------------------

describe('shipped data: ADR-026 derivations held', () => {
  test('lunge exists and comes only from unilateral families', () => {
    const lunges = catalog.filter((ex) => ex.pattern === 'lunge');
    assert.ok(lunges.length >= 2, `expected lunge rows, found ${lunges.length}`);
    const families = new Set(lunges.map((ex) => ex.exerciseFamily));
    assert.deepEqual([...families].sort(), ['lunge', 'split_squat', 'step_up']);
  });

  test('scoring and timeDomain agree on every row (ADR-009)', () => {
    for (const ex of catalog) {
      assert.equal(ex.scoring === 'load', ex.timeDomain === null,
        `${ex.id}: scoring "${ex.scoring}" disagrees with timeDomain`);
    }
  });

  test('joint_load survived the build — ADR-020 depends on it', () => {
    const withKnee = catalog.filter((ex) => (ex.jointLoad ?? []).includes('knee'));
    assert.ok(withKnee.length > 0,
      'no row carries jointLoad knee — prioritize_joint_load is unimplementable');
  });

  test('every row that needs a warmup is expensive enough to justify it', () => {
    for (const ex of catalog) {
      assert.equal(ex.warmupRequired, ex.fatigueCost >= 4,
        `${ex.id}: warmupRequired disagrees with fatigueCost ${ex.fatigueCost}`);
    }
  });
});
