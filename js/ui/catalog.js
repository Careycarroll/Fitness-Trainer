/**
 * Pure filtering, facet extraction, and display helpers for the browsable
 * exercise catalog (#83).
 *
 * Kept DOM-free so all filter and facet logic runs in `node --test`.
 */

/**
 * Extract sorted unique filter facets directly from the loaded catalog.
 *
 * @param {Array<object>} exercises
 * @returns {{ muscles: string[], patterns: string[], equipment: string[], trackingTypes: string[] }}
 */
export function extractCatalogFacets(exercises) {
  const muscles = new Set();
  const patterns = new Set();
  const equipment = new Set();
  const trackingTypes = new Set();

  for (const ex of exercises || []) {
    if (ex.pattern) patterns.add(ex.pattern);
    if (ex.trackingType) trackingTypes.add(ex.trackingType);
    for (const m of ex.primaryMuscles || []) muscles.add(m);
    for (const m of ex.secondaryMuscles || []) muscles.add(m);
    for (const eq of ex.equipment || []) equipment.add(eq);
  }

  return {
    muscles: [...muscles].sort(),
    patterns: [...patterns].sort(),
    equipment: [...equipment].sort(),
    trackingTypes: [...trackingTypes].sort()
  };
}

/**
 * Filter exercises by search query, muscle, pattern, equipment, tracking type,
 * and optional owned equipment tokens.
 *
 * @param {Array<object>} exercises
 * @param {object} [filters]
 * @param {string} [filters.query]
 * @param {string} [filters.muscle]
 * @param {string} [filters.pattern]
 * @param {string} [filters.equipment]
 * @param {string} [filters.trackingType]
 * @param {boolean} [filters.onlyMyEquipment]
 * @param {Iterable<string>} [filters.ownedEquipment]
 * @param {boolean} [filters.excludeNoEquipment]
 * @returns {Array<object>}
 */
export function filterCatalogExercises(exercises, filters = {}) {
  const {
    query = '',
    muscle = '',
    pattern = '',
    equipment = '',
    trackingType = '',
    onlyMyEquipment = false,
    ownedEquipment = null,
    excludeNoEquipment = false
  } = filters;

  const q = String(query).trim().toLowerCase();
  const ownedSet = ownedEquipment ? new Set(ownedEquipment) : null;

  return (exercises || []).filter((ex) => {
    if (pattern && ex.pattern !== pattern) return false;
    if (trackingType && ex.trackingType !== trackingType) return false;

    if (muscle) {
      const hasMuscle =
        (ex.primaryMuscles || []).includes(muscle) ||
        (ex.secondaryMuscles || []).includes(muscle);
      if (!hasMuscle) return false;
    }

    if (equipment) {
      if (!(ex.equipment || []).includes(equipment)) return false;
    }

    if (onlyMyEquipment && ownedSet) {
      const req = ex.equipment || [];
      const performable = req.every((tok) => tok === 'bodyweight' || ownedSet.has(tok));
      if (!performable) return false;
    }

    if (excludeNoEquipment) {
      const req = ex.equipment || [];
      const hasRealEquipment = req.some((tok) => tok !== 'bodyweight');
      if (!hasRealEquipment) return false;
    }

    if (q) {
      const haystack = [
        ex.name,
        ex.id,
        ex.pattern,
        ...(ex.primaryMuscles || []),
        ...(ex.secondaryMuscles || []),
        ...(ex.equipment || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });
}

const TRACKING_LABELS = {
  weight_reps: 'Weight & Reps',
  bodyweight_reps: 'Bodyweight Reps',
  time: 'Timed Hold / Interval',
  distance_time: 'Distance & Time',
  reps_only: 'Reps Only'
};

export function formatCatalogToken(token) {
  return String(token || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatTrackingLabel(trackingType) {
  return TRACKING_LABELS[trackingType] || formatCatalogToken(trackingType);
}
