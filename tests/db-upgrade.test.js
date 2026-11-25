import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from '../js/storage/db.js';
import {
  STATE_VERSION, emptyState, putVolumeLandmark, removeVolumeLandmark, StateError
} from '../js/storage/state.js';
import { resolveLandmarks } from '../js/engine/volume.js';

const here = dirname(fileURLToPath(import.meta.url));
const shippedLandmarks = JSON.parse(readFileSync(join(here, '..', 'js', 'data', 'landmarks.json'), 'utf8'));

/** Minimal zero-dependency in-memory IndexedDB shim to exercise db.js upgrade/load/save/wipe (#59). */
function installIndexedDbShim({ initialVersion = 0, initialStores = {} } = {}) {
  let version = initialVersion;
  const stores = new Map();
  for (const [name, rows] of Object.entries(initialStores)) {
    stores.set(name, new Map(Object.entries(rows)));
  }

  const fakeIdb = {
    open(_name, targetVersion) {
      const req = { result: null, error: null, transaction: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        const fakeDb = {
          objectStoreNames: { contains: (n) => stores.has(n) },
          createObjectStore: (n) => { if (!stores.has(n)) stores.set(n, new Map()); },
          onversionchange: null,
          close() {},
          transaction(storeNames) {
            for (const n of storeNames) {
              if (!stores.has(n)) throw new Error(`Object store not found: ${n}`);
            }
            const tx = {
              error: null,
              oncomplete: null,
              onabort: null,
              onerror: null,
              abort() { if (tx.onabort) tx.onabort(); },
              objectStore(n) {
                const map = stores.get(n);
                return {
                  get(k) {
                    const r = { result: map.get(k), onsuccess: null, onerror: null };
                    queueMicrotask(() => r.onsuccess && r.onsuccess());
                    return r;
                  },
                  put(v) {
                    map.set(v.id, structuredClone(v));
                    const r = { result: v.id, onsuccess: null, onerror: null };
                    queueMicrotask(() => r.onsuccess && r.onsuccess());
                    return r;
                  },
                  clear() {
                    map.clear();
                    const r = { result: undefined, onsuccess: null, onerror: null };
                    queueMicrotask(() => r.onsuccess && r.onsuccess());
                    return r;
                  }
                };
              }
            };
            setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
            return tx;
          }
        };
        req.result = fakeDb;
        if (targetVersion > version) {
          const old = version;
          version = targetVersion;
          req.transaction = fakeDb.transaction([]);
          if (req.onupgradeneeded) req.onupgradeneeded({ oldVersion: old });
        }
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    }
  };

  globalThis.indexedDB = fakeIdb;
  return { stores };
}

test('db.js upgrades from v3 -> v4, migrates v3 state -> v4, and round-trips volumeLandmarks (#59, #67)', async () => {
  db.close();
  installIndexedDbShim({
    initialVersion: 3,
    initialStores: {
      meta: { singleton: { id: 'singleton', version: 3, value: { lastImportAt: null } } },
      plans: { singleton: { id: 'singleton', value: [] } },
      importedSets: { singleton: { id: 'singleton', value: [] } },
      exerciseMax: { singleton: { id: 'singleton', value: [] } },
      equipmentProfiles: { singleton: { id: 'singleton', value: [] } },
      importedDayNotes: { singleton: { id: 'singleton', value: [] } },
      sessionNotes: { singleton: { id: 'singleton', value: [] } }
    }
  });

  const loaded = await db.load();
  assert.equal(loaded.version, STATE_VERSION);
  assert.deepEqual(loaded.volumeLandmarks, []);

  const updated = putVolumeLandmark(loaded, { muscle: 'quads', mv: 6, mev: 10, mav: 18, mrv: 24 });
  await db.save(updated);

  const reloaded = await db.load();
  assert.equal(reloaded.volumeLandmarks.length, 1);
  assert.equal(reloaded.volumeLandmarks[0].mrv, 24);

  const cleared = removeVolumeLandmark(reloaded, 'quads');
  assert.equal(cleared.volumeLandmarks.length, 0);

  await db.wipe();
  const afterWipe = await db.load();
  assert.deepEqual(afterWipe, emptyState());
  db.close();
  delete globalThis.indexedDB;
});

test('volumeLandmarks enforce mv <= mev <= mav <= mrv and resolve over shipped defaults (#67)', () => {
  assert.throws(
    () => putVolumeLandmark(emptyState(), { muscle: 'quads', mv: 10, mev: 8, mav: 16, mrv: 20 }),
    StateError
  );

  const merged = resolveLandmarks(shippedLandmarks, [{ muscle: 'quads', mv: 6, mev: 10, mav: 18, mrv: 24 }]);
  assert.equal(merged.landmarks.quads.mrv, 24);
  assert.equal(merged.landmarks.chest.mrv, shippedLandmarks.landmarks.chest.mrv);
});
