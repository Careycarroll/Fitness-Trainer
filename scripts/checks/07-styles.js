import { PATTERNS, DOMAINS } from './_enums.js';

export default {
  id: '07', name: 'Style records & domain routing (ADR-010)',
  run(defs, assert) {
    for (const s of defs.styles) {
      assert(DOMAINS.includes(s.domain), `${s.id}: domain must be one of ${DOMAINS.join('|')}`);
      assert(Number.isInteger(s.tier) && s.tier >= 1 && s.tier <= 3, `${s.id}: tier must be 1-3`);
      assert(Number.isInteger(s.fatigueBudget) && s.fatigueBudget > 0, `${s.id}: fatigueBudget must be a positive int`);
      assert(s.accessoryRatio >= 0 && s.accessoryRatio <= 1, `${s.id}: accessoryRatio must be 0-1`);

      for (const p of Object.keys(s.patternEmphasis)) {
        assert(PATTERNS.includes(p), `${s.id}: patternEmphasis has unknown pattern "${p}"`);
      }
      for (const p of PATTERNS) {
        assert(Object.prototype.hasOwnProperty.call(s.patternEmphasis, p),
          `${s.id}: patternEmphasis missing pattern "${p}" (must be explicit, including 0)`);
      }

      if (s.domain === 'load') {
        assert(s.workRest === null, `${s.id}: load-domain style must set workRest null`);
        assert(s.repRange && s.repRange.min > 0 && s.repRange.min <= s.repRange.max, `${s.id}: invalid repRange`);
        assert(s.intensityBand && s.intensityBand.min > 0 && s.intensityBand.min <= s.intensityBand.max && s.intensityBand.max <= 1,
          `${s.id}: intensityBand must satisfy 0 < min <= max <= 1`);
        assert(s.setsPerMainLift && s.setsPerMainLift.min <= s.setsPerMainLift.max, `${s.id}: invalid setsPerMainLift`);
      } else {
        assert(s.workRest !== null, `${s.id}: time-domain style must define workRest`);
        assert(s.workRest.workSeconds > 0 && s.workRest.rounds > 0, `${s.id}: workRest needs positive workSeconds and rounds`);
        assert(s.repRange === null && s.intensityBand === null, `${s.id}: time-domain style must null out load fields`);
      }
    }
  }
};
