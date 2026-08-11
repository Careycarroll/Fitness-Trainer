/**
 * M5 UI shell. Deliberately thin: it builds a generation request and renders the result.
 * No planning logic lives here — the engine is the only thing that decides what to train
 * (ADR-002). If a rule appears in this file, it is in the wrong place.
 *
 * Nothing is persisted. Storage is gated to M6 (ADR-011).
 *
 * ADR-027: blocks now hold an ordered list of setGroups. Two consequences visible
 * throughout this file:
 *
 *   - Addressing gains one index. Every edit control carries (w, s, b, g) instead
 *     of (w, s, b), and resolves through `setGroupAt` rather than reaching into
 *     the shape. A superset's second exercise is reachable without this file
 *     knowing what a superset is.
 *
 *   - The load/time branch is gone from the block level. `intervalDomain` no
 *     longer emits `stations[]`, so one renderer walks `session.blocks` for both
 *     domains and switches on `blockType` for the group-level chrome. The domain
 *     branch that remains is only about session-level framing — rounds and a
 *     time cap versus a fatigue total.
 */
import { generate, CoverageError } from '../engine/index.js';
import { rankSubstitutes } from '../engine/substitution.js';
import { allSetGroups, setGroupAt } from '../engine/blocks.js';

const PREF_PROFILE = 'pref:equipmentProfile';
const DEFAULT_PROFILE = 'home-garage';

/** The program currently on screen. Mutated by edits; never persisted (ADR-011). */
let current = null;
let currentDefs = null;
let currentRequest = null;
let visibleDay = 0;        // single-session mode: which day of the split is shown
let scope = 'session';     // 'session' | 'block'
let edited = false;
let pinnedSeed = null;     // set when the user asks to reproduce a draft

/** A typed seed wins; anything unparseable falls back to a fresh draft. */
function seedFrom(raw) {
  const n = Number(String(raw ?? '').trim());
  if (Number.isInteger(n) && n > 0) return n;
  return nextSeed();
}

function nextSeed() {
  if (pinnedSeed !== null) { const s = pinnedSeed; pinnedSeed = null; return s; }
  return Math.floor(Math.random() * 2_000_000_000);
}

