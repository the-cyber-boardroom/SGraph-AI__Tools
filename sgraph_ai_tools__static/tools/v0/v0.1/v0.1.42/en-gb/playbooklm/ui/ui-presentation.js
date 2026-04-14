/**
 * PlaybookLM — Step 2: Presentation panel.
 *
 * Shows the "Generate Presentation" action with an inline model selector.
 * After generation, displays the resulting presentation document in an
 * editable textarea.
 *
 * @module ui-presentation
 * @version 0.1.1
 */

import { buildModelSelector, getPhaseModel } from './ui-model-config.js';

/**
 * Build the Step 2 Presentation panel inside a container element.
 *
 * @param {HTMLElement} container
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {(n: number) => void} setStep
 * @returns {void}
 */
export function buildPresentationPanel(container, state, setStep) {
  container.style.cssText = 'overflow-y:auto;height:100%;box-sizing:border-box;padding:16px;background:#0d0d1a;font-family:system-ui,sans-serif;display:flex;flex-direction:column;gap:12px;';

  container.innerHTML = `
    <h2 class="plm-step-title">Step 2 &mdash; Presentation Strategy</h2>
    <p class="plm-step-desc">Generate a presentation strategy document from your sources. This defines the narrative arc, audience, and key points for all slides.</p>
    <div id="plm-model-selector-2"></div>
    <div class="plm-row-controls">
      <button id="plm-gen-presentation-btn" class="plm-btn-primary">Generate Strategy</button>
      <span id="plm-presentation-status" class="plm-status-text"></span>
    </div>
    <textarea id="plm-presentation-doc" class="plm-textarea" placeholder="Generated presentation strategy will appear here. You can edit it before generating slide briefs." rows="18"></textarea>
    <div class="plm-step-footer">
      <span class="plm-hint">Tip: Edit the strategy to refine the narrative before generating slide briefs.</span>
    </div>
  `;

  // Inject model selector
  container.querySelector('#plm-model-selector-2').appendChild(buildModelSelector(2));

  const genBtn   = container.querySelector('#plm-gen-presentation-btn');
  const statusEl = container.querySelector('#plm-presentation-status');
  const docEl    = container.querySelector('#plm-presentation-doc');

  // Keep textarea in sync with state
  docEl.addEventListener('input', () => {
    state.setPresentation(docEl.value);
  });

  // Reflect state changes into the textarea
  state.onChange(() => {
    const text = state.getPresentation();
    if (docEl.value !== text) docEl.value = text;
  });

  genBtn.addEventListener('click', async () => {
    const sources = state.getSources();
    if (!sources.length) {
      statusEl.textContent = 'Add sources in Step 1 first';
      statusEl.className = 'plm-status-text plm-status-error';
      return;
    }
    if (!state.connected) {
      statusEl.textContent = 'Connect your API key first';
      statusEl.className = 'plm-status-text plm-status-error';
      return;
    }

    genBtn.disabled = true;
    statusEl.className = 'plm-status-text plm-status-info';
    statusEl.textContent = 'Generating\u2026';

    try {
      await window.__tool.generatePresentation({ model: getPhaseModel(2) });
      statusEl.textContent = 'Strategy ready \u2713';
      statusEl.className = 'plm-status-text plm-status-ok';
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'plm-status-text plm-status-error';
    } finally {
      genBtn.disabled = false;
    }
  });
}
