/**
 * Weekly hard sets per muscle, against the volume landmarks (#44).
 *
 * PURE. Takes a generated week and the landmark table, returns a report. Reads
 * nothing, decides nothing, changes no selection.
 *
 * WHY THIS REPORTS RATHER THAN ENFORCES
 *
 * `landmarks.json` holds population estimates, and says so itself: "wide
 * individual variance ... the engine seeds from these and then corrects against
 * logged history". Truncating a session on the authority of a number that may
 * be wrong for this body asserts a precision the data does not have. Quads
 * measured at 24 weekly sets against a population MRV of 20 may be a genuine
 * overreach, or may simply be this athlete's MRV.
 *
 * So: compute, compare, state. The athlete decides. Capping waits for #67, at
 * which point enforcing the athlete's OWN number is defensible in a way
 * enforcing a population estimate is not. Same honesty mechanism as #51's
 * session mismatch and #43's omission report.
 *
 * INDIRECT VOLUME COUNTS HALF, AND THIS IS FORCED BY THE DATA
 *
 * Measured on bodybuilding, 4 days, commercial-gym: biceps take 0 direct sets
 * and 20 indirect; triceps 4 and 16; erectors 0 and 19. Counting indirect as
 * zero would report arms as untrained and invite 8 more sets on top of 20 from
 * pulling. Counting it as a full set would report triceps at 20 and forbid any
 * direct work. Neither is true, so a fraction is not a refinement here -- it is
 * the only defensible reading. 0.5 is the convention in the literature these
 * landmarks come from.
 */

/** A secondary muscle receives half credit. See the header. */
export const INDIRECT_WEIGHT = 0.5;

/**
 * Stabilising work counts for NOTHING.
 *
 * Bracing under a back squat is isometric: the abs resist movement while the
 * legs do the work. The landmarks come from research counting direct hard sets,
 * where the muscle shortens under load through a range -- an ab wheel rollout,
 * not a brace. Counting bracing at any weight measures the wrong thing.
 *
 * Recorded on the row regardless, because it is true and a UI may want to show
 * it. Declared as a named constant rather than left implicit so that changing
 * the ruling is a one-line edit with this reasoning attached.
 */
export const STABILISER_WEIGHT = 0;

/**
 * Muscles excluded from volume accounting.
 *
 * `systemic` is an engine-only cost with no catalog rows of its own and
 * all-zero landmarks, so it can never be inside its own range -- it would
 * report as permanently at MRV. It is a fatigue concept, not a trainable
 * muscle.
 */
const NOT_TRAINABLE = new Set(['systemic']);

/**
 * Where a muscle's weekly volume sits against its landmarks.
 *
 * `untrained` is deliberately distinct from `below-mv`: zero sets is a
 * different fact from insufficient sets, and a split that never touches a
 * muscle is a split problem, not a dosing problem.
 */
export function classify(total, landmark) {
  if (!landmark) return 'no-landmark';
  if (total === 0) return 'untrained';
  if (total > landmark.mrv) return 'over-mrv';
  if (total > landmark.mav) return 'above-mav';
  if (total >= landmark.mev) return 'productive';
  if (total >= landmark.mv) return 'maintenance';
  return 'below-mv';
}

/**
 * Sets per muscle for ONE week.
 *
 * Returns null for a week whose sessions prescribe no sets -- the interval
 * domain prescribes work and rest seconds, and 30 of 169 setGroups measured
 * carry `sets: null`. Emitting zeros there would read as "trained nothing",
 * which is false: it trained differently. Null says the question does not
 * apply.
 */
export function weeklyVolume(week, landmarks) {
  const sessions = week?.sessions ?? [];
  const groups = sessions.flatMap((s) => (s.blocks ?? []).flatMap((b) => b.setGroups ?? []));
  if (!groups.some((g) => typeof g.sets === 'number')) return null;

  const acc = new Map();
  const bump = (muscle, direct, indirect) => {
    if (NOT_TRAINABLE.has(muscle)) return;
    const cur = acc.get(muscle) ?? { direct: 0, indirect: 0 };
    cur.direct += direct;
    cur.indirect += indirect;
    acc.set(muscle, cur);
  };

  for (const g of groups) {
    const sets = typeof g.sets === 'number' ? g.sets : 0;
    if (sets === 0) continue;
    for (const m of g.primaryMuscles ?? []) bump(m, sets, 0);
    for (const m of g.secondaryMuscles ?? []) bump(m, 0, sets);
  }

  // Every LANDMARKED muscle appears, including those with no sets. A muscle the
  // split never touches is the finding, and omitting it would hide exactly what
  // this report exists to surface: a bodybuilding week that trains glutes 28
  // times and upper_back twice.
  const out = {};
  for (const muscle of Object.keys(landmarks ?? {})) {
    if (NOT_TRAINABLE.has(muscle)) continue;
    const { direct = 0, indirect = 0 } = acc.get(muscle) ?? {};
    const total = direct + indirect * INDIRECT_WEIGHT;
    out[muscle] = {
      direct,
      indirect,
      total: Math.round(total * 10) / 10,
      landmark: landmarks[muscle],
      verdict: classify(total, landmarks[muscle])
    };
  }

  // A muscle an exercise trains but no landmark covers. Check 08 makes this
  // impossible in shipped data; reported rather than dropped so an imported row
  // cannot introduce one silently (#63).
  for (const [muscle, v] of acc) {
    if (out[muscle]) continue;
    out[muscle] = {
      direct: v.direct,
      indirect: v.indirect,
      total: Math.round((v.direct + v.indirect * INDIRECT_WEIGHT) * 10) / 10,
      landmark: null,
      verdict: 'no-landmark'
    };
  }

  return out;
}

/** Muscles outside the productive range, worst first. The reportable summary. */
export function volumeConcerns(volume) {
  if (!volume) return [];
  const rank = { 'over-mrv': 0, 'untrained': 1, 'below-mv': 2, 'above-mav': 3, 'maintenance': 4, 'no-landmark': 5 };
  return Object.entries(volume)
    .filter(([, v]) => v.verdict !== 'productive')
    .map(([muscle, v]) => ({ muscle, ...v }))
    .sort((a, b) => (rank[a.verdict] ?? 9) - (rank[b.verdict] ?? 9) || b.total - a.total);
}