export function mount(root, defs) {
  currentDefs = defs;
  root.setAttribute('aria-busy', 'false');

  const savedProfile = localStorage.getItem(PREF_PROFILE);
  const profileExists = (id) => defs.equipment.some((p) => p.id === id);
  const selectedProfile =
    (savedProfile && profileExists(savedProfile) && savedProfile) ||
    (profileExists(DEFAULT_PROFILE) && DEFAULT_PROFILE) ||
    defs.equipment[0]?.id;

  root.innerHTML = `
    <header class="app-bar">
      <h1>Training Planner</h1>
      <button id="theme" class="ghost" aria-label="Toggle theme">◐</button>
    </header>

    <form id="req" class="panel">
      <label>Plan
        <select name="scope">
          <option value="session" selected>One session</option>
          <option value="block">Full block</option>
        </select>
      </label>
      <label>Style
        <select name="styleId">
          ${defs.styles.map((s) => `<option value="${s.id}">${esc(s.name)} — ${s.domain === 'load' ? 'load' : 'time'}</option>`).join('')}
        </select>
      </label>
      <label>Equipment
        <select name="equipmentProfile">
          ${defs.equipment.map((p) => `
            <option value="${p.id}"${p.id === selectedProfile ? ' selected' : ''}>${esc(p.name)}</option>
          `).join('')}
        </select>
      </label>
      <label>Days / week
        <input type="number" name="daysPerWeek" min="1" max="7" value="4" />
      </label>
      <label class="block-only">Block length (weeks)
        <input type="number" name="blockWeeks" min="1" max="12" value="4" />
      </label>
      <label>Skill level (1–5)
        <input type="number" name="skillLevel" min="1" max="5" value="2" />
      </label>
      <label>Seed (blank = new draft)
        <input type="text" name="seed" inputmode="numeric" placeholder="random"
               autocomplete="off" />
      </label>
      <button type="submit" class="primary">Generate</button>
    </form>

    <p class="warn" role="note">Nothing is saved — edits included. Persistence and export ship together in M6 (ADR-011).</p>
    <section id="out" aria-live="polite"></section>
  `;

  const form = root.querySelector('#req');
  const out = root.querySelector('#out');

  // Days/week still matters in single-session mode: it picks the split, and a
  // 3-day split's "Full Body A" is not a 6-day split's "Push A". Block length
  // does not, so it is hidden rather than left present and ignored.
  const syncScope = () => {
    scope = form.scope.value;
    form.querySelector('.block-only').hidden = scope === 'session';
  };
  form.scope.addEventListener('change', syncScope);
  syncScope();

  form.equipmentProfile.addEventListener('change', (e) => {
    localStorage.setItem(PREF_PROFILE, e.target.value);
  });

  root.querySelector('#theme').addEventListener('click', () => {
    const el = document.documentElement;
    el.dataset.theme = el.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', el.dataset.theme);
  });
  document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'dark';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);

    currentRequest = {
      schemaVersion: 1,
      styleId: f.get('styleId'),
      daysPerWeek: Number(f.get('daysPerWeek')),
      // Single-session mode still generates a real week — see the note above.
      blockWeeks: scope === 'session' ? 1 : Number(f.get('blockWeeks')),
      equipmentProfile: f.get('equipmentProfile'),
      sessionMinutes: 70,
      // A new seed per click, so Generate means "give me a different draft"
      // rather than redrawing the same one. The engine stays deterministic
      // (ADR-002): the same seed always yields the same program, and the seed
      // is shown so a draft you liked can be reproduced.
      // An explicit seed reproduces a draft exactly (ADR-002). Blank means
      // "give me a different one", which is what Generate should mean by default.
      seed: seedFrom(f.get('seed')),
      athlete: { skillLevel: Number(f.get('skillLevel')), hasCoaching: false, strictReps: {} },
      history: []
    };

    visibleDay = 0;
    edited = false;

    try {
      current = generate(currentRequest, currentDefs);
      paint(out);
    } catch (err) {
      current = null;
      out.innerHTML = err instanceof CoverageError
        ? coverageHtml(err, currentDefs, currentRequest)
        : genericErrorHtml(err);
    }
  });

  // One delegated listener for every edit control. SetGroups are addressed by
  // (week, session, block, setGroup) index rather than by DOM position, so a
  // re-render cannot desynchronise the handler from the data.
  out.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !current) return;
    const { act, w, s, b, g } = btn.dataset;
    handleEdit(act, Number(w), Number(s), Number(b), Number(g), btn);
    paint(out);
  });

  out.addEventListener('change', (e) => {
    const input = e.target.closest('[data-field]');
    if (!input || !current) return;
    const { field, w, s, b, g } = input.dataset;
    const sg = setGroupAt(current.weeks[+w].sessions[+s], +b, +g);
    if (!sg) return;
    const n = Number(input.value);
    if (Number.isFinite(n) && n > 0) {
      sg[field] = Math.round(n);
      edited = true;
    }
    paint(out);
  });
}

// ---------------------------------------------------------------------------
// Editing
//
// Every operation here mutates `current` and nothing else. The engine is never
// re-run: regenerating would discard the edits, which is the opposite of what
// an edit means.
// ---------------------------------------------------------------------------

function handleEdit(act, w, s, b, g, btn) {
  // The day picker addresses no block, so its buttons carry no w/s/b/g. Reading
  // the session first threw on weeks[NaN] and the click did nothing at all --
  // handle it before touching the program.
  if (act === 'use-seed') {
    const field = document.querySelector('#req input[name="seed"]');
    if (field) { field.value = btn.dataset.seed; field.focus(); }
    return;
  }

  if (act === 'day') {
    visibleDay = Number(btn.dataset.day);
    return;
  }

  const session = current.weeks[w].sessions[s];
  const block = session.blocks?.[b];
  if (!block) return;

  if (act === 'remove') {
    const [gone] = block.setGroups.splice(g, 1);
    // A block whose last setGroup was removed is not an empty block, it is a
    // block that no longer exists. Leaving it would render as an empty card and
    // would make `blockType` describe nothing.
    if (block.setGroups.length === 0) session.blocks.splice(b, 1);
    (session.omitted ??= []).push({
      pattern: gone?.pattern ?? '—',
      reason: 'removed-by-user',
      name: gone?.name
    });
    recomputeFatigue(session);
    edited = true;
    return;
  }

  if (act === 'swap-open') {
    const sg = setGroupAt(session, b, g);
    if (sg) sg.swapOpen = !sg.swapOpen;
    return;
  }

  if (act === 'swap-to') {
    const sg = setGroupAt(session, b, g);
    const replacement = currentDefs.exercises.find((e) => e.id === btn.dataset.id);
    if (!sg || !replacement) return;
    // Prescription is preserved; identity is replaced. Swapping a movement is
    // not a request to re-prescribe it — if the sets and reps changed under the
    // user, the swap would silently be an edit they did not make.
    block.setGroups[g] = {
      ...sg,
      exerciseId: replacement.id,
      name: replacement.name,
      pattern: replacement.pattern,
      equipment: replacement.equipment,
      primaryMuscles: replacement.primaryMuscles,
      exerciseFamily: replacement.exerciseFamily ?? null,
      fatigueCost: replacement.fatigueCost,
      rir: replacement.defaultRIR ?? sg.rir,
      warmupRequired: replacement.warmupRequired,
      unilateral: replacement.unilateral,
      swapOpen: false,
      userSwapped: true
    };
    recomputeFatigue(session);
    edited = true;
  }
}

