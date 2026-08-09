/**
 * M5 UI shell. Deliberately thin: it builds a generation request and renders the result.
 * No planning logic lives here — the engine is the only thing that decides what to train
 * (ADR-002). If a rule appears in this file, it is in the wrong place.
 *
 * Nothing is persisted. Storage is gated to M6 (ADR-011).
 */
import { generate } from '../engine/index.js';

export function mount(root, defs) {
  root.setAttribute('aria-busy', 'false');
  root.innerHTML = `
    <header class="app-bar">
      <h1>Training Planner</h1>
      <button id="theme" class="ghost" aria-label="Toggle theme">◐</button>
    </header>

    <form id="req" class="panel">
      <label>Style
        <select name="styleId">
          ${defs.styles.map((s) => `<option value="${s.id}">${s.name} — ${s.domain === 'load' ? 'load' : 'time'}</option>`).join('')}
        </select>
      </label>
      <label>Days / week
        <input type="number" name="daysPerWeek" min="1" max="7" value="4" />
      </label>
      <label>Block length (weeks)
        <input type="number" name="blockWeeks" min="1" max="12" value="1" />
      </label>
      <label>Equipment
        <select name="equipmentProfile">
          ${defs.equipment.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
      </label>
      <label>Skill level (1–5)
        <input type="number" name="skillLevel" min="1" max="5" value="2" />
      </label>
      <button type="submit" class="primary">Generate</button>
    </form>

    <p class="warn" role="note">Nothing is saved. Persistence and export ship together in M6 (ADR-011).</p>
    <section id="out" aria-live="polite"></section>
  `;

  root.querySelector('#theme').addEventListener('click', () => {
    const el = document.documentElement;
    el.dataset.theme = el.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', el.dataset.theme);
  });
  document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'dark';

  root.querySelector('#req').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const request = {
      schemaVersion: 1,
      styleId: f.get('styleId'),
      daysPerWeek: Number(f.get('daysPerWeek')),
      blockWeeks: Number(f.get('blockWeeks')),
      equipmentProfile: f.get('equipmentProfile'),
      sessionMinutes: 70,
      seed: Number(f.get('daysPerWeek')) * 1000 + 20260809,
      athlete: { skillLevel: Number(f.get('skillLevel')), hasCoaching: false, strictReps: {} },
      history: []
    };
    try {
      render(root.querySelector('#out'), generate(request, defs));
    } catch (err) {
      root.querySelector('#out').innerHTML = `<p class="error">${err.message}</p>`;
    }
  });
}

function render(out, program) {
  out.innerHTML = program.weeks
    .map(
      (w) => `
      <h2>Week ${w.week}</h2>
      ${w.sessions.map(sessionHtml).join('')}`
    )
    .join('');
}

const sessionHtml = (s) =>
  s.domain === 'load'
    ? `<article class="card">
         <h3>${s.label}</h3>
         <ul>${s.blocks.map((b) => `<li><strong>${b.name}</strong> — ${b.sets}×${b.reps} @ ${Math.round(b.intensityOf1RM * 100)}% · RIR ${b.rir} · ${b.restSeconds}s rest <span class="tag">${b.role}</span></li>`).join('')}</ul>
         <p class="meta">fatigue ${s.fatigueUsed}/${s.fatigueBudget}</p>
       </article>`
    : `<article class="card">
         <h3>${s.label} <span class="tag">${s.format}</span></h3>
         <ul>${s.stations.map((st) => `<li><strong>${st.name}</strong> — ${st.workSeconds}s work / ${st.restSeconds}s rest</li>`).join('')}</ul>
         <p class="meta">${s.rounds} round(s) · ~${Math.round(s.estimatedSeconds / 60)} min · fatigue ${s.fatigueUsed}/${s.fatigueBudget}</p>
       </article>`;
