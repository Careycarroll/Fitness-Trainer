import { MUSCLES } from './_enums.js';

export default {
  id: '08', name: 'Volume landmarks cover every referenced muscle group',
  run(defs, assert) {
    for (const m of MUSCLES) {
      assert(Object.prototype.hasOwnProperty.call(defs.landmarks, m), `landmarks missing muscle group "${m}"`);
    }
    for (const [m, l] of Object.entries(defs.landmarks)) {
      assert(MUSCLES.includes(m), `landmarks has unknown muscle group "${m}"`);
      assert(l.mv <= l.mev && l.mev <= l.mav && l.mav <= l.mrv, `${m}: landmarks must satisfy mv <= mev <= mav <= mrv`);
    }
    // stabilises included: a landmark must exist for every muscle the catalog
    // names, even one counted at zero. An unlandmarked token is a typo (#44).
    const referenced = new Set(defs.exercises.flatMap(
      (e) => [...e.primaryMuscles, ...e.secondaryMuscles, ...e.stabilises]));
    for (const m of referenced) {
      assert(defs.landmarks[m] !== undefined, `muscle "${m}" is used by an exercise but has no landmark`);
    }
  }
};
