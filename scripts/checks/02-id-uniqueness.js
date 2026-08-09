export default {
  id: '02', name: 'ID uniqueness across all definition files',
  run(defs, assert) {
    const seen = new Set();
    for (const ex of defs.exercises) {
      assert(!seen.has(ex.id), `duplicate exercise id "${ex.id}"`);
      seen.add(ex.id);
    }
    const styleIds = new Set();
    for (const s of defs.styles) {
      assert(!styleIds.has(s.id), `duplicate style id "${s.id}"`);
      styleIds.add(s.id);
    }
    const splitIds = new Set();
    for (const s of defs.splits) {
      assert(!splitIds.has(s.id), `duplicate split id "${s.id}"`);
      splitIds.add(s.id);
    }
  }
};
