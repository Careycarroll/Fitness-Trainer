import { ROM_BIAS, ANGLE, GRIP, HEAD_BIAS, STABILITY_MIN, STABILITY_MAX } from './_enums.js';

/**
 * Check 15 — the variant axes are well-formed.
 *
 * WHY THIS EXISTS
 *
 * `emphasis` was authored on 188 of 307 rows and validated by NOTHING. It was
 * not in check 01's REQUIRED list and appeared nowhere in scripts/. So
 * `strech_bias` would have shipped silently, and the 10-value vocabulary was
 * convention rather than contract.
 *
 * These four columns replace it. They land WITH their validator, in the same
 * commit, precisely so that mistake is not repeated four times over.
 *
 * NULL IS LEGAL AND MEANS NOT ASSESSED
 *
 * A row with no `angle` is not a flat press — it is a row where the axis does
 * not apply, or has not been judged. That distinction is why null is permitted
 * and why no consumer may read null as a value.
 *
 * The count of assessed rows per axis is REPORTED, mirroring check 13's
 * declared-but-unused rule: sparse population is information the author should
 * see, not an error.
 */
export default {
  id: '15',
  name: 'Variant axes and derived stability',

  run(defs, assert) {
    const seen = { romBias: 0, angle: 0, grip: 0, headBias: 0 };

    for (const ex of defs.exercises) {
      for (const [field, vocab] of [
        ['romBias', ROM_BIAS], ['angle', ANGLE],
        ['grip', GRIP], ['headBias', HEAD_BIAS]
      ]) {
        const v = ex[field];
        if (v == null) continue;
        seen[field] += 1;
        assert(vocab.includes(v),
          `${ex.id}: ${field} "${v}" is not in the declared vocabulary ` +
          `[${vocab.join(', ')}]. Add it to _enums.js in the same commit as ` +
          `the rows that use it, or fix the typo.`);
      }

      // DERIVED, so a bad value is a build_seed.py bug rather than a data one.
      // Asserted anyway: the derivation is a lookup table and a missing
      // loadType key would silently yield undefined.
      assert(Number.isInteger(ex.stability)
        && ex.stability >= STABILITY_MIN && ex.stability <= STABILITY_MAX,
        `${ex.id}: stability must be an integer ${STABILITY_MIN}-${STABILITY_MAX}, ` +
        `got ${JSON.stringify(ex.stability)} — check STABILITY_BY_LOAD_TYPE in build_seed.py`);
    }

    const total = defs.exercises.length;
    console.log(`  NOTE  axes assessed: ` +
      Object.entries(seen).map(([k, n]) => `${k} ${n}/${total}`).join(', '));

    const byStability = {};
    for (const ex of defs.exercises) {
      byStability[ex.stability] = (byStability[ex.stability] ?? 0) + 1;
    }
    console.log(`  NOTE  stability spread: ` +
      Object.entries(byStability).sort().map(([k, n]) => `${k}:${n}`).join(' '));
  }
};
