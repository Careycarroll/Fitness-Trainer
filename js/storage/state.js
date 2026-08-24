/**
 * Canonical persisted state: assembly, versioning, migration, export/import.
 *
 * NO IndexedDB REFERENCE IN THIS FILE. That is the point of it existing
 * separately from db.js. Node has no `indexedDB` and this project ships no DOM
 * shim, so anything that touches the browser API cannot be unit-tested here.
 * ADR-011's gate — export -> wipe -> import -> identical canonical state — is
 * the exit criterion for the whole milestone, and a gate that can only be
 * checked by hand in Safari is a gate nobody runs. Everything that decides what
 * is stored lives here and runs in `node --test`; db.js only moves bytes.
 *
 * Shapes are read from the engine, not from SPEC.md's illustration. SPEC's
 * request block omits `athlete` and says `history: []` is "empty until M6", and
 * its Program section does not mention `splitId` or `domain`. The real
 * top level is { schemaVersion, styleId, splitId, domain, seed, weeks }.
 *
 * ADR-031 governs what is retained:
 *
 *   plans         authored, durable. The app is the only copy.
 *   importedSets  a REPLACEABLE PROJECTION of the last FitNotes export.
 *                 Each import supersedes the previous one in full.
 *   exerciseMax   append-only (ADR-023). A replacement import appends newer
 *                 estimates; it never deletes older rows.
 *   meta          lastImportAt, so the UI can say how stale the plan is.
 *
 * Raw FitNotes databases are never stored here or anywhere else (ADR-031
 * ruling 3). There is deliberately no store for one.
 *
 * UI preferences are NOT here. ADR-004 assigns theme and selected profile to
 * localStorage, and app.js already does that correctly.
 */

/** Stored-record schema. Bumping this requires a migration below and a MIGRATIONS.md entry. */
export const STATE_VERSION = 2;

/** Export envelope format. Moves with STATE_VERSION; kept separate because they need not. */
export const EXPORT_FORMAT = 1;

export class StateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StateError';
  }
}

export function emptyState() {
  return {
    version: STATE_VERSION,
    meta: { lastImportAt: null },
    plans: [],
    importedSets: [],
    exerciseMax: [],
    // #8. Profiles the athlete authored. Shipped profiles stay in
    // js/data/equipment.json and are NOT copied here -- storing them would fork
    // the catalog's own data into user state, where a later fix to a shipped
    // profile could never reach it.
    equipmentProfiles: []
  };
}

/**
 * Recursively sort object keys so two structurally equal states serialise to
 * the same bytes. Arrays keep their order — a `setGroups` array is ordered by
 * ADR-027 and reordering it would change the prescription.
 *
 * This is what makes the round-trip gate checkable as an exact string
 * comparison rather than a deep-equal that tolerates key drift.
 */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
  return out;
}

/** Canonical JSON. Identical input state => identical string, always. */
export function serialise(state) {
  return JSON.stringify(canonical(state));
}

// ---------------------------------------------------------------- mutations
//
// Each returns a NEW state. Nothing mutates in place: app.js already mutates
// the program tree it renders (`group[field] = value`, `setGroups.splice`), and
// having two different mutation conventions in one codebase is how a stale
// reference gets persisted.

/**
 * Insert or replace a plan by id. A plan is the REQUEST plus the PROGRAM,
 * because they are not interchangeable: app.js edits mutate the program tree
 * directly, so replaying the request through the engine reproduces the
 * ORIGINAL draft rather than what the athlete is looking at. The request is
 * kept for provenance — which style, which seed, which profile produced this.
 */
export function putPlan(state, plan) {
  if (!plan || typeof plan !== 'object') throw new StateError('putPlan: plan must be an object');
  if (typeof plan.id !== 'string' || !plan.id) throw new StateError('putPlan: plan.id must be a non-empty string');
  if (!plan.request || typeof plan.request !== 'object') throw new StateError(`putPlan: ${plan.id} has no request`);
  if (!plan.program || typeof plan.program !== 'object') throw new StateError(`putPlan: ${plan.id} has no program`);

  const plans = state.plans.filter((p) => p.id !== plan.id);
  plans.push(plan);
  plans.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...state, plans };
}

export function removePlan(state, id) {
  return { ...state, plans: state.plans.filter((p) => p.id !== id) };
}

