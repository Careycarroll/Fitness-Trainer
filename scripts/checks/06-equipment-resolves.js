export default {
  id: '06', name: 'Equipment tokens resolve to at least one profile',
  run(defs, assert) {
    const allTokens = new Set(defs.equipment.flatMap((p) => p.available));
    for (const ex of defs.exercises) {
      for (const token of ex.equipment) {
        assert(allTokens.has(token), `${ex.id}: equipment token "${token}" is in no profile`);
      }
      const reachable = defs.equipment.some((p) => ex.equipment.every((t) => p.available.includes(t)));
      assert(reachable, `${ex.id}: no equipment profile can satisfy this exercise`);
    }
  }
};
