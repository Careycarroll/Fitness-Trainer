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
    const equipmentGaps = gaps.filter((g) => g.reason !== 'no-catalog-rows');
    const missingGaps = gaps.filter((g) => g.reason === 'no-catalog-rows');

    const lines = [];
    if (equipmentGaps.length) {
      const names = equipmentGaps.map((g) => `'${g.pattern}'`).join(', ');
      lines.push(
        `Profile "${profileName}" cannot perform any ${names} movement.`
      );
      for (const g of equipmentGaps) {
        if (g.suggests.length) {
          lines.push(`  ${g.pattern}: add ${g.suggests.join(' or ')}.`);
        }
      }
    }
    if (missingGaps.length) {
      const names = missingGaps.map((g) => `'${g.pattern}'`).join(', ');
      lines.push(
        `The catalog has no ${names} movements yet — no equipment change fixes this.`
      );
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
 * The tokens a profile owns. equipment.json ships `available`; tests and
 * runtime-constructed profiles have used `equipment`. Accept both -- reading one
 * silently produced an empty owned-set for every shipped profile (ADR-026).
 */
export function ownedOf(profile) {
  return new Set(profile?.available ?? profile?.equipment ?? []);
}

/**
 * Can this profile perform this exercise? THE single availability rule (#41).
 *
 * substitution.js carried a second copy that read profile.available directly and
 * ignored assumesAll, so coverage -- the precondition check -- was more permissive
 * than selection. A gap surfaced as a quiet short session instead of a
 * CoverageError, which is fail-closed inverted. One function, both callers.
 */
export function isAvailable(exercise, profile) {
  // #63. An unselectable row is browsable and swappable but never GENERATED.
  //
  // This is the single availability rule (#41): both generators and
  // analyzeCoverage call it, so the filter lands once rather than in three
  // places that can drift. rankSubstitutes deliberately does NOT go through
  // here -- a swap is the athlete choosing, and offering a variation they own
  // is the whole reason the flag exists rather than the row being rejected.
  //
  // Absent is treated as selectable so a runtime-constructed exercise in a test
  // fixture still works. Every catalog row carries it explicitly.
  if (exercise?.selectable === false) return false;
  if (profile?.assumesAll === true) return true;
  return isPerformable(exercise, ownedOf(profile));
}

/**
 * @param {object} profile   { id, name, available|equipment: string[], assumesAll?: boolean }
 * @param {string[]} requiredPatterns
 * @param {object[]} catalog
 * @returns {{ covered: string[], gaps: Array<{pattern, suggests}>, optionsByPattern: Map }}
 */
export function analyzeCoverage(profile, requiredPatterns, catalog) {
  // equipment.json ships profiles with `available`; tests and runtime-constructed
  // profiles have used `equipment`. Reading only one silently produced an empty
  // owned-set for every shipped profile, so only zero-equipment movements were
  // ever performable. commercial-gym masked it via assumesAll, and check 11 --
  // the one validator that would have caught it -- was throwing on a signature
  // mismatch and reporting 0 checks. Accept both; neither shape is wrong.
  const owned = ownedOf(profile);
  const assumesAll = profile.assumesAll === true;

  const optionsByPattern = new Map();
  const gaps = [];
  const covered = [];

  for (const pattern of [...new Set(requiredPatterns)]) {
    // #63: selectable only. analyzeCoverage answers "can the GENERATOR find a
    // row here", so counting rows it will never pick would make a thin profile
    // look healthy -- silently weakening check 11 the moment the import lands.
    const all = catalog.filter((ex) => ex.pattern === pattern && ex.selectable !== false);
    const options = assumesAll ? all : all.filter((ex) => isPerformable(ex, owned));
    optionsByPattern.set(pattern, options);

    if (options.length === 0) {
      // WHY a pattern is uncoverable determines what we can honestly tell the
      // user. If the catalog has zero rows for it, no amount of equipment
      // helps and suggesting some is a lie -- that is a missing milestone,
      // not a missing dumbbell.
      if (all.length === 0) {
        gaps.push({ pattern, reason: 'no-catalog-rows', suggests: [] });
        continue;
      }

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
      gaps.push({ pattern, reason: 'equipment', suggests: [...suggests].sort() });
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