/**
 * Fatigue is the engine's number, and after an edit it is no longer the engine's
 * session. Recomputing from the catalog keeps the displayed total honest rather
 * than leaving a stale figure that quietly stops describing what is on screen.
 */
function recomputeFatigue(session) {
  session.fatigueUsed = allSetGroups(session).reduce((sum, sg) => {
    const ex = currentDefs.exercises.find((e) => e.id === sg.exerciseId);
    return sum + (ex?.fatigueCost ?? 0);
  }, 0);
}

/** Substitution candidates come from the engine, never from this file (ADR-002). */
function substitutesFor(sg, session) {
  const target = currentDefs.exercises.find((e) => e.id === sg.exerciseId);
  if (!target) return [];
  const profile = currentDefs.equipment.find((p) => p.id === currentRequest.equipmentProfile);
  const inUse = new Set(allSetGroups(session).map((x) => x.exerciseId));
  return rankSubstitutes(target, currentDefs.exercises, currentDefs.substitutionWeights, profile, 8)
    .filter((r) => !inUse.has(r.exercise.id))
    .slice(0, 6);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function paint(out) {
  if (!current) return;
  out.innerHTML = scope === 'session' ? renderSingle() : renderProgram();
}

function renderSingle() {
  const week = current.weeks[0];
  const day = Math.min(visibleDay, week.sessions.length - 1);
  const session = week.sessions[day];
  const style = currentDefs.styles.find((s) => s.id === current.styleId);
  const split = currentDefs.splits.find((s) => s.id === current.splitId);

  // The other days are shown as a picker rather than hidden. The split is what
  // makes this session make sense — "Push A" is only meaningful next to "Pull A".
  const picker = week.sessions.map((s, i) => `
    <button class="ghost day-tab${i === day ? ' selected' : ''}"
            aria-pressed="${i === day}" data-act="day" data-day="${i}">
      ${esc(s.label)}
    </button>`).join('');

  return `
    <div class="program-head">
      <h2>${esc(style.name)}</h2>
      <p class="meta">${esc(split?.name ?? current.splitId)} · one session ·
        seed <button class="ghost seed-copy" data-act="use-seed"
              data-seed="${current.seed}" title="Reuse this seed">${current.seed}</button>${edited ? ' · edited' : ''}</p>
      <div class="day-picker">${picker}</div>
      <p class="meta">Days/week picks the split, so this session is day ${day + 1}
        of ${week.sessions.length}. It is one day of a real week, not a standalone plan (ADR-015).</p>
    </div>
    ${sessionHtml(session, 0, day)}`;
}

function renderProgram() {
  const style = currentDefs.styles.find((s) => s.id === current.styleId);
  const split = currentDefs.splits.find((s) => s.id === current.splitId);

  const header = `
    <div class="program-head">
      <h2>${esc(style.name)}</h2>
      <p class="meta">
        ${esc(split?.name ?? current.splitId)} ·
        ${current.weeks.length} week${current.weeks.length === 1 ? '' : 's'} ·
        seed ${current.seed}${edited ? ' · edited' : ''}
      </p>
      ${split && split.daysPerWeek !== currentRequest.daysPerWeek
        ? `<p class="note">You asked for ${currentRequest.daysPerWeek} days/week; the closest
            shipped split is ${split.daysPerWeek}. Nothing was invented to fill the gap.</p>`
        : ''}
    </div>`;

  return header + current.weeks.map((wk, wi) => `
    <h3 class="week">Week ${wk.week}</h3>
    ${wk.sessions.map((s, si) => sessionHtml(s, wi, si)).join('')}`).join('');
}

// ---------------------------------------------------------------------------
// One block renderer for both domains (ADR-027).
//
// The session wrapper still differs — a load session reports a fatigue total, a
// time session reports rounds and an estimated duration — but the block list
// itself no longer branches on `session.domain` to find the exercises.
// ---------------------------------------------------------------------------

function sessionHtml(s, w, si) {
  const blocks = (s.blocks ?? []).map((b, bi) => blockHtml(b, s, w, si, bi)).join('');
  const isTime = s.domain === 'time';

  return `
    <article class="card">
      <h3>${esc(s.label)}${isTime ? ` <span class="tag">${esc(s.format)}</span>` : ''}</h3>
      <ul class="blocks">${blocks}</ul>
      ${omittedHtml(s.omitted)}
      ${gateHtml(s.blockedByGates)}
      <p class="meta">
        ${isTime
          ? `${s.rounds} round(s) · ~${Math.round(s.estimatedSeconds / 60)} min · `
          : ''}fatigue ${s.fatigueUsed}/${s.fatigueBudget}
      </p>
    </article>`;
}

/** Group-level chrome. A straight block needs none, which is why it gets none. */
const BLOCK_LABEL = {
  straight: '',
  superset: 'Superset',
  circuit: 'Circuit',
  emom: 'EMOM',
  amrap: 'AMRAP'
};

function blockHtml(b, session, w, si, bi) {
  const label = BLOCK_LABEL[b.blockType] ?? b.blockType;
  const detail = [
    b.rounds ? `${b.rounds} round(s)` : '',
    b.timeCapSeconds ? `${Math.round(b.timeCapSeconds / 60)} min cap` : ''
  ].filter(Boolean).join(' · ');

  const head = label
    ? `<div class="block-group-head">
         <span class="tag">${esc(label)}</span>
         ${detail ? `<span class="meta">${esc(detail)}</span>` : ''}
       </div>`
    : '';

  // A multi-setGroup block is one unit of work, so its members are numbered
  // A1/A2/... the way they would be written on paper. A one-element block gets
  // no prefix, because "A1" with no A2 is noise.
  const many = b.setGroups.length > 1;
  const letter = String.fromCharCode(65 + bi);

  return `
    <li class="block block-${esc(b.blockType)}">
      ${head}
      <ul class="setgroups">
        ${b.setGroups.map((sg, gi) =>
          setGroupHtml(sg, session, w, si, bi, gi, many ? `${letter}${gi + 1}` : '')
        ).join('')}
      </ul>
    </li>`;
}

function setGroupHtml(sg, session, w, si, bi, gi, marker) {
  const addr = `data-w="${w}" data-s="${si}" data-b="${bi}" data-g="${gi}"`;

  // A load setGroup prescribes sets/reps/intensity; a time setGroup prescribes
  // work/rest seconds. Which fields exist is the honest discriminator — the
  // domain does not need to be consulted.
  const prescription = sg.workSeconds !== undefined
    ? `<span class="meta">${sg.workSeconds}s work / ${sg.restSeconds}s rest</span>`
    : `<label>sets
         <input type="number" min="1" max="10" value="${sg.sets}"
                data-field="sets" ${addr} />
       </label>
       <label>reps
         <input type="number" min="1" max="50" value="${sg.reps}"
                data-field="reps" ${addr} />
       </label>
       <span class="meta">@ ${Math.round(sg.intensityOf1RM * 100)}% · RIR ${sg.rir} · ${sg.restSeconds}s</span>`;

  return `
    <li class="setgroup${sg.userSwapped ? ' swapped' : ''}">
      <div class="block-head">
        ${marker ? `<span class="marker">${esc(marker)}</span>` : ''}
        <strong>${esc(sg.name)}</strong>
        <span class="tag">${esc(sg.role ?? '')}</span>
        ${sg.warmupRequired ? '<span class="tag warn-tag">warmup</span>' : ''}
        ${sg.userSwapped ? '<span class="tag">swapped</span>' : ''}
      </div>

      <div class="block-edit">
        ${prescription}
        <button class="ghost" data-act="swap-open" ${addr}>swap</button>
        <button class="ghost danger" data-act="remove" ${addr}>remove</button>
      </div>

      ${sg.swapOpen ? swapListHtml(sg, session, w, si, bi, gi) : ''}
    </li>`;
}

function swapListHtml(sg, session, w, si, bi, gi) {
  const options = substitutesFor(sg, session);
  if (options.length === 0) {
    return `<p class="meta swap-list">No substitute available in this equipment profile.</p>`;
  }
  return `
    <ul class="swap-list">
      ${options.map((o) => `
        <li>
          <button class="ghost" data-act="swap-to" data-id="${esc(o.exercise.id)}"
                  data-w="${w}" data-s="${si}" data-b="${bi}" data-g="${gi}">
            ${esc(o.exercise.name)}
          </button>
          <span class="meta">fatigue ${o.exercise.fatigueCost} · ${esc(o.exercise.pattern)}</span>
        </li>`).join('')}
    </ul>`;
}

// ---------------------------------------------------------------------------
// Honest reporting of what is NOT in the session
// ---------------------------------------------------------------------------

const OMIT_REASON = {
  'style-emphasis-zero': 'this style does not program it',
  'no-unused-candidates': 'every option was already used',
  'fatigue-budget-exhausted': 'fatigue budget reached',
  'no-time-domain': 'no work/rest window authored for it',
  'removed-by-user': 'you removed it'
};

function omittedHtml(omitted) {
  if (!omitted?.length) return '';
  return `
    <div class="omitted">
      <h4>Not included</h4>
      <ul>
        ${omitted.map((o) => `
          <li>${esc(o.name ?? patternLabel(o.pattern))} —
            ${esc(OMIT_REASON[o.reason] ?? o.reason)}</li>`).join('')}
      </ul>
    </div>`;
}

function gateHtml(blocked) {
  if (!blocked?.length) return '';
  return `<p class="meta">${blocked.length} movement(s) held back by skill gates.</p>`;
}

// ---------------------------------------------------------------------------
// Failure: coverage
// ---------------------------------------------------------------------------

function coverageHtml(err, defs, request) {
  const profile = defs.equipment.find((p) => p.id === request.equipmentProfile);
  const style = defs.styles.find((s) => s.id === request.styleId);

  const equipmentGaps = err.gaps.filter((g) => g.reason !== 'no-catalog-rows');
  const missingGaps = err.gaps.filter((g) => g.reason === 'no-catalog-rows');

  const parts = [
    `<div class="card error-card" role="alert">
       <h2>Can't build this session</h2>
       <p class="meta">${esc(style.name)} · ${esc(profile?.name ?? request.equipmentProfile)}</p>`
  ];

  if (equipmentGaps.length) {
    parts.push(`
      <h3>Your equipment can't cover ${equipmentGaps.length === 1 ? 'one movement' : `${equipmentGaps.length} movements`}</h3>
      <ul class="gap-list">
        ${equipmentGaps.map((g) => `
          <li>
            <strong>${esc(patternLabel(g.pattern))}</strong>
            ${g.suggests.length
              ? `<span class="fix">add ${g.suggests.map((t) => `<code>${esc(t)}</code>`).join(' or ')}</span>`
              : `<span class="fix">no single item unlocks this</span>`}
          </li>`).join('')}
      </ul>`);
  }

  if (missingGaps.length) {
    parts.push(`
      <h3>Not in the catalog yet</h3>
      <ul class="gap-list">
        ${missingGaps.map((g) => `
          <li>
            <strong>${esc(patternLabel(g.pattern))}</strong>
            <span class="fix">no exercises authored — equipment won't help</span>
          </li>`).join('')}
      </ul>
      <p class="meta">Conditioning styles need interval-domain movements (rower, bike,
      jump rope). Those land in M7.</p>`);
  }

  parts.push(`
      <p class="meta">Nothing partial was generated. A session missing a movement
      the split asked for is worse than no session (ADR-014).</p>
    </div>`);

  return parts.join('');
}

function genericErrorHtml(err) {
  return `<div class="card error-card" role="alert">
            <h2>Generation failed</h2>
            <p>${esc(err.message)}</p>
            <p class="meta">${esc(err.name ?? 'Error')} — this one is a bug, not a setting.</p>
          </div>`;
}

// ---------------------------------------------------------------------------

const PATTERN_LABELS = {
  squat: 'Squat', lunge: 'Lunge', hinge: 'Hinge',
  push_h: 'Horizontal push', push_v: 'Vertical push',
  pull_h: 'Horizontal pull', pull_v: 'Vertical pull',
  carry: 'Carry', core: 'Core', isolation: 'Isolation',
  explosive: 'Explosive', locomotion: 'Locomotion',
  monostructural: 'Conditioning'
};
const patternLabel = (p) => PATTERN_LABELS[p] ?? p;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
