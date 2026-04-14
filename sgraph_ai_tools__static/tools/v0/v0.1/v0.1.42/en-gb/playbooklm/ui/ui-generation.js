/**
 * PlaybookLM — Step 4: Generation panel.
 *
 * Controls for generating individual slides or all slides at once.
 * Includes an inline image model selector. Slide results appear as tabs
 * in the right panel of the sg-layout.
 *
 * @module ui-generation
 * @version 0.1.1
 */

import { PLM_EVENTS }                        from '../api/pipeline-events.js';
import { buildModelSelector, getPhaseModel } from './ui-model-config.js';

/**
 * Build the Step 4 Generation panel.
 *
 * @param {HTMLElement} container
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {object} layout - sg-layout instance
 * @param {(n: number) => void} setStep
 * @returns {void}
 */
export function buildGenerationPanel(container, state, layout, setStep) {
  container.style.cssText = 'overflow-y:auto;height:100%;box-sizing:border-box;padding:16px;background:#0d0d1a;font-family:system-ui,sans-serif;display:flex;flex-direction:column;gap:12px;';

  container.innerHTML = `
    <h2 class="plm-step-title">Step 4 &mdash; Generate Slides</h2>
    <p class="plm-step-desc">Generate slide images from your briefs. Each slide appears as a tab in the right panel.</p>
    <div id="plm-model-selector-4"></div>
    <div class="plm-row-controls">
      <button id="plm-gen-all-btn" class="plm-btn-primary">Generate All Slides</button>
      <button id="plm-stop-btn" class="plm-btn-danger" style="display:none;">Stop</button>
      <span id="plm-gen-status" class="plm-status-text"></span>
    </div>
    <div id="plm-slide-grid" class="plm-slide-grid"></div>
  `;

  // Inject model selector
  container.querySelector('#plm-model-selector-4').appendChild(buildModelSelector(4));

  const genAllBtn = container.querySelector('#plm-gen-all-btn');
  const stopBtn   = container.querySelector('#plm-stop-btn');
  const statusEl  = container.querySelector('#plm-gen-status');
  const gridEl    = container.querySelector('#plm-slide-grid');

  // Tab map: index → tabId
  const _tabMap = new Map();

  function _renderGrid() {
    const briefs  = state.getSlideBriefs();
    const results = state.getSlideResults();
    gridEl.innerHTML = '';

    briefs.forEach((brief, i) => {
      const res  = results.find(r => r.index === i);
      const card = document.createElement('div');
      card.className = `plm-slide-card ${res ? `plm-slide-${res.status}` : ''}`;
      card.innerHTML = `
        <div class="plm-slide-card-num">${i + 1}</div>
        <div class="plm-slide-card-title">${_esc(brief.title)}</div>
        <div class="plm-slide-card-status">${_statusLabel(res)}</div>
        <button class="plm-btn-secondary plm-slide-gen-btn" data-index="${i}" ${!state.connected ? 'disabled' : ''}>
          ${res?.status === 'complete' ? 'Regenerate' : 'Generate'}
        </button>
      `;

      if (res?.status === 'complete' && _tabMap.has(i)) {
        card.addEventListener('click', e => {
          if (!e.target.closest('button')) {
            const tabId = _tabMap.get(i);
            if (tabId) layout.activateTab?.(tabId);
          }
        });
      }

      card.querySelector('.plm-slide-gen-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!state.connected) {
          statusEl.textContent = 'Connect first';
          return;
        }
        await _generateOne(i, brief);
      });

      gridEl.appendChild(card);
    });
  }

  async function _generateOne(index, brief) {
    statusEl.textContent = `Generating slide ${index + 1}\u2026`;
    statusEl.className = 'plm-status-text plm-status-info';

    let tabId = _tabMap.get(index);
    if (!tabId) {
      tabId = layout.addTabToStack('s-right', { tag: 'div', title: `Slide ${index + 1}` });
      _tabMap.set(index, tabId);
    }
    const panelEl = layout.getPanelElement(tabId);
    _renderSlideLoading(panelEl, brief.title, index + 1);

    try {
      const result = await window.__tool.generateSlide({ index, model: getPhaseModel(4) });
      _renderSlideResult(panelEl, result.imageSrc, brief.title, index + 1);
      statusEl.textContent = `Slide ${index + 1} ready \u2713`;
      statusEl.className = 'plm-status-text plm-status-ok';
    } catch (err) {
      _renderSlideError(panelEl, err.message, index + 1);
      statusEl.textContent = `Slide ${index + 1} error: ${err.message}`;
      statusEl.className = 'plm-status-text plm-status-error';
    }
    _renderGrid();
  }

  genAllBtn.addEventListener('click', async () => {
    const briefs = state.getSlideBriefs();
    if (!briefs.length) {
      statusEl.textContent = 'Generate slide briefs in Step 3 first';
      statusEl.className = 'plm-status-text plm-status-error';
      return;
    }
    if (!state.connected) {
      statusEl.textContent = 'Connect first';
      statusEl.className = 'plm-status-text plm-status-error';
      return;
    }

    genAllBtn.disabled = true;
    stopBtn.style.display = '';
    statusEl.className = 'plm-status-text plm-status-info';

    for (let i = 0; i < briefs.length; i++) {
      if (state.stopped) {
        statusEl.textContent = 'Stopped';
        break;
      }
      statusEl.textContent = `Generating slide ${i + 1} of ${briefs.length}\u2026`;
      await _generateOne(i, briefs[i]);
    }

    if (!state.stopped) {
      statusEl.textContent = `All ${briefs.length} slides complete \u2713`;
      statusEl.className = 'plm-status-text plm-status-ok';
    }

    genAllBtn.disabled = false;
    stopBtn.style.display = 'none';
  });

  stopBtn.addEventListener('click', () => {
    window.__tool.stop();
    statusEl.textContent = 'Stopping\u2026';
  });

  state.onChange(_renderGrid);
  _renderGrid();
}

