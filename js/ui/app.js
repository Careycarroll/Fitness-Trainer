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
let seedLabel = '';         // the user's number/name, shown separately from the resolved integer

/** Numeric seeds pass through; named seeds hash deterministically to a positive integer. */
function seedFrom(raw) {
  const value = String(raw ?? '').trim();
  seedLabel = value;
  if (!value) return nextSeed();

  const n = Number(value);
  if (Number.isInteger(n) && n > 0) return n;

  // FNV-1a keeps memorable labels such as "Mine" reproducible while the engine
  // continues receiving the integer seed required by its request contract.
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
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
      <div class="app-actions">
        ${import.meta.env.DEV ? `
          <label class="preview-control">Preview
            <select id="preview" aria-label="Responsive preview">
              <option value="auto">Auto</option>
              <option value="phone">Phone · 390px</option>
              <option value="desktop">Desktop</option>
            </select>
          </label>` : ''}
        <button id="theme" class="ghost icon-button" aria-label="Toggle theme">◐</button>
      </div>
    </header>

    <aside class="planner-sidebar">
      <form id="req" class="panel planner-form">
      <label>Plan
        <select name="scope">
          <option value="session" selected>Session preview</option>
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
      <label>Seed (number or name; blank = new draft)
        <input type="text" name="seed" placeholder="random"
               autocomplete="off" />
      </label>
        <button type="submit" class="primary">Generate</button>
      </form>

      <p class="warn" role="note">Nothing is saved — edits included. Persistence and export ship together in M6 (ADR-011).</p>
    </aside>
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

  const preview = root.querySelector('#preview');
  if (preview) {
    preview.addEventListener('change', () => {
      document.documentElement.dataset.preview = preview.value;
    });
    document.documentElement.dataset.preview = preview.value;
  }

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
    const day = e.target.closest('[data-day]');
    if (day) {
      visibleDay = Number(day.dataset.day);
      paint(out);
      return;
    }

    const seed = e.target.closest('[data-copy-seed]');
    if (seed) {
      const value = seed.dataset.copySeed;
      navigator.clipboard?.writeText(value).catch(() => {});
      seed.textContent = 'copied';
      setTimeout(() => { if (seed.isConnected) seed.textContent = value; }, 900);
      return;
    }

    const swap = e.target.closest('[data-swap]');
    if (swap) {
      const { w, s, b, g } = indices(swap);
      toggleSwapList(out, swap, w, s, b, g);
      return;
    }

    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const { w, s, b, g } = indices(pick);
      replaceSetGroup(w, s, b, g, pick.dataset.pick);
      edited = true;
      paint(out);
      return;
    }

    const remove = e.target.closest('[data-remove]');
    if (remove) {
      if (!window.confirm('Remove this exercise from the draft?')) return;
      const { w, s, b, g } = indices(remove);
      const block = current.weeks[w].sessions[s].blocks[b];
      block.setGroups.splice(g, 1);
      if (block.setGroups.length === 0) current.weeks[w].sessions[s].blocks.splice(b, 1);
      edited = true;
      paint(out);
    }
  });

  out.addEventListener('change', (e) => {
    const input = e.target.closest('[data-edit]');
    if (!input) return;
    const { w, s, b, g } = indices(input);
    const group = setGroupAt(current.weeks[w].sessions[s], b, g);
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    group[input.dataset.edit] = value;
    edited = true;
    paint(out);
  });
}

function indices(el) {
  return {
    w: Number(el.dataset.w),
    s: Number(el.dataset.s),
    b: Number(el.dataset.b),
    g: Number(el.dataset.g)
  };
}

