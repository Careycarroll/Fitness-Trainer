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
 * ADR-026: DEFERRED_PATTERNS records patterns that have no catalog rows because
 * their milestone has not landed. They are SKIPPED loudly, never silently, and
 * the threshold is NOT lowered for anything else. Emptying this map is the
 * mechanical exit criterion for the milestone named in each entry (ADR-007).
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

/**
 * Patterns with zero catalog rows until their milestone lands.
 *
 * This is a DECLARATION, not a relaxation. Every other pattern is still held to
 * the full ADR-013 bar of >= 2 options on home-garage. An entry here must name
 * the milestone that removes it; when that milestone is done, deleting the entry
 * has to make the build pass, or the milestone is not actually done.
 *
 * monostructural: rower, air-bike, jump rope, running. These are interval-domain
 * movements. The catalog is load-domain only (285 rows, ADR-016). splits.json
 * ships `conditioning-3` which requires the pattern, and home-garage owns no
 * ergometer — so this fails on catalog size AND on equipment, and no amount of
 * strength authoring closes it.
 */
const DEFERRED_PATTERNS = {
};

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

    const allPatterns = [...patternMap.keys()];
    const deferred = allPatterns.filter((p) => p in DEFERRED_PATTERNS);
    const patterns = allPatterns.filter((p) => !(p in DEFERRED_PATTERNS));

    // Deferrals are printed, never silent. A skipped pattern you cannot see is
    // indistinguishable from a check that does not exist — which is the exact
    // failure this file already had once.
    for (const p of deferred) {
      console.log(`        SKIP  pattern "${p}" — deferred: ${DEFERRED_PATTERNS[p]}`);
    }

    // A vacuous pass here is worse than a failure: it means the check silently
    // stopped protecting anything.
    assert(patterns.length > 0,
      'no non-deferred patterns found in splits.json — check 11 would pass vacuously');
    if (patterns.length === 0) return;

    assert(profiles.length > 0,
      'no shipped equipment profiles found in equipment.json');

    // Staleness guard. The original version asserted zero catalog rows, which
    // was wrong: the M2 scaffolding seed ships 2 monostructural records, yet the
    // deferral is still valid because home-garage owns no ergometer. The real
    // claim being deferred is "the authoring baseline cannot cover this", so
    // that is what must be tested. When M7 lands rower/air-bike rows AND a
    // profile that owns one, this fires and the entry must be deleted.
    const baseline = profiles.find((p) => p.id === 'home-garage');
    if (baseline) {
      for (const p of deferred) {
        const { optionsByPattern } = analyzeCoverage(baseline, [p], catalog);
        const n = optionsByPattern.get(p)?.length ?? 0;
        assert(n < 2,
          `pattern "${p}" is deferred but home-garage now has ${n} option(s). ` +
          `The deferral is stale — delete the entry (${DEFERRED_PATTERNS[p]}).`);
      }
    }

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
