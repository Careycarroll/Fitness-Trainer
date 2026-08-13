/** ADR-009 invariants. These are the ones a hand-authoring session gets wrong. */
export default {
  id: '03', name: 'Dual-domain invariants (ADR-009)',
  run(defs, assert) {
    for (const ex of defs.exercises) {
      const loadOnly = ex.scoring === 'load';
      assert(loadOnly === (ex.timeDomain === null),
        `${ex.id}: scoring==="load" must have timeDomain null, and vice versa`);

      if (ex.timeDomain !== null) {
        assert(Number.isInteger(ex.timeDomain.minSeconds) && Number.isInteger(ex.timeDomain.maxSeconds),
          `${ex.id}: timeDomain bounds must be integers`);
        assert(ex.timeDomain.minSeconds > 0 && ex.timeDomain.minSeconds < ex.timeDomain.maxSeconds,
          `${ex.id}: timeDomain must satisfy 0 < min < max`);
      }

      assert((ex.kipAllowed !== null) === (ex.pattern === 'gymnastic'),
        `${ex.id}: kipAllowed must be non-null iff pattern is "gymnastic"`);

      if (ex.monostructural === true) {
        assert(ex.pattern === 'monostructural', `${ex.id}: monostructural=true requires pattern "monostructural"`);
        assert(ex.scoring !== 'load', `${ex.id}: monostructural work cannot be load-scored only`);
      }
      assert(typeof ex.roundsCapable === 'boolean', `${ex.id}: roundsCapable must be boolean`);

      /**
       * ADR-009 lists reps-for-time alongside work/rest and rounds, so a
       * compound reps_only row has a time component WITHOUT a timeDomain
       * window: its rep columns hold reps, not seconds, and fabricating bounds
       * to satisfy invariant 1 would be worse than admitting the pairing. The
       * interval generator prescribes the style's work window instead (#37).
       */
      assert(typeof ex.repsForTime === 'boolean', `${ex.id}: repsForTime must be boolean`);
      if (ex.repsForTime) {
        assert(ex.scoring === 'load' && ex.timeDomain === null,
          `${ex.id}: repsForTime is derived from a load-scored reps_only row, so scoring must stay "load" and timeDomain null`);
      }
      if (ex.roundsCapable) {
        assert(ex.scoring !== 'load' || ex.repsForTime,
          `${ex.id}: roundsCapable requires a time component — scoring "both", or repsForTime`);
      }
    }
  }
};
