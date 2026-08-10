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
 */

import { analyzeCoverage } from '../../js/engine/coverage.js';

/** Accept either an array of profiles or an object keyed by id. */
function toProfileList(raw) {
  const node = raw.profiles ?? raw;
  if (Array.isArray(node)) return node;
  return Object.entries(node).map(([id, v]) => ({ id, ...v }));
}

/** Collect every pattern any shipped split asks for. */
function patternsFromSplits(splitsRaw) {
  const node = splitsRaw.splits ?? splitsRaw;
  const list = Array.isArray(node)
    ? node
    : Object.entries(node).map(([id, v]) => ({ id, ...v }));

  const out = new Map(); // pattern -> [splitId]
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

export default function check11({ equipment, splits, exercises, fail, pass }) {
  const profiles = toProfileList(equipment);
  const catalog = exercises.exercises ?? exercises;
  const patternMap = patternsFromSplits(splits);
  const patterns = [...patternMap.keys()];

  if (patterns.length === 0) {
    fail('No patterns found in splits.json — check 11 would pass vacuously.');
    return;
  }

  let checks = 0;

  for (const profile of profiles) {
    // User profiles never appear in shipped data, but guard anyway.
    if (profile.userDefined === true) continue;

    const { gaps } = analyzeCoverage(profile, patterns, catalog);
    for (const p of patterns) {
      checks++;
      const gap = gaps.find((g) => g.pattern === p);
      if (gap) {
        const usedBy = patternMap.get(p).join(', ');
        fail(
          `Shipped profile "${profile.id}" cannot cover pattern "${p}" ` +
            `(required by split: ${usedBy}). ` +
            `Add a catalog entry performable with: ${profile.equipment?.join(', ') || '(nothing)'}` +
            (gap.suggests.length ? ` — or add equipment: ${gap.suggests.join(', ')}.` : '.')
        );
      } else {
        pass();
      }
    }

    // ADR-013 asymmetry: the authoring baseline must be strictly covered, and
    // we want more than a bare minimum of one option, or substitution starves.
    if (profile.id === 'home-garage') {
      const { optionsByPattern } = analyzeCoverage(profile, patterns, catalog);
      for (const p of patterns) {
        checks++;
        const n = optionsByPattern.get(p)?.length ?? 0;
        if (n < 2) {
          fail(
            `home-garage has only ${n} option(s) for pattern "${p}"; ` +
              `ADR-013 requires at least 2 so substitution has somewhere to go.`
          );
        } else {
          pass();
        }
      }
    }
  }

  return { checks };
}