function paint(out) {
  if (!current) return;
  const style = currentDefs.styles.find((s) => s.id === current.styleId);
  const seedText = seedLabel || String(current.seed);
  const seedTitle = seedLabel
    ? `Named seed “${esc(seedLabel)}” resolves to ${current.seed}`
    : `Resolved seed ${current.seed}`;
  const editMessage = edited
    ? '<p class="edit-note">This draft has local edits. Regenerating replaces them, and nothing is saved yet.</p>'
    : '<p class="edit-note">Sets and reps are editable; draft edits remain only on this screen. Intensity is prescribed as a percentage of 1RM — absolute loads need logged maxes (M7).</p>';

  const head = `
    <div class="program-head">
      <h2>${esc(style.name)}</h2>
      <p class="meta">
        ${scope === 'session' ? `${(current.weeks[0]?.sessions.length ?? 0)} split days · session preview` : `${current.weeks.length} weeks × ${(current.weeks[0]?.sessions.length ?? 0)} days`}
        · seed <button class="ghost seed-copy" data-copy-seed="${esc(String(current.seed))}" title="${seedTitle}">${esc(seedText)}</button>
        ${seedLabel ? ` <span class="resolved-seed">(resolved: ${current.seed})</span>` : ''}
      </p>
      ${editMessage}
    </div>`;

  if (scope === 'session') {
    const sessions = current.weeks[0].sessions;
    visibleDay = Math.min(visibleDay, Math.max(0, sessions.length - 1));
    const tabs = `
      <nav class="day-picker" aria-label="Split day preview">
        ${sessions.map((s, i) => `
          <button class="ghost day-tab${i === visibleDay ? ' selected' : ''}"
                  data-day="${i}" aria-pressed="${i === visibleDay}">
            ${esc(s.label)}
          </button>`).join('')}
      </nav>`;
    const context = `<p class="note">Days/week picks the split; this is day ${visibleDay + 1} of ${sessions.length}, not a standalone plan (ADR-015).</p>`;
    out.innerHTML = head + tabs + context + renderSession(sessions[visibleDay], 0, visibleDay, style);
    return;
  }

  out.innerHTML = head + current.weeks.map((week, w) => `
    <h2 class="week">Week ${week.weekNumber}</h2>
    ${week.sessions.map((session, s) => renderSession(session, w, s, style)).join('')}
  `).join('');
}

function renderSession(session, w, s, style) {
  const groups = allSetGroups(session);
  const domainMeta = session.domain === 'load'
    ? `${session.fatigueUsed ?? groups.reduce((n, g) => n + (g.fatigueCost ?? 0), 0)} / ${session.fatigueBudget ?? style.fatigueBudget} fatigue`
    : `${session.rounds} rounds · ${session.timeCapMinutes} min cap`;
  const timing = session.schedule
    ? `${esc(session.schedule.weekday)} · ${session.schedule.gapDays}d gap · ${esc(session.schedule.recovery)}`
    : '';

  return `
    <article class="card session">
      <h3>${esc(session.label)}</h3>
      <ul class="blocks">
        ${session.blocks.map((block, b) => renderBlock(block, w, s, b, session.domain)).join('')}
      </ul>
      ${renderOmitted(session.omitted)}
      <p class="meta">${domainMeta}${timing ? ` · ${timing}` : ''}</p>
    </article>`;
}

function renderBlock(block, w, s, b, domain) {
  const type = block.blockType ?? 'straight';
  const heading = type === 'straight'
    ? ''
    : `<div class="block-group-head"><strong>${esc(blockLabel(type))}</strong><span class="tag">${block.setGroups.length} exercises</span></div>`;

  return `
    <li class="block block-${esc(type)}">
      ${heading}
      <ol class="setgroups">
        ${block.setGroups.map((group, g) => renderSetGroup(group, w, s, b, g, domain, type, block.rounds)).join('')}
      </ol>
    </li>`;
}

function renderSetGroup(group, w, s, b, g, domain, blockType, rounds) {
  const p = group;
  const role = group.role ? `<span class="tag">${esc(group.role)}</span>` : '';
  const warmup = group.warmupRequired
    ? '<span class="tag warn-tag" title="Perform appropriate warm-up sets before the prescribed work sets">warm-up required</span>'
    : '';
  const marker = blockType === 'straight' ? '' : `<span class="marker">${g + 1}</span>`;
  const swapped = group.swappedFrom
    ? `<p class="note">Swapped from ${esc(group.swappedFrom.name)}</p>`
    : '';

  const controls = domain === 'load'
    ? loadControls(p, w, s, b, g)
    : timeControls(p, w, s, b, g, rounds);

  return `
    <li class="setgroup${group.swappedFrom ? ' swapped' : ''}">
      <div class="block-head">
        ${marker}<strong>${esc(group.name)}</strong>${role}${warmup}
      </div>
      ${controls}
      ${swapped}
    </li>`;
}

function loadControls(p, w, s, b, g) {
  // No absolute load until logged maxes exist (M7). Percent-of-1RM is all the
  // engine can honestly prescribe, so there is no load branch to fall back to.
  const load = p.intensityOf1RM != null
      ? `${formatNumber(p.intensityOf1RM * 100)}% 1RM`
      : 'load not prescribed';
  const intensity = [load, p.rir != null ? `RIR ${formatNumber(p.rir)}` : '', p.restSeconds != null ? `${p.restSeconds}s rest` : '']
    .filter(Boolean).join(' · ');

  return `
    <div class="block-edit">
      ${numberEdit('sets', p.sets, w, s, b, g, 1)}
      ${numberEdit('reps', p.reps, w, s, b, g, 1)}
      <p class="intensity">${esc(intensity)}</p>
      ${editActions(w, s, b, g)}
    </div>`;
}