/**
 * ADR-031 ruling 2: imported history is REPLACED, not merged. The newest export
 * is authoritative, so an edit in FitNotes is a new value, a deletion is an
 * absence, and re-importing an unchanged export is a no-op.
 *
 * Safe for exactly one reason: the app does not own this data. Discarding every
 * imported row costs nothing because FitNotes still holds them. If an in-app
 * logger ever writes athlete-authored sets into this store, replacement starts
 * destroying data with no other copy — which is why ADR-031 rulings 1 and 2
 * depend on each other.
 */
export function replaceImportedSets(state, sets, importedAt) {
  if (!Array.isArray(sets)) throw new StateError('replaceImportedSets: sets must be an array');
  if (typeof importedAt !== 'string' || !importedAt) {
    throw new StateError('replaceImportedSets: importedAt must be an ISO string');
  }
  return {
    ...state,
    importedSets: sets.map(canonical),
    meta: { ...state.meta, lastImportAt: importedAt }
  };
}

/**
 * Append-only per ADR-023. Adding a row supersedes the previous live row for
 * that exercise rather than overwriting it, so the history of estimates
 * survives a replacement import.
 */
export function appendExerciseMax(state, row) {
  if (!row || typeof row !== 'object') throw new StateError('appendExerciseMax: row must be an object');
  for (const field of ['id', 'exerciseId', 'e1rm', 'source', 'effectiveDate']) {
    if (row[field] === undefined) throw new StateError(`appendExerciseMax: missing ${field}`);
  }
  if (!SOURCES.has(row.source)) {
    throw new StateError(`appendExerciseMax: unknown source ${JSON.stringify(row.source)}`);
  }

  const exerciseMax = state.exerciseMax.map((r) =>
    r.exerciseId === row.exerciseId && r.supersededAt == null
      ? { ...r, supersededAt: row.effectiveDate }
      : r
  );
  exerciseMax.push({ supersededAt: null, ...row });
  return { ...state, exerciseMax };
}

/** ADR-023's four sources. An unknown one throws rather than being stored (fail closed). */
const SOURCES = new Set(['entered', 'tested', 'estimated', 'estimated_low_confidence']);

// ------------------------------------------------- the normalised set record
//
// docs/INTERCHANGE.md section 2 is the specification; this is the enforcement.
// One row per completed set. Every measurement field is nullable because which
// ones are populated is decided by the exercise's tracking type, not by the
// record.

/** Exactly the fields a row may carry. Anything else throws - see below. */
const SET_FIELDS = Object.freeze([
  'id', 'source',
  'exerciseId', 'sourceExerciseId', 'sourceExerciseName',
  'date', 'setIndex',
  'weight', 'weightUnit', 'reps', 'seconds', 'distance', 'distanceUnit',
  'rpe', 'notes'
]);

const WEIGHT_UNITS = new Set(['kg', 'lb']);
const DISTANCE_UNITS = new Set(['km', 'mi', 'm']);
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isNullableNumber = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
const isNullableString = (v) => v === null || (typeof v === 'string' && v.length > 0);

/**
 * Validate one imported set. Throws on the first problem, naming the row.
 *
 * UNKNOWN KEYS THROW. Ignoring an extra field lets it be persisted, then read,
 * then depended on, without ever appearing in MIGRATIONS.md. Adding a field is
 * now deliberate: name it here, bump STATE_VERSION, log it.
 */
