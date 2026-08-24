/**
 * IndexedDB layer (ADR-004, ADR-011, ADR-031).
 *
 * THIS FILE MOVES BYTES. It decides nothing.
 *
 * Everything about WHAT is stored — canonical form, versioning, migration,
 * validation, export/import envelopes — lives in `state.js`, which has no
 * `indexedDB` reference and is therefore testable in `node --test`. That split
 * is why ADR-011's gate (export -> wipe -> import -> identical canonical state)
 * is 35 assertions in CI rather than a manual check in Safari. Do not move
 * decisions into this file; they stop being tested the moment you do.
 *
 * The previous sketch declared `sessions`, `sets`, `programs`. A `sets` store
 * keyed on `sessionId` is a LOGGER's schema, and ADR-031 ruling 1 excludes an
 * in-app logger. The stores below are ADR-031's.
 *
 * `prefs` is deliberately absent. ADR-004 assigns theme and selected equipment
 * profile to `localStorage`, and app.js already does that correctly.
 */
import { STATE_VERSION, emptyState, validate, StateError } from './state.js';

export const DB_NAME = 'training-planner';

/**
 * Moves with the STORE LAYOUT, not with the record shape. A field added inside a
 * plan bumps STATE_VERSION in state.js and migrates there; a new object store or
 * index bumps this and adds a case to `upgrade()`. Conflating them is how a
 * migration runs twice or not at all (MIGRATIONS.md rule 2).
 */
export const DB_VERSION = 2;

/**
 * One row per store, `id: 'singleton'`, holding that slice of canonical state.
 *
 * Not one row per plan. The gate compares CANONICAL STATE, so the unit that has
 * to round-trip byte-identically is the whole slice; splitting plans into rows
 * would mean reassembling them in an order IndexedDB does not guarantee, and
 * ADR-002's determinism argument applies to persistence too. `plans` is an
 * ordered array inside one row, sorted by id in state.js.
 *
 * Indexes are therefore pointless today and are not declared. When history
 * import lands (#24) and "last N sessions for this exercise" becomes the hot
 * query ADR-004 describes, `importedSets` moves to row-per-set with an
 * `exerciseId` index — that is a DB_VERSION bump and an `upgrade()` case, which
 * is exactly the seam this layout leaves open.
 */
export const STORES = Object.freeze(['meta', 'plans', 'importedSets', 'exerciseMax', 'equipmentProfiles']);

const SINGLETON = 'singleton';

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

/** Is IndexedDB usable at all? Private-mode Safari exposes it and then throws. */
export function available() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

let dbPromise = null;

/**
 * Open, running `upgrade()` if the layout version moved. Cached: concurrent
 * callers share one connection, because two parallel `open()` calls during an
 * upgrade deadlock on the version-change transaction.
 */
export function open() {
  if (!available()) {
    return Promise.reject(new StorageError('IndexedDB is unavailable in this browser context'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      dbPromise = null;
      reject(new StorageError('indexedDB.open threw', err));
      return;
    }

    request.onupgradeneeded = (event) => {
      try {
        upgrade(request.result, event.oldVersion, request.transaction);
      } catch (err) {
        // Abort rather than leave a half-migrated database. The transaction's
        // onabort rejects this promise; a partially upgraded store is the one
        // state from which nothing can recover.
        request.transaction?.abort();
        throw err;
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // A second tab opening a newer version blocks this connection's upgrade
      // forever. Close on demand so the newer tab wins rather than both hanging.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(new StorageError('failed to open the database', request.error));
    };

    request.onblocked = () => {
      dbPromise = null;
      reject(new StorageError('another tab holds an older version of this database open'));
    };
  });

  return dbPromise;
}

/**
 * Forward-only, per MIGRATIONS.md rule 2. `oldVersion === 0` is a fresh
 * database, not a migration.
 *
 * Each case falls through, so a jump from 1 to 3 runs 2 then 3. That is
 * deliberate: a switch with breaks silently skips intermediate steps for anyone
 * who missed a release, and this app has no server to backfill from.
 */
function upgrade(db, oldVersion, _transaction) {
  switch (oldVersion) {
    case 0:
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      break;

    // case 1: -> 2 (#8) added the `equipmentProfiles` store. No case body is
    // needed: the loop above creates any store in STORES that does not already
    // exist, so adding the name and bumping DB_VERSION is the whole change.
    // case 2: // -> 3. Add stores/indexes here, then bump DB_VERSION and log it
    //   in docs/MIGRATIONS.md. Do not reshape records here; that is state.js.
    //   falls through

    default:
      if (oldVersion > DB_VERSION) {
        throw new StorageError(
          `database version ${oldVersion} is newer than this build understands (${DB_VERSION})`
        );
      }
  }
}

/** Promisify one transaction. Rejects on abort, so a failed write is never silent. */
function run(db, storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (err) {
      reject(new StorageError(`could not open a ${mode} transaction`, err));
      return;
    }

    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(new StorageError('transaction aborted', tx.error));
    tx.onerror = () => reject(new StorageError('transaction failed', tx.error));

    try {
      result = work(tx);
    } catch (err) {
      tx.abort();
      reject(new StorageError('transaction body threw', err));
    }
  });
}

