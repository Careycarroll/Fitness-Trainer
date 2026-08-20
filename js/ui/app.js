/**
 * M5 UI shell. Deliberately thin: it builds a generation request and renders the result.
 * No planning logic lives here — the engine is the only thing that decides what to train
 * (ADR-002). If a rule appears in this file, it is in the wrong place.
 *
 * Planner state persists to IndexedDB via ../storage/. This file decides WHEN
 * to save (debounced off paint, flushed on visibilitychange) and never HOW:
 * canonical form, versioning and the export envelope live in state.js so they
 * stay testable in node --test (#35, ADR-011).
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
import * as db from '../storage/db.js';
import { emptyState, putPlan, toExportJSON, fromImportJSON, toCSV } from '../storage/state.js';

const PREF_PROFILE = 'pref:equipmentProfile';
const DEFAULT_PROFILE = 'home-garage';

/** The program currently on screen. Mutated by edits, then persisted by paint(). */
let current = null;
let currentDefs = null;
let currentRequest = null;
let visibleDay = 0;        // single-session mode: which day of the split is shown
let scope = 'session';     // 'session' | 'block'
let edited = false;
let pinnedSeed = null;     // set when the user asks to reproduce a draft
let seedLabel = '';         // the user's number/name, shown separately from the resolved integer

/**
 * ONE stored draft, not a plan library. `plans` is an array and `putPlan` keys on
 * id, so many are storable - but this UI has no plan list, no picker and no
 * delete, so persisting every Generate click would accumulate drafts the athlete
 * can neither see nor remove. Data with no surface is worse than no data.
 */
const DRAFT_ID = 'draft:current';

/** Canonical state as last loaded or saved. Null until hydrate() resolves. */
let persisted = null;
/** True while restoring, so hydrating a draft does not immediately re-save it. */
let hydrating = false;
let saveTimer = null;
/** What the sidebar says about persistence. Empty means nothing worth saying. */
let storageNote = '';
let statusEl = null;

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
      <label>View
        <select name="scope">
          <option value="session" selected>One day at a time</option>
          <option value="block">All weeks</option>
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

      <div class="storage-panel">
        <div class="storage-actions">
          <button type="button" id="export" class="ghost">Export backup</button>
          <button type="button" id="import" class="ghost">Import backup</button>
          <button type="button" id="export-csv" class="ghost">Export history CSV</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden />
        </div>
        <p id="storage-status" class="note" role="status"></p>
      </div>
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

  statusEl = root.querySelector('#storage-status');
  const importFile = root.querySelector('#import-file');

  root.querySelector('#export').addEventListener('click', () => {
    // Exports whatever is STORED, not what is on screen: the file has to be the
    // thing a wipe-and-import reproduces (ADR-011). A pending debounce would
    // otherwise export one edit behind.
    flushSave().then(() => {
      try {
        const json = toExportJSON(persisted ?? emptyState(), new Date().toISOString());
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `training-planner-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        storageNote = 'Backup exported.';
      } catch (err) {
        storageNote = `Export failed: ${err.message}`;
      }
      paintStatus();
    });
  });

  // Generic CSV, for spreadsheets and other tools (#26). Not a backup: it holds
  // imported history only, and importing it back is not supported. The backup is
  // the JSON envelope above.
  root.querySelector('#export-csv').addEventListener('click', () => {
    flushSave().then(() => {
      const state = persisted ?? emptyState();
      if (!state.importedSets.length) {
        storageNote = 'No imported history to export yet.';
        paintStatus();
        return;
      }
      try {
        const url = URL.createObjectURL(new Blob([toCSV(state)], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `training-history-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        storageNote = `Exported ${state.importedSets.length} sets to CSV.`;
      } catch (err) {
        storageNote = `CSV export failed: ${err.message}`;
      }
      paintStatus();
    });
  });

  root.querySelector('#import').addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    importFile.value = '';          // so re-picking the same file fires change
    if (!file) return;
    if (!window.confirm(
      'Importing replaces everything this app has stored. Export first if you want to keep it. Continue?'
    )) return;

    let next;
    try {
      next = fromImportJSON(await file.text());
    } catch (err) {
      // Fails closed (#35): a refused import changes nothing at all.
      storageNote = `Import refused: ${err.message} Nothing was changed.`;
      paintStatus();
      return;
    }

    const { ok, error } = await db.trySave(next);
    if (!ok) {
      storageNote = `Import read correctly but could not be stored: ${error?.message ?? 'unknown'}`;
      paintStatus();
      return;
    }
    persisted = next;
    storageNote = 'Import complete.';
    restoreDraft(out, form);
  });

  // A phone switching apps is exactly when a pending debounce dies, and ADR-004
  // is explicit that there is no server to fall back on.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });

  hydrate(out, form);

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

