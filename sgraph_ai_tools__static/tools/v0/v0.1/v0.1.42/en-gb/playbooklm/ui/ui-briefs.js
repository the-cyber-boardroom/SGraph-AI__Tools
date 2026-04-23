/**
 * PlaybookLM — Step 3: Slide Briefs panel.
 *
 * Generates and displays editable slide briefs, with an inline model selector
 * to choose the reasoning model used for brief generation.
 *
 * @module ui-briefs
 * @version 0.1.1
 */

import { buildModelSelector, getPhaseModel } from './ui-model-config.js';

/**
 * Build the Step 3 Slide Briefs panel inside a container element.
 *
 * @param {HTMLElement} container
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {(n: number) => void} setStep
 * @returns {void}
 */
export function buildBriefsPanel(container, state, setStep) {
  container.style.cssText = 'overflow-y:auto;height:100%;box-sizing:border-box;padding:16px;background:#0d0d1a;font-family:system-ui,sans-serif;display:flex;flex-direction:column;gap:12px;';

  container.innerHTML = `
    <h2 class="plm-step-title">Step 3 &mdash; Slide Briefs</h2>
    <p class="plm-step-desc">Generate one brief per slide. Each brief defines the title and visual prompt for the AI image generator.</p>
    <div id="plm-model-selector-3"></div>
    <div class="plm-row-controls">
      <label class="plm-label" for="plm-slide-count">Slides:</label>
      <input id="plm-slide-count" class="plm-input-number" type="number" min="1" max="24" value="8" style="width:60px;">
      <button id="plm-gen-briefs-btn" class="plm-btn-primary">Generate Briefs</button>
      <button id="plm-add-brief-btn" class="plm-btn-secondary" title="Add a blank brief">+ Add</button>
      <span id="plm-briefs-status" class="plm-status-text"></span>
    </div>
    <div id="plm-briefs-list" class="plm-briefs-list"></div>
  `;

  // Inject model selector
  container.querySelector('#plm-model-selector-3').appendChild(buildModelSelector(3));

  const genBtn   = container.querySelector('#plm-gen-briefs-btn');
  const addBtn   = container.querySelector('#plm-add-brief-btn');
  const countEl  = container.querySelector('#plm-slide-count');
  const statusEl = container.querySelector('#plm-briefs-status');
  const listEl   = container.querySelector('#plm-briefs-list');

  function _render() {
    const briefs = state.getSlideBriefs();
    listEl.innerHTML = '';
    briefs.forEach((brief, i) => {
      const card = document.createElement('div');
      card.className = 'plm-brief-card';
      card.dataset.index = i;
      card.innerHTML = `
        <div class="plm-brief-header">
          <span class="plm-brief-num">${i + 1}</span>
          <input class="plm-brief-title" type="text" value="${_esc(brief.title)}" placeholder="Slide title" data-field="title" data-index="${i}">
          <button class="plm-brief-remove" data-index="${i}" title="Remove slide" aria-label="Remove slide ${i + 1}">&times;</button>
        </div>
        <textarea class="plm-brief-prompt" placeholder="Visual prompt for this slide\u2026" data-field="prompt" data-index="${i}" rows="3">${_esc(brief.prompt)}</textarea>
      `;

      card.querySelector('.plm-brief-title').addEventListener('change', e => {
        state.setSlideBrief(i, { title: e.target.value });
      });

      card.querySelector('.plm-brief-prompt').addEventListener('change', e => {
        state.setSlideBrief(i, { prompt: e.target.value });
      });

      card.querySelector('.plm-brief-remove').addEventListener('click', () => {
        state.removeSlideBrief(i);
        _render();
      });

      listEl.appendChild(card);
    });
  }

  state.onChange(_render);
  _render();

  genBtn.addEventListener('click', async () => {
    if (!state.getPresentation()) {
      statusEl.textContent = 'Generate a presentation strategy in Step 2 first';
      statusEl.className = 'plm-status-text plm-status-error';
      return;
    }
    if (!state.connected) {
      statusEl.textContent = 'Connect your API key first';
      statusEl.className = 'plm-status-text plm-status-error';
      return;
    }

    const count = parseInt(countEl.value, 10) || 8;
    genBtn.disabled = true;
    statusEl.className = 'plm-status-text plm-status-info';
    statusEl.textContent = 'Generating briefs\u2026';

    try {
      const briefs = await window.__tool.generateSlideBriefs({ count, model: getPhaseModel(3) });
      statusEl.textContent = `${briefs.length} briefs ready \u2713`;
      statusEl.className = 'plm-status-text plm-status-ok';
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'plm-status-text plm-status-error';
    } finally {
      genBtn.disabled = false;
    }
  });

  addBtn.addEventListener('click', () => {
    state.addSlideBrief({ title: 'New Slide', prompt: 'Describe the visual content for this slide.' });
  });
}

/**
 * Escape HTML special characters.
 *
 * @param {string} s
 * @returns {string}
 */
function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
