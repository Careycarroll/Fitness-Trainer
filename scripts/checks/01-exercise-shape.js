import { PATTERNS, LOAD_TYPES, SCORING, MUSCLES } from './_enums.js';

const REQUIRED = ['id','name','pattern','loadType','equipment','primaryMuscles','secondaryMuscles','fatigueCost','skill','defaultRIR','restSeconds','warmupRequired','unilateral','isCompound','trackingType','scoring','timeDomain','roundsCapable','repsForTime','kipAllowed','monostructural','skillGate'];

export default {
  id: '01', name: 'Exercise record shape & enums',
  run(defs, assert) {
    for (const ex of defs.exercises) {
      for (const key of REQUIRED) {
        assert(Object.prototype.hasOwnProperty.call(ex, key), `${ex.id ?? '<no id>'}: missing field "${key}"`);
      }
      assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(ex.id), `${ex.id}: id must be kebab-case`);
      assert(PATTERNS.includes(ex.pattern), `${ex.id}: invalid pattern "${ex.pattern}"`);
      assert(LOAD_TYPES.includes(ex.loadType), `${ex.id}: invalid loadType "${ex.loadType}"`);
      assert(SCORING.includes(ex.scoring), `${ex.id}: invalid scoring "${ex.scoring}"`);
      assert(ex.primaryMuscles.length >= 1, `${ex.id}: needs at least one primary muscle`);
      for (const m of [...ex.primaryMuscles, ...ex.secondaryMuscles]) {
        assert(MUSCLES.includes(m), `${ex.id}: invalid muscleGroup "${m}"`);
      }
      assert(Number.isInteger(ex.fatigueCost) && ex.fatigueCost >= 1 && ex.fatigueCost <= 5, `${ex.id}: fatigueCost must be int 1-5`);
      assert(Number.isInteger(ex.skill) && ex.skill >= 1 && ex.skill <= 5, `${ex.id}: skill must be int 1-5`);
      assert(Number.isInteger(ex.defaultRIR) && ex.defaultRIR >= 0 && ex.defaultRIR <= 5, `${ex.id}: defaultRIR must be int 0-5`);
      assert(Number.isInteger(ex.restSeconds) && ex.restSeconds > 0, `${ex.id}: restSeconds must be a positive int`);
      assert(typeof ex.warmupRequired === 'boolean', `${ex.id}: warmupRequired must be boolean`);
      assert(typeof ex.unilateral === 'boolean', `${ex.id}: unilateral must be boolean`);
      assert(typeof ex.repsForTime === 'boolean', `${ex.id}: repsForTime must be boolean`);
    }
  }
};