/**
 * Read stored state and restore the draft, if there is one.
 *
 * A missing draft is not an error and neither is an unreadable database: a fresh
 * install and an evicted one are indistinguishable here, and ADR-004 records
 * eviction as expected iOS Safari behaviour rather than a fault. A CORRUPT store
 * is different - state.js throws, and this reports it without overwriting
 * anything, because a silent overwrite of the one copy is unrecoverable.
 */
async function hydrate(out, form) {
  if (!db.available()) {
    storageNote = 'This browser has no storage available here, so drafts are not saved. Export to keep one.';
    paintStatus();
    return;
  }
  try {
    persisted = await db.load();
  } catch (err) {
    persisted = null;
    storageNote = `Stored data could not be read (${err.message}). It has been left untouched, not overwritten.`;
    paintStatus();
    return;
  }
  restoreDraft(out, form);
}

/** Put the stored draft back on screen and back into the form. */
function restoreDraft(out, form) {
  const draft = persisted?.plans.find((p) => p.id === DRAFT_ID);
  if (!draft) { paintStatus(); return; }

  hydrating = true;
  try {
    currentRequest = draft.request;
    current = draft.program;
    edited = draft.edited === true;
    // A named seed resolves to an integer, and only the integer is in the
    // request - so the label has to be stored beside it or "Mine" comes back as
    // 1276318216 after a reload.
    seedLabel = draft.seedLabel ?? '';
    visibleDay = 0;
    restoreForm(form, draft);
    paint(out);
  } finally {
    hydrating = false;
  }
  paintStatus();
}

/** Reflect a restored request back into the controls that produced it. */
function restoreForm(form, draft) {
  const r = draft.request;
  if (draft.scope) form.scope.value = draft.scope;
  scope = form.scope.value;
  form.styleId.value = r.styleId;
  form.daysPerWeek.value = r.daysPerWeek;
  form.blockWeeks.value = r.blockWeeks;
  form.equipmentProfile.value = r.equipmentProfile;
  if (form.skillLevel) form.skillLevel.value = r.athlete?.skillLevel ?? 2;
  form.seed.value = seedLabel || String(r.seed);
  form.querySelector('.block-only').hidden = scope === 'session';
}

/** Collapse a burst of edits into one write. */
function scheduleSave() {
  if (hydrating || !current || !db.available()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

/**
 * Write the draft now. Awaited by export, so the file is never one edit behind.
 *
 * `createdAt` is preserved across saves. Refreshing it every time would make the
 * record differ on every keystroke for no reason, and #35's gate compares stored
 * state.
 */
async function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (hydrating || !current) return;

  const base = persisted ?? emptyState();
  const previous = base.plans.find((p) => p.id === DRAFT_ID);
  const next = putPlan(base, {
    id: DRAFT_ID,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    edited,
    seedLabel,
    scope,
    request: currentRequest,
    program: current
  });

  const { ok, error } = await db.trySave(next);
  if (ok) {
    persisted = next;
    if (storageNote.startsWith('Not saved')) storageNote = '';
  } else {
    // Visible, never silent. There is no server to fall back on (ADR-004).
    storageNote = `Not saved: ${error?.message ?? 'storage unavailable'}. Export to keep this draft.`;
  }
  paintStatus();
}

/**
 * ADR-031 requires the last import date wherever progression-derived numbers
 * appear. There are none until M8, so it lives here - visible rather than
 * technically satisfied.
 */
function paintStatus() {
  // Nothing to export until the FitNotes import lands (#24), so the button is
  // disabled rather than left clickable and immediately apologetic. A control
  // that cannot succeed in the current state reads as a defect.
  const csvBtn = document.querySelector('#export-csv');
  if (csvBtn) {
    const rows = persisted?.importedSets?.length ?? 0;
    csvBtn.disabled = rows === 0;
    csvBtn.title = rows === 0
      ? 'No imported history yet \u2014 available after a FitNotes import (#24)'
      : `Export ${rows} imported sets as CSV`;
  }

  if (!statusEl) return;
  const last = persisted?.meta?.lastImportAt;
  const parts = [];
  if (storageNote) parts.push(storageNote);
  parts.push(last
    ? `Last FitNotes import: ${last.slice(0, 10)}.`
    : 'No FitNotes history imported yet.');
  statusEl.textContent = parts.join(' ');
}

function paint(out) {
  if (!current) return;
  // ONE save anchor. Every mutation path - assignment, splice, swap, remove,
  // regenerate - mutates `current` and then calls paint(out), so hooking here
  // covers all of them. Four call sites would be four chances to miss one.
  scheduleSave();
  const style = currentDefs.styles.find((s) => s.id === current.styleId);
  const seedText = seedLabel || String(current.seed);
  const seedTitle = seedLabel
    ? `Named seed “${esc(seedLabel)}” resolves to ${current.seed}`
    : `Resolved seed ${current.seed}`;
  const editMessage = edited
    ? '<p class="edit-note">This draft has local edits, saved automatically. Regenerating replaces them.</p>'
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
    const context = `<p class="note">Day ${visibleDay + 1} of a ${sessions.length}-day week. Switch to All weeks to see the whole block.</p>`;
    out.innerHTML = head + tabs + context + renderSession(sessions[visibleDay], 0, visibleDay, style);
    return;
  }

  out.innerHTML = head + current.weeks.map((week, w) => `
    <h2 class="week">Week ${week.week}</h2>
    ${week.sessions.map((session, s) => renderSession(session, w, s, style)).join('')}
  `).join('');
}

