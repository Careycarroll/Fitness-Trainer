/**
 * Check 14 — `exerciseFamily` is well-formed and free of near-collisions.
 *
 * WHY THIS EXISTS
 *
 * `exerciseFamily` is load-bearing and, until now, validated by NOTHING. The
 * only reference outside build_seed.py's lunge derivation is familyPenalty:
 *
 *     const familyPenalty = (state, exercise, style) =>
 *       (state.usedFamilies.get(exercise.exerciseFamily ?? exercise.id) ?? 0)
 *       * (style?.familyRepeatCost ?? 3);
 *
 * It runs on every scoring call, and #66 made it per-style. A typo'd family is
 * therefore a SILENT defect: the misspelled row lands in a family of one,
 * `usedFamilies.get()` returns 0, the penalty never fires, and that row can
 * repeat freely inside a session. Nothing crashes and no test notices, because
 * a merged or orphaned family looks exactly like a legitimate one.
 *
 * That risk is small at 102 hand-authored families and large at the several
 * hundred the bulk import (#63) will produce.
 *
 * WHY A SHAPE CHECK AND NOT AN ENUM
 *
 * Check 13 validates equipment against a hand-authored list in _enums.js, and
 * its own comment states the rule: "THIS LIST GROWS WITH THE ROWS THAT USE IT."
 * That works for equipment because gyms contain a finite set of things — the
 * vocabulary has a natural ceiling around 70 tokens.
 *
 * Families have no such ceiling. A family is closer to "a movement" than to "a
 * machine", and the import could plausibly double the count. Maintaining that
 * list by hand across 800 imported rows is friction whose failure mode is a
 * blocked build, so it would be worked around rather than maintained.
 *
 * So: no fixed list. Instead, the three properties that actually catch the
 * error class.
 *
 * WHY EDIT DISTANCE 1 IS THE TRIPWIRE
 *
 * A typo'd family is, by construction, one character from the family it was
 * meant to be: `bench_pres`, `barbell_ro`, `hip_thrus`, `squa`. So a new pair
 * of families one character apart is either a typo or a distinction so fine it
 * deserves a human decision. Either way it should stop the build.
 *
 * Measured across the 102 current families, exactly ONE pair sits at distance
 * 1, and it is legitimate:
 *
 *     hip_abduction  ~  hip_adduction      antagonists, b vs d
 *
 * It is acknowledged below. Everything else is distance 2 or more, so this
 * check passes today with no allowlist to maintain — which is the property
 * that makes it worth having.
 *
 * Distance 2 is REPORTED, never failed. Every distance-2 pair in the catalog is
 * legitimate (`pull_up`/`push_up`, `pulldown`/`pushdown`, `erg`/`jerk`,
 * `jerk`/`neck`), so failing on it would be noise. Printing it means a genuine
 * two-character typo is visible in the run rather than silent.
 *
 * WHAT IS REPORTED AND NOT FAILED
 *
 * Mirrors check 13's declared-but-unused rule: information the author should
 * see, not an error.
 *
 *   - SINGLETON families. 21 of 102, all legitimate — `pec_deck` has no
 *     siblings and does not need one. But a family that arrives as a singleton
 *     during the import is worth a second look, because that is also what a
 *     typo looks like.
 *
 *   - Families spanning more than one PATTERN. 7 of 102. Some are meaningful:
 *     `squat` holds `jump-squat` (explosive), `pull_up` holds `ring-muscle-up`
 *     (explosive). At least one is not: `bodyweight_extension` holds
 *     `diamond-push-up` (push_h) and `suspension-triceps-extension`
 *     (isolation), which are not one movement under any definition. Reported
 *     because #52 turns on exactly this question — whether a family means
 *     "avoid repeating" or "these are the same movement".
 */

/**
 * Distance-1 family pairs that are DELIBERATE.
 *
 * A pair is added here only with a stated reason. The point of the check is
 * that adding an entry is a decision someone made, not a default.
 *
 * Key is the two names sorted and joined, so order cannot matter.
 */