const get = (store, key) =>
  new Promise((resolve, reject) => {
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/**
 * Read the whole canonical state.
 *
 * A missing row is `emptyState()`'s slice, not an error: a fresh install and an
 * evicted database are indistinguishable here, and ADR-004 says eviction is
 * expected behaviour on iOS Safari rather than a fault. `validate()` still runs,
 * so a corrupt row throws instead of half-loading (#35: fail safely).
 */
export async function load() {
  const db = await open();
  const base = emptyState();

  const rows = await run(db, STORES, 'readonly', (tx) => {
    const out = {};
    for (const name of STORES) {
      get(tx.objectStore(name), SINGLETON).then((row) => { out[name] = row; });
    }
    return out;
  });

  const state = {
    version: rows.meta?.version ?? STATE_VERSION,
    meta: rows.meta?.value ?? base.meta,
    plans: rows.plans?.value ?? base.plans,
    importedSets: rows.importedSets?.value ?? base.importedSets,
    exerciseMax: rows.exerciseMax?.value ?? base.exerciseMax
  };

  validate(state);
  return state;
}

/**
 * Write the whole canonical state in ONE transaction.
 *
 * Per-slice saves are the tempting optimisation and the wrong one: a write that
 * lands `plans` but not `meta` produces a state that never existed, and the
 * round-trip gate would pass on each slice while the whole was inconsistent.
 * One transaction means the stored state is always a state the app produced.
 */
export async function save(state) {
  validate(state);
  const db = await open();

  await run(db, STORES, 'readwrite', (tx) => {
    tx.objectStore('meta').put({ id: SINGLETON, version: state.version, value: state.meta });
    for (const name of ['plans', 'importedSets', 'exerciseMax']) {
      tx.objectStore(name).put({ id: SINGLETON, value: state[name] });
    }
  });
}

/**
 * Clear every store, leaving the database itself in place.
 *
 * This is the "wipe" in ADR-011's gate, and it is the operation an athlete
 * reaches for after an export. `deleteDatabase()` would be tidier and is
 * deliberately not used: it blocks on any other open connection, so on a phone
 * with the app open in two tabs it hangs instead of wiping.
 */
export async function wipe() {
  const db = await open();
  await run(db, STORES, 'readwrite', (tx) => {
    for (const name of STORES) tx.objectStore(name).clear();
  });
}

/** Close the cached connection. Tests and tab teardown; not part of normal use. */
export function close() {
  if (!dbPromise) return;
  dbPromise.then((db) => db.close()).catch(() => {});
  dbPromise = null;
}

/**
 * Save without letting a storage failure break the UI.
 *
 * Persistence is a background nicety; generation is the product. A quota error
 * or a private-mode browser must not turn an edit into an exception the athlete
 * sees. Returns the error instead of throwing so a caller can surface "not
 * saved" honestly — which app.js must do, because silent data loss is worse
 * than a visible warning (ADR-004: there is no server to fall back on).
 */
export async function trySave(state) {
  try {
    await save(state);
    return { ok: true, error: null };
  } catch (err) {
    if (err instanceof StateError) throw err;   // our bug, not the browser's
    return { ok: false, error: err };
  }
}