function renderSession(session, w, s, style) {
  const groups = allSetGroups(session);
  const domainMeta = session.domain === 'load'
    ? `${session.fatigueUsed ?? groups.reduce((n, g) => n + (g.fatigueCost ?? 0), 0)} / ${session.fatigueBudget ?? style.fatigueBudget} fatigue`
    : sessionTiming(session);
  const timing = '';

  return `
    <article class="card session">
      <h3><span class="day-index">Day ${s + 1}</span>${esc(session.label)}</h3>
      ${session.blocks.length
        ? `<ul class="blocks">${session.blocks.map((block, b) => renderBlock(block, w, s, b, session.domain)).join('')}</ul>`
        : emptySession(session)}
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
        ${omitted.map((x) => `<li><strong>${esc(patternLabel(x.pattern))}</strong> — ${esc(omitReason(x))}</li>`).join('')}
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


/** Rounds and the time cap sit on the block (ADR-027), never on the session. */
function sessionTiming(session) {
  const rounds = session.blocks.reduce((n, b) => Math.max(n, b.rounds ?? 0), 0);
  const cap = session.blocks.reduce((n, b) => Math.max(n, b.timeCapSeconds ?? 0), 0);
  return [
    rounds ? `${rounds} rounds` : '',
    cap ? `${Math.round(cap / 60)} min cap` : '',
  ].filter(Boolean).join(' · ') || 'timed session';
}

/**
 * A session with no blocks is not an error — the engine reports the gap in
 * omitted[] and carries on (539f900). But it must say so, or it reads as broken.
 */
function emptySession(session) {
  // Was keyed on pattern === 'monostructural' and promised the rower/bike/jump
  // rope catalog "ships in M6". It shipped in #28, so the banner told the user
  // to wait for something already installed (#43). Every reason code is
  // translated in omitReason(); the banner defers to it rather than keeping a
  // second, staler opinion.
  const why = (session.omitted ?? [])
    .map((x) => omitReason(x))
    .filter((v, i, all) => all.indexOf(v) === i);

  return `<p class="edit-note">Nothing could be prescribed for this session. ${
    why.length
      ? esc(why.join('; ')) + '.'
      : 'No exercise in the catalog matches this session\u2019s patterns under the current equipment profile.'
  }</p>`;
}

function patternLabel(p) {
  const NAMES = {
    monostructural: 'Steady-state conditioning',
    push_h: 'Horizontal push', push_v: 'Vertical push',
    pull_h: 'Horizontal pull', pull_v: 'Vertical pull',
  };
  return NAMES[p] ?? p.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Engine reason codes are vocabulary, not prose. Translate at the boundary. */
function omitReason(x) {
  // Keyed on the REASON, never on the pattern. The old first line returned
  // 'deferred to M6' for any monostructural omission, which stopped being
  // true when 13_conditioning.csv landed 14 rows (#28) and pre-empted every
  // other cause besides (#43).
  switch (x.reason) {
    // The style does not train this pattern. Not a gap - a choice.
    case 'style-emphasis-zero':
      return 'not trained by this style';
    case 'no-unused-candidates':
      return 'no eligible exercise left for this pattern';
    case 'no-catalog-rows':
      return 'no exercise in the catalog for this pattern';
    case 'equipment':
      return 'no exercise your equipment profile can supply';
    case 'fatigue-budget-exhausted':
      return 'the session fatigue budget was already spent';
    case 'no-time-domain':
      return 'no exercise here can be prescribed for time';
    case 'reps-for-time-window-too-long':
      return 'the work window is too long to prescribe as continuous reps';
    case 'session-under-filled':
      return `only ${x.placed} of ${x.target} exercises could be placed`;
    case 'count-not-reachable':
      return 'the session could not reach its exercise count';
    default:
      return x.reason ?? 'no eligible exercise';
  }
}
