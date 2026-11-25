/**
 * Browser IndexedDB persistence wrapper for the standalone SQLite AppDB
 * (ADR-033, ADR-011).
 *
 * Stores the exported SQLite binary (`Uint8Array`) in IndexedDB so all
 * logged workouts, PRs, meals, and settings survive reloads offline.
 * In Phase 1 Capacitor, this pairs with native `.db` file backup/restore.
 */

import { createAppDb, openAppDb, exportAppDb } from './app-db.js';

const IDB_NAME = 'fitness-trainer-appdb';
const IDB_VERSION = 1;
const STORE_NAME = 'sqlite_files';
const PRIMARY_KEY = 'primary';

function openIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open AppDB IndexedDB'));
  });
}

async function readSavedBuffer() {
  const idb = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(PRIMARY_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    idb.close();
  }
}

async function writeSavedBuffer(bytes) {
  const idb = await openIdb();
  try {
    await new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(bytes, PRIMARY_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}

/**
 * Load the persisted AppDB from IndexedDB (refreshing shipped catalog),
 * or initialize a fresh AppDB and persist it.
 *
 * @param {Array<object>} [catalogExercises]
 * @returns {Promise<object>} sql.js Database instance
 */
export async function loadPersistedAppDb(catalogExercises = []) {
  try {
    const saved = await readSavedBuffer();
    if (saved && saved.byteLength > 0) {
      return await openAppDb(saved, catalogExercises);
    }
  } catch {
    // Fall back to fresh DB if IndexedDB is unavailable (e.g. private browsing)
  }
  const db = await createAppDb(catalogExercises);
  try {
    await savePersistedAppDb(db);
  } catch {
    // Ignore persistence failure in restricted browser contexts
  }
  return db;
}

/**
 * Persist the current AppDB binary to IndexedDB.
 *
 * @param {object} db sql.js Database instance
 */
export async function savePersistedAppDb(db) {
  const bytes = exportAppDb(db);
  await writeSavedBuffer(bytes);
}

/**
 * Restore AppDB from an uploaded `.db` backup buffer, refresh catalog, and save.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {Array<object>} [catalogExercises]
 * @returns {Promise<object>} sql.js Database instance
 */
export async function replacePersistedAppDbFromBuffer(buffer, catalogExercises = []) {
  const db = await openAppDb(buffer, catalogExercises);
  await savePersistedAppDb(db);
  return db;
}
