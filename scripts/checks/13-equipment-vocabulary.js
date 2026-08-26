/**
 * Check 13 — every equipment token resolves to the DECLARED vocabulary (#58).
 *
 * THREE LAYERS:
 *   DECLARED   EQUIPMENT in _enums.js. Every token the project recognises.
 *   CATALOG    tokens some exercise needs. MUST be a subset of declared.
 *   PROFILE    tokens someone owns.      MUST be a subset of declared.
 *
 * Check 06 asserts catalog -> profile. Nothing asserted the reverse, so a typo
 * in a CSV became legitimate the moment the same typo reached equipment.json.
 * The two checks are complementary: 06 says a row is reachable, 13 says both
 * lists speak one language.
 *
 * Declared-but-unused is LEGAL and REPORTED. A token that unlocks nothing is
 * visible on every run instead of hiding for months, and the #8 editor MUST NOT
 * prune a token it cannot explain -- dropping equipment the athlete owns
 * because the catalog lags is silent data loss.
 */
import { EQUIPMENT, EQUIPMENT_ALIASES } from './_enums.js';

const ownedOf = (p) => p?.available ?? p?.equipment ?? [];

export default {
  id: '13',
  name: 'Equipment tokens resolve to the declared vocabulary',

  run(defs, assert) {
    const declared = new Set(EQUIPMENT);
    const aliases = EQUIPMENT_ALIASES ?? {};

    assert(EQUIPMENT.length > 0, 'EQUIPMENT is empty — check 13 would pass vacuously');
    assert(declared.size === EQUIPMENT.length, 'EQUIPMENT contains a duplicate token');

    for (const token of EQUIPMENT) {
      assert(/^[a-z][a-z0-9_]*$/.test(token),
        `EQUIPMENT token ${JSON.stringify(token)} is not snake_case. CSV authors ` +
        'tokens in snake_case and split_tokens() does not normalise, so a ' +
        'mismatched case silently never matches.');
    }

    // An empty alias map means the rules below never run. Said out loud: a
    // mechanism that looks enforced and is not is this repo's recurring defect.
    if (Object.keys(aliases).length === 0) {
      console.log('        NOTE  EQUIPMENT_ALIASES is empty — its rules are unexercised until the first rename');
    }

    for (const [from, entry] of Object.entries(aliases)) {
      const to = entry?.canonical ?? entry;
      assert(typeof to === 'string' && to.length > 0, `alias "${from}" declares no canonical target`);
      assert(declared.has(to), `alias "${from}" points at "${to}", which is not in EQUIPMENT`);
      assert(!declared.has(from),
        `"${from}" is BOTH an alias key and a declared token — two vocabularies pretending to be one`);
      assert(entry?.issue, `alias "${from}" names no issue that removes it`);
    }

    // ------------------------------------------------------ catalog -> declared
    const used = new Map();
    for (const ex of defs.exercises) {
      for (const t of ex.equipment ?? []) {
        if (!used.has(t)) used.set(t, []);
        used.get(t).push(ex.id);
      }
    }
    assert(used.size > 0, 'no equipment tokens in the catalog — check 13 would pass vacuously');

    for (const [token, ids] of [...used].sort()) {
      const alias = aliases[token];
      assert(!alias,
        `${ids.length} row(s) still carry the retired token "${token}" (e.g. ${ids.slice(0, 3).join(', ')})`);
      assert(declared.has(token),
        `equipment token "${token}" is not in EQUIPMENT (_enums.js). Used by ` +
        `${ids.length} row(s): ${ids.slice(0, 4).join(', ')}${ids.length > 4 ? ', …' : ''}. ` +
        'Either it is a typo, or it is a real implement that must be declared — ' +
        'build_seed.py does not validate this column, so this check is the only ' +
        'thing between a typo and a shipped seed.');
    }

    // ------------------------------------------------------ profile -> declared
    const profiles = defs.equipment ?? [];
    assert(profiles.length > 0, 'no equipment profiles found');

    for (const profile of profiles) {
      const owned = ownedOf(profile);
      assert(Array.isArray(owned), `profile "${profile.id}" exposes no token array`);
      assert(new Set(owned).size === owned.length, `profile "${profile.id}" lists a duplicate token`);

      for (const token of owned) {
        assert(!aliases[token], `profile "${profile.id}" still owns the retired token "${token}"`);
        assert(declared.has(token),
          `profile "${profile.id}" owns "${token}", which is not in EQUIPMENT (_enums.js)`);
      }

      const dead = owned.filter((t) => !used.has(t));
      if (dead.length) {
        console.log(`        NOTE  "${profile.id}" owns ${dead.length} token(s) no exercise uses: ${dead.join(', ')}`);
      }
    }

    // Reported, never failed. A catalog gap is not a false claim about a garage.
    const unused = EQUIPMENT.filter((t) => !used.has(t));
    if (unused.length) {
      console.log(`        NOTE  ${unused.length} declared token(s) unused by any exercise: ${unused.join(', ')}`);
    }
  }
};
