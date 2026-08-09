/**
 * IndexedDB layer — M6 (ADR-004, ADR-011).
 *
 * DELIBERATELY UNIMPLEMENTED. ADR-011 requires the logger, this layer and JSON export/import
 * to ship in one milestone, gated on: export -> wipe storage -> import -> identical state.
 * A partial implementation here would create exactly the window that gate exists to close:
 * training data that can be written but not backed up.
 *
 * Do not implement this file without also implementing export/import.
 */
export const DB_NAME = 'training-planner';
export const DB_VERSION = 1;

export const STORES = Object.freeze({
  sessions: { keyPath: 'id', indexes: ['date', 'styleId'] },
  sets: { keyPath: 'id', indexes: ['exerciseId', 'sessionId', 'date'] },
  programs: { keyPath: 'id', indexes: ['createdAt'] }
});

export function open() {
  throw new Error('Storage is gated to M6 (ADR-011). Logger + IndexedDB + export/import ship together.');
}
