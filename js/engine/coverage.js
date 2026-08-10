/**
 * coverage.js — precondition check run BEFORE generation.
 *
 * ADR-014: user-editable equipment profiles cannot be validated at build time.
 * The generator must never emit a session containing a movement the selected
 * profile cannot perform. Where a required pattern has no option, fail loudly
 * with a named cause — never substitute silently, drop the pattern, or emit a
 * degraded session.
 *
 * This is CODE (ADR-012): it is a safety-adjacent precondition and must fail
 * closed.
 */

export class CoverageError extends Error {
  /**
   * @param {string} profileName
   * @param {Array<{pattern: string, suggests: string[]}>} gaps
   */
  constructor(profileName, gaps) {
    const first = gaps[0];
    const lines = [
      `Cannot generate: no '${first.pattern}' option available in profile "${profileName}".`
    ];
    if (first.suggests.length) {
      lines.push(`Add one of: ${first.suggests.join(', ')}.`);
    }
    if (gaps.length > 1) {
      const rest = gaps.slice(1).map((g) => g.pattern).join(', ');
      lines.push(`Also uncovered: ${rest}.`);
    }
    super(lines.join('\n'));
    this.name = 'CoverageError';
    this.profile = profileName;
    this.gaps = gaps;
  }
}

/**
 * Can this exercise be performed with the equipment on hand?
 * An exercise's `equipment` array is ALL-required (conjunctive). An empty array
 * means no equipment needed and is always performable.
 */
export function isPerformable(exercise, ownedSet) {
  const req = exercise.equipment ?? [];
  return req.every((token) => ownedSet.has(token));
}

/**
 * @param {object} profile   { id, name, equipment: string[], assumesAll?: boolean }
 * @param {string[]} requiredPatterns
 * @param {object[]} catalog
 * @returns {{ covered: string[], gaps: Array<{pattern, suggests}>, optionsByPattern: Map }}
 */
export function analyzeCoverage(profile, requiredPatterns, catalog) {
  const owned = new Set(profile.equipment ?? []);
  const assumesAll = profile.assumesAll === true;

  const optionsByPattern = new Map();
  const gaps = [];
  const covered = [];

  for (const pattern of [...new Set(requiredPatterns)]) {
    const all = catalog.filter((ex) => ex.pattern === pattern);
    const options = assumesAll ? all : all.filter((ex) => isPerformable(ex, owned));
    optionsByPattern.set(pattern, options);

    if (options.length === 0) {
      // Suggest the smallest set of tokens that would unlock this pattern:
      // any single token that, added alone, makes at least one exercise work.
      const suggests = new Set();
      for (const ex of all) {
        const missing = (ex.equipment ?? []).filter((t) => !owned.has(t));
        if (missing.length === 1) suggests.add(missing[0]);
      }
      if (suggests.size === 0) {
        // Nothing is one token away; suggest the cheapest full requirement set.
        const cheapest = all
          .map((ex) => (ex.equipment ?? []).filter((t) => !owned.has(t)))
          .sort((a, b) => a.length - b.length)[0];
        (cheapest ?? []).forEach((t) => suggests.add(t));
      }
      gaps.push({ pattern, suggests: [...suggests].sort() });
    } else {
      covered.push(pattern);
    }
  }

  return { covered, gaps, optionsByPattern };
}

/**
 * Throw if any required pattern has zero options. Call before generating.
 */
export function assertCoverage(profile, requiredPatterns, catalog) {
  const result = analyzeCoverage(profile, requiredPatterns, catalog);
  if (result.gaps.length > 0) {
    throw new CoverageError(profile.name ?? profile.id, result.gaps);
  }
  return result;
}