export function validateImportedSet(row, index = 0) {
  const at = (msg) => new StateError(`importedSets[${index}]: ${msg}`);

  if (!row || typeof row !== 'object' || Array.isArray(row)) throw at('must be an object');

  for (const key of Object.keys(row)) {
    if (!SET_FIELDS.includes(key)) {
      throw at(`unknown field ${JSON.stringify(key)}. Add it to SET_FIELDS and bump STATE_VERSION`);
    }
  }

  if (typeof row.id !== 'string' || !row.id) throw at('id must be a non-empty string');
  if (typeof row.source !== 'string' || !row.source) throw at('source must be a non-empty string');

  // Nullable BY DESIGN. An unmapped exercise imports anyway and stays
  // reviewable (#24); rejecting null would discard the rows that requirement
  // exists to keep. The source identity fields are what make review possible.
  if (row.exerciseId !== null && !(typeof row.exerciseId === 'string' && row.exerciseId))
    throw at('exerciseId must be a catalog slug or null');
  // Unreachable as first written: the guard called isNullableString(x ?? null),
  // which returns TRUE for null, so the negation was always false and a row with
  // no source identity at all was accepted. That is precisely the row that can
  // never be reviewed. The test caught it (#26).
  if (row.exerciseId === null && row.sourceExerciseId == null && row.sourceExerciseName == null)
    throw at('an unresolved row must carry sourceExerciseId or sourceExerciseName, or it cannot be reviewed');

  if (!(typeof row.date === 'string' && LOCAL_DATE.test(row.date)))
    throw at(`date must be a local YYYY-MM-DD calendar date, got ${JSON.stringify(row.date)}`);
  if (!Number.isInteger(row.setIndex) || row.setIndex < 1)
    throw at('setIndex must be an integer >= 1');

  for (const field of ['weight', 'reps', 'seconds', 'distance', 'rpe']) {
    if (field in row && !isNullableNumber(row[field])) throw at(`${field} must be a finite number or null`);
  }

  if (row.weightUnit != null && !WEIGHT_UNITS.has(row.weightUnit))
    throw at(`weightUnit must be kg, lb, or null, got ${JSON.stringify(row.weightUnit)}`);
  if (row.distanceUnit != null && !DISTANCE_UNITS.has(row.distanceUnit))
    throw at(`distanceUnit must be km, mi, m, or null, got ${JSON.stringify(row.distanceUnit)}`);

  // A number without its unit is not a measurement. Units are stored AS LOGGED
  // and never converted, so a missing one cannot be recovered later.
  if (row.weight != null && row.weightUnit == null) throw at('weight requires weightUnit');
  if (row.distance != null && row.distanceUnit == null) throw at('distance requires distanceUnit');

  if (row.notes != null && typeof row.notes !== 'string') throw at('notes must be a string or null');

  return row;
}

/** Current working max for an exercise: the latest non-superseded row, or null. */
export function currentMax(state, exerciseId) {
  const live = state.exerciseMax.filter((r) => r.exerciseId === exerciseId && r.supersededAt == null);
  if (!live.length) return null;
  return live.reduce((best, r) => (r.effectiveDate > best.effectiveDate ? r : best));
}

// ------------------------------------------------------------ export/import

/**
 * ADR-011 ships export with the storage layer, not after it. `exportedAt` sits
 * in the ENVELOPE rather than in `state`, so it cannot affect the round trip:
 * the gate compares canonical state, and a timestamp inside it would make
 * export -> import -> export differ on every run for no reason.
 */
export function toExport(state, exportedAt = null) {
  validate(state);
  return {
    formatVersion: EXPORT_FORMAT,
    exportedAt,
    state: canonical(state)
  };
}

export function toExportJSON(state, exportedAt = null) {
  return JSON.stringify(toExport(state, exportedAt), null, 2);
}

/**
 * Parse, migrate forward, validate. Fails closed on anything it does not
 * understand — a corrupt or future export throws rather than being partially
 * applied, which is #35's "corrupt or unsupported imports fail safely".
 *
 * There is no backward migration by design (MIGRATIONS.md rule 2): export files
 * are upgraded on import, never downgraded. A file from a newer build is
 * therefore refused rather than guessed at.
 */
export function fromImportJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new StateError(`import is not valid JSON: ${err.message}`);
  }
  return fromImport(parsed);
}

export function fromImport(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new StateError('import: expected an object envelope');
  }
  const { formatVersion, state } = envelope;
  if (!Number.isInteger(formatVersion)) {
    throw new StateError('import: envelope has no integer formatVersion');
  }
  if (formatVersion > EXPORT_FORMAT) {
    throw new StateError(
      `import: format ${formatVersion} is newer than this build understands (${EXPORT_FORMAT}). ` +
      'Export files upgrade on import and never downgrade, so this file cannot be read here.'
    );
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new StateError('import: envelope has no state object');
  }

  const migrated = migrate(canonical(state));
  validate(migrated);
  return migrated;
}

/**
 * Forward migrations keyed on the version being LEFT. Empty at v1 by
 * definition; the first entry appears with the first stored-shape change after
 * this lands, per MIGRATIONS.md.
 */
const MIGRATIONS = Object.freeze({
  /**
   * 1 -> 2 (#8): user-authored equipment profiles.
   *
   * Additive. A v1 state has none, so an empty array is the whole migration --
   * no stored value is reinterpreted and nothing can be lost. EXPORT_FORMAT
   * deliberately stays 1: the envelope did not change, and migrate() upgrades
   * the state inside it, so a v1 export still imports here and a file written
   * here still opens in a build that predates this.
   */
  1: (s) => ({ ...s, version: 2, equipmentProfiles: [] }),
});