function timeControls(p, w, s, b, g, rounds) {
  const details = [
    p.workSeconds != null ? `${p.workSeconds}s work` : '',
    p.restSeconds != null ? `${p.restSeconds}s rest` : '',
    rounds != null ? `${rounds} rounds` : ''
  ].filter(Boolean).join(' · ');

  return `
    <div class="block-edit">
      ${p.workSeconds != null ? numberEdit('workSeconds', p.workSeconds, w, s, b, g, 1, 'work (sec)') : ''}
      ${p.restSeconds != null ? numberEdit('restSeconds', p.restSeconds, w, s, b, g, 1, 'rest (sec)') : ''}
      <p class="intensity">${esc(details || 'timed prescription')}</p>
      ${editActions(w, s, b, g)}
    </div>`;
}

function numberEdit(field, value, w, s, b, g, step = 1, label = field) {
  return `
    <label>${esc(label)}
      <input type="number" min="0" step="${step}" value="${value ?? ''}"
             data-edit="${field}" data-w="${w}" data-s="${s}" data-b="${b}" data-g="${g}" />
    </label>`;
}

function editActions(w, s, b, g) {
  const data = `data-w="${w}" data-s="${s}" data-b="${b}" data-g="${g}"`;
  return `
    <button class="action-button" data-swap ${data}>Swap</button>
    <button class="action-button danger" data-remove ${data}>Remove</button>`;
}

function toggleSwapList(out, button, w, s, b, g) {
  const existing = button.closest('.setgroup')?.querySelector('.swap-list');
  if (existing) { existing.remove(); return; }

  const group = setGroupAt(current.weeks[w].sessions[s], b, g);
  const alternatives = rankSubstitutes(group.exerciseId, currentDefs, currentRequest, 5);
  const list = document.createElement('ul');
  list.className = 'swap-list';
  list.innerHTML = alternatives.length
    ? alternatives.map((x) => `
        <li>
          <button class="ghost" data-pick="${esc(x.exercise.id)}"
                  data-w="${w}" data-s="${s}" data-b="${b}" data-g="${g}">
            ${esc(x.exercise.name)}
          </button>
          <span class="meta">${formatNumber(x.score)}</span>
        </li>`).join('')
    : '<li class="note">No compatible substitutes found.</li>';
  button.closest('.setgroup')?.append(list);
}

function replaceSetGroup(w, s, b, g, replacementId) {
  const group = setGroupAt(current.weeks[w].sessions[s], b, g);
  const replacement = currentDefs.exercises.find((x) => x.id === replacementId);
  if (!replacement) return;
  const original = group.swappedFrom ?? { id: group.exerciseId, name: group.name };
  group.exerciseId = replacement.id;
  group.name = replacement.name;
  group.fatigueCost = replacement.fatigueCost;
  group.warmupRequired = replacement.warmupRequired;
  group.swappedFrom = original;
}

function renderOmitted(omitted = []) {
  if (!omitted.length) return '';
  return `
    <section class="omitted" aria-label="Omitted training patterns">
      <h4>Not included</h4>
      <ul>
        ${omitted.map((x) => `<li><strong>${esc(x.pattern)}</strong>: ${esc(x.reason ?? 'No eligible exercise')}</li>`).join('')}
      </ul>
    </section>`;
}

function coverageHtml(err, defs, request) {
  const profile = defs.equipment.find((p) => p.id === request.equipmentProfile);
  const gaps = err.gaps ?? [];
  return `
    <article class="card error-card">
      <h2>Equipment coverage problem</h2>
      <p>The ${esc(profile?.name ?? request.equipmentProfile)} profile cannot perform every required pattern.</p>
      <ul class="gap-list">
        ${gaps.map((gap) => `
          <li>
            <strong>${esc(gap.pattern)}</strong>
            ${gap.suggestions?.length
              ? `<span class="fix">Add ${gap.suggestions.map((s) => esc(s.join(' + '))).join(' or ')}</span>`
              : '<span class="fix">No compatible catalog option is available.</span>'}
          </li>`).join('')}
      </ul>
    </article>`;
}

function genericErrorHtml(err) {
  return `
    <article class="card error-card">
      <h2>Could not generate the plan</h2>
      <p>${esc(err?.message ?? 'Unknown error')}</p>
    </article>`;
}

function blockLabel(type) {
  return ({ superset: 'Superset', circuit: 'Circuit', amrap: 'AMRAP' })[type] ?? type;
}

function formatNumber(value) {
  return Number.isInteger(Number(value)) ? String(Number(value)) : Number(value).toFixed(1);
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
