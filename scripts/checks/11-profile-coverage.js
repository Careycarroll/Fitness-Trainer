/**
 * Check 11 — every SHIPPED equipment profile covers every pattern referenced by
 * every SHIPPED split.
 *
 * ADR-014: user profiles are exempt — they cannot be validated at build time and
 * are checked at runtime by coverage.js instead. This check exists so that the
 * profiles we ship can never regress into a state where the app fails to
 * generate out of the box.
 *
 * ADR-013: home-garage is the authoring baseline. If this check fails on
 * home-garage, the catalog has a hole — that is the intended tripwire.
 *
 * NOTE (fix): this file previously exported a bare function taking
 * ({ equipment, splits, exercises, fail, pass }). The runner in
 * scripts/validate.js calls `check.run(defs, assert, rawFiles)` on a module
 * whose default export is `{ id, name, run }`. The mismatch meant `check.run`
 * was undefined, the TypeError was swallowed by the runner's try/catch, and
 * this check reported "0 checks" on every run — i.e. shipped-profile coverage
 * was never actually verified. Rewritten to the standard shape.
 */

import { analyzeCoverage } from '../../js/engine/coverage.js';

/** Accept either an array of profiles or an object keyed by id. */
function toProfileList(raw) {
  const node = raw?.profiles ?? raw ?? [];
  if (Array.isArray(node)) return node;
  return Object.entries(node).map(([id, v]) => ({ id, ...v }));
}

/** Collect every pattern any shipped split asks for -> Map(pattern -> [splitId]). */
function patternsFromSplits(splitsRaw) {
  const node = splitsRaw?.splits ?? splitsRaw ?? [];
  const list = Array.isArray(node)
    ? node
    : Object.entries(node).map(([id, v]) => ({ id, ...v }));

  const out = new Map();
  for (const split of list) {
    const days = split.days ?? split.sessions ?? [];
    for (const day of days) {
      const pats = day.patterns ?? day.required ?? [];
      for (const p of pats) {
        if (!out.has(p)) out.set(p, []);
        if (!out.get(p).includes(split.id)) out.get(p).push(split.id);
      }
    }
  }
  return out;
}

export default {
  id: '11',
  name: 'Shipped profiles cover every split pattern (ADR-013/014)',

  run(defs, assert, rawFiles) {
    // defs.equipment is already rawFiles['equipment.json'].profiles;
    // defs.splits is already rawFiles['splits.json'].splits. Both helpers
    // tolerate either shape, so pass defs first and fall back to raw.
    const profiles = toProfileList(defs.equipment ?? rawFiles?.['equipment.json']);
    const catalog = defs.exercises;
    const patternMap = patternsFromSplits(defs.splits ?? rawFiles?.['splits.json']);
    const patterns = [...patternMap.keys()];

    // A vacuous pass here is worse than a failure: it means the check silently
    // stopped protecting anything.
    assert(patterns.length > 0,
      'no patterns found in splits.json — check 11 would pass vacuously');
    if (patterns.length === 0) return;

    assert(profiles.length > 0,
      'no shipped equipment profiles found in equipment.json');

    for (const profile of profiles) {
      if (profile.userDefined === true) continue; // ADR-014

      const { gaps } = analyzeCoverage(profile, patterns, catalog);

      for (const p of patterns) {
        const gap = gaps.find((g) => g.pattern === p);
        const usedBy = (patternMap.get(p) ?? []).join(', ');
        const owned = profile.available?.join(', ')
          ?? profile.equipment?.join(', ')
          ?? '(nothing)';
        assert(
          !gap,
          `shipped profile "${profile.id}" cannot cover pattern "${p}" ` +
          `(required by split: ${usedBy}). Add a catalog entry performable with: ${owned}` +
          (gap?.suggests?.length ? ` — or add equipment: ${gap.suggests.join(', ')}.` : '.')
        );
      }

      // ADR-013 asymmetry: the authoring baseline needs more than a bare
      // minimum of one option, or substitution starves.
      if (profile.id === 'home-garage') {
        const { optionsByPattern } = analyzeCoverage(profile, patterns, catalog);
        for (const p of patterns) {
          const n = optionsByPattern.get(p)?.length ?? 0;
          assert(n >= 2,
            `home-garage has only ${n} option(s) for pattern "${p}"; ` +
            'ADR-013 requires at least 2 so substitution has somewhere to go');
        }
      }
    }
  }
};
