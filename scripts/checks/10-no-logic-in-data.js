/**
 * ADR-012 warning-sign list, enforced mechanically.
 *
 * This check is the whole point of the ADR. It catches the moment someone starts building a
 * configuration language inside JSON — the inner-platform effect — before it ships and becomes
 * a permanent schema commitment.
 */
const FORBIDDEN_KEYS = ['if', 'when', 'then', 'else', 'unless', 'condition', 'conditions', 'op', 'expr', 'formula', 'eval', 'fn', 'callback', 'handler'];
const EXPRESSION_RE = /(?:^|\s)(?:[a-zA-Z_$][\w$]*\s*(?:[<>]=?|===?|!==?)\s*[-\w.'"]+|.+\s(?:&&|\|\|)\s.+)/;

export default {
  id: '10', name: 'No logic smuggled into definition files (ADR-012)',
  run(defs, assert, rawFiles) {
    for (const [filename, raw] of Object.entries(rawFiles)) {
      walk(raw, `${filename}`, assert);
    }
  }
};

function walk(node, path, assert) {
  if (node === null || typeof node !== 'object') {
    if (typeof node === 'string') {
      assert(!EXPRESSION_RE.test(node),
        `${path}: value looks like a stored expression ("${truncate(node)}") — logic belongs in code (ADR-012)`);
    }
    return;
  }
  if (Array.isArray(node)) {
    const opObjects = node.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && ('op' in x || 'operation' in x));
    assert(opObjects.length === 0, `${path}: array of operation objects detected — this is an interpreter, not data (ADR-012)`);
    node.forEach((child, i) => walk(child, `${path}[${i}]`, assert));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    assert(!FORBIDDEN_KEYS.includes(key), `${path}.${key}: forbidden control-flow key "${key}" (ADR-012 warning sign)`);
    walk(value, `${path}.${key}`, assert);
  }
}

const truncate = (s) => (s.length > 40 ? `${s.slice(0, 40)}...` : s);