/**
 * Render a loading state inside a slide result panel.
 *
 * @param {HTMLElement} panel
 * @param {string} title
 * @param {number} num
 * @returns {void}
 */
function _renderSlideLoading(panel, title, num) {
  panel.style.cssText = 'background:#0d0d1a;height:100%;overflow:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;';
  panel.innerHTML = `
    <div style="color:#a0aec0;font-family:system-ui,sans-serif;text-align:center;padding:20px;">
      <div style="font-size:16px;font-weight:600;color:#e2e8f0;margin-bottom:8px;">Slide ${num}: ${_esc(title)}</div>
      <div style="font-size:13px;color:#718096;">Generating image\u2026</div>
      <div class="plm-spinner" style="margin-top:16px;"></div>
    </div>
  `;
}

/**
 * Render a completed slide image inside a result panel.
 *
 * @param {HTMLElement} panel
 * @param {string} imageSrc
 * @param {string} title
 * @param {number} num
 * @returns {void}
 */
function _renderSlideResult(panel, imageSrc, title, num) {
  panel.style.cssText = 'background:#0d0d1a;height:100%;overflow:auto;display:flex;flex-direction:column;';
  panel.innerHTML = `
    <div style="padding:10px 14px;border-bottom:1px solid #1a1a3a;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:13px;font-weight:600;color:#e2e8f0;">Slide ${num}: ${_esc(title)}</span>
      <a class="plm-btn-secondary plm-dl-btn" download="slide-${String(num).padStart(2,'0')}.png" style="text-decoration:none;font-size:11px;padding:4px 10px;">Download</a>
    </div>
    <div style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:12px;">
      <img src="${_escAttr(imageSrc)}" alt="Slide ${num}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;">
    </div>
  `;
  const dlBtn = panel.querySelector('.plm-dl-btn');
  if (dlBtn) dlBtn.href = imageSrc;
}

/**
 * Render an error state inside a slide result panel.
 *
 * @param {HTMLElement} panel
 * @param {string} errorMsg
 * @param {number} num
 * @returns {void}
 */
function _renderSlideError(panel, errorMsg, num) {
  panel.style.cssText = 'background:#0d0d1a;height:100%;overflow:auto;display:flex;align-items:center;justify-content:center;';
  panel.innerHTML = `
    <div style="color:#fc8181;font-family:system-ui,sans-serif;text-align:center;padding:20px;">
      <div style="font-size:14px;font-weight:600;">Slide ${num} \u2014 Error</div>
      <div style="font-size:12px;margin-top:8px;color:#a0aec0;">${_esc(errorMsg)}</div>
    </div>
  `;
}

/**
 * Return a human-readable status label for a slide result.
 *
 * @param {{status: string}|undefined} res
 * @returns {string}
 */
function _statusLabel(res) {
  if (!res) return 'Not generated';
  const map = { pending: 'Pending', generating: 'Generating\u2026', complete: 'Done', error: 'Error' };
  return map[res.status] || res.status;
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

/**
 * Escape for HTML attribute values.
 *
 * @param {string} s
 * @returns {string}
 */
function _escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