const ACKNOWLEDGED_NEAR = new Map([
  ['hip_abduction|hip_adduction',
   'antagonists — abduction moves the leg away, adduction toward. One letter apart and genuinely distinct.']
]);

/** Levenshtein. Small strings, exhaustive comparison, no need for anything clever. */
function distance(a, b) {
  if (a === b) return 0;
  const m = [];
  for (let i = 0; i <= b.length; i += 1) m[i] = [i];
  for (let j = 0; j <= a.length; j += 1) m[0][j] = j;
  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      m[i][j] = b[i - 1] === a[j - 1]
        ? m[i - 1][j - 1]
        : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

const SNAKE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

export default {
  id: '14',
  name: 'Exercise families are well-formed and distinct',

  run(defs, assert) {
    // --- per-row shape -----------------------------------------------------
    //
    // Non-empty is asserted rather than tolerated. familyPenalty falls back to
    // `exercise.id`, which means a blank family silently becomes a family of
    // one and never repeat-penalises. The fallback is correct defensive code
    // and a bad data contract: if this assertion ever fires, those rows have
    // been quietly exempt from the penalty.
    for (const ex of defs.exercises) {
      const fam = ex.exerciseFamily;
      assert(typeof fam === 'string' && fam.length > 0,
        `${ex.id}: exerciseFamily is empty — familyPenalty would fall back to the ` +
        `slug, making this row a family of one that never repeat-penalises`);
      if (typeof fam !== 'string' || !fam.length) continue;
      assert(SNAKE.test(fam),
        `${ex.id}: exerciseFamily "${fam}" is not snake_case — the CSV vocabulary ` +
        `is snake_case throughout (movement_pattern, tracking_type, equipment tokens)`);
    }

    const families = [...new Set(
      defs.exercises.map((e) => e.exerciseFamily).filter((f) => typeof f === 'string' && f.length)
    )].sort();

    // --- near-collision tripwire ------------------------------------------
    //
    // Every pair, both directions collapsed. 102 families is 5151 comparisons
    // and runs in single-digit milliseconds; there is no reason to sample.
    const notes2 = [];
    for (let i = 0; i < families.length; i += 1) {
      for (let j = i + 1; j < families.length; j += 1) {
        const a = families[i];
        const b = families[j];
        const d = distance(a, b);
        const key = [a, b].sort().join('|');

        assert(d !== 1 || ACKNOWLEDGED_NEAR.has(key),
          `families "${a}" and "${b}" differ by ONE character. This is what a typo ` +
          `looks like. If they are genuinely distinct movements, add ` +
          `'${key}' to ACKNOWLEDGED_NEAR in scripts/checks/14-exercise-family.js ` +
          `with the reason.`);

        if (d === 2) notes2.push(`${a} ~ ${b}`);
      }
    }

    // --- reported, never failed -------------------------------------------

    const byFamily = new Map();
    for (const ex of defs.exercises) {
      const fam = ex.exerciseFamily;
      if (typeof fam !== 'string' || !fam.length) continue;
      if (!byFamily.has(fam)) byFamily.set(fam, []);
      byFamily.get(fam).push(ex);
    }

    const singletons = [...byFamily].filter(([, rows]) => rows.length === 1).map(([f]) => f);

    const spanning = [...byFamily]
      .map(([fam, rows]) => ({ fam, patterns: [...new Set(rows.map((r) => r.pattern))].sort() }))
      .filter((x) => x.patterns.length > 1);

    if (notes2.length) {
      console.log(`  NOTE  ${notes2.length} family pair(s) two characters apart, ` +
        `all legitimate today: ${notes2.join(', ')}`);
    }
    if (singletons.length) {
      console.log(`  NOTE  ${singletons.length} singleton famil(ies): ${singletons.join(' ')}`);
    }
    for (const x of spanning) {
      console.log(`  NOTE  family "${x.fam}" spans patterns ${x.patterns.join('/')} ` +
        `— meaningful for squat/pull_up, worth review otherwise (#52)`);
    }
  }
};