export function migrate(state) {
  let out = state;
  let guard = 0;
  while (out.version !== STATE_VERSION) {
    if (!Number.isInteger(out.version)) throw new StateError('migrate: state has no integer version');
    if (out.version > STATE_VERSION) {
      throw new StateError(`migrate: state version ${out.version} is newer than ${STATE_VERSION}`);
    }
    const step = MIGRATIONS[out.version];
    if (!step) throw new StateError(`migrate: no migration from version ${out.version}`);
    out = step(out);
    if (++guard > 50) throw new StateError('migrate: migration chain did not terminate');
  }
  return out;
}

/**
 * Structural validation. Deliberately shallow on plans and sets: this checks
 * that the container is what it claims to be, not that a program is
 * well-formed. The engine owns program validity, and duplicating that here
 * would be two places to update on the next shape change.
 */
export function validate(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new StateError('validate: state must be an object');
  }
  if (state.version !== STATE_VERSION) {
    throw new StateError(`validate: version ${state.version} !== ${STATE_VERSION}`);
  }
  if (!state.meta || typeof state.meta !== 'object') throw new StateError('validate: meta must be an object');
  if (!('lastImportAt' in state.meta)) throw new StateError('validate: meta.lastImportAt missing');

  for (const key of ['plans', 'importedSets', 'exerciseMax', 'equipmentProfiles']) {
    if (!Array.isArray(state[key])) throw new StateError(`validate: ${key} must be an array`);
  }

  // Every imported row, not just the array. Until this existed, whatever the
  // first importer wrote became the format (#26).
  state.importedSets.forEach(validateImportedSet);

  const seen = new Set();
  for (const plan of state.plans) {
    if (!plan || typeof plan.id !== 'string' || !plan.id) throw new StateError('validate: a plan has no id');
    if (seen.has(plan.id)) throw new StateError(`validate: duplicate plan id ${plan.id}`);
    seen.add(plan.id);
    if (!plan.request || typeof plan.request !== 'object') throw new StateError(`validate: plan ${plan.id} has no request`);
    if (!plan.program || typeof plan.program !== 'object') throw new StateError(`validate: plan ${plan.id} has no program`);
  }

  for (const row of state.exerciseMax) {
    if (!row || typeof row.exerciseId !== 'string') throw new StateError('validate: exerciseMax row has no exerciseId');
    if (!SOURCES.has(row.source)) throw new StateError(`validate: exerciseMax row has unknown source ${JSON.stringify(row.source)}`);
  }

  return state;
}

// STORES is NOT declared here. db.js owns the object-store layout because it is
// the only module that creates one. The copy that used to sit here claimed
// `meta` was keyed on `key` and declared four indexes db.js does not create --
// under a comment asserting the two could not drift. They had already drifted,
// and nothing imported either, so nothing failed.

// ---------------------------------------------------------- generic CSV (#26)

/** Column order is the contract. Changing it is a format change, not a tidy-up. */
export const CSV_COLUMNS = SET_FIELDS;

/**
 * RFC 4180. `notes` is free text typed on a phone, so a comma, a quote or a
 * newline in it is ordinary rather than exotic - and an unquoted one silently
 * shifts every later column of that row.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';       // empty, never 0 or NULL
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * One row per completed set, for spreadsheets and migration - NOT for FitNotes,
 * which gets its own adapter (#25). Unresolved rows are included with an empty
 * exerciseId: omitting them would make the file disagree with the store.
 *
 * Deterministic order for the same reason generation is (ADR-002): a diffable
 * file. Sorted by date, then exerciseId, then setIndex, with unresolved rows
 * last within a date rather than first, so a null does not sort above real work.
 */
export function toCSV(state) {
  const rows = [...state.importedSets].sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1
      : (a.exerciseId ?? '\uffff') < (b.exerciseId ?? '\uffff') ? -1
      : (a.exerciseId ?? '\uffff') > (b.exerciseId ?? '\uffff') ? 1
      : a.setIndex - b.setIndex));

  return [
    CSV_COLUMNS.join(','),
    ...rows.map((row) => CSV_COLUMNS.map((col) => csvCell(row[col])).join(','))
  ].join('\n') + '\n';
}
