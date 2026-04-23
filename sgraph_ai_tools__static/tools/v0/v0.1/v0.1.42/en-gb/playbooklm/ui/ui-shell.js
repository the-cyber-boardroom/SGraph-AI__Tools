/**
 * PlaybookLM — UI shell builder (v0.1.42).
 *
 * Sets up the sg-layout split panel with a custom stepper on the left and
 * results stack on the right. Wires the dev panel, connection bar, and
 * cost display. API key is persisted to sessionStorage.
 *
 * Called by pipeline-api.js init() after api.activate().
 *
 * @module ui-shell
 * @version 0.1.3
 */

import { SgLayout }  from '/core/sg-layout/v0.1.0/sg-layout.js';

import { buildStepper }           from './ui-stepper.js';
import { buildSourcesPanel }      from './ui-sources.js';
import { buildPresentationPanel } from './ui-presentation.js';
import { buildBriefsPanel }       from './ui-briefs.js';
import { buildGenerationPanel }   from './ui-generation.js';
import { buildExportPanel }       from './ui-export.js';
import { buildDevPanel }          from './ui-dev-panel.js';
import { buildCostDisplay }       from './ui-cost-tracker.js';

/** sessionStorage key for the OpenRouter API key. */
const SESSION_KEY_API = 'plm-api-key';

/**
 * Navigate to a pipeline step. Set after buildShell() completes.
 * Other modules may import this to trigger step changes programmatically.
 *
 * @type {(n: number) => void}
 */
export let setStep = (_n) => {};

/**
 * Build the full UI shell: layout, stepper, step panels, dev panel.
 *
 * @param {object} opts
 * @param {import('../api/pipeline-state.js').PipelineState} opts.state
 * @param {object} opts.manifest - Parsed manifest.json
 * @returns {Promise<void>}
 */
export async function buildShell({ state, manifest }) {
  const layoutWrap = document.getElementById('layout-wrap');
  if (!layoutWrap) return;

  layoutWrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

  // ── Tool area (flex:1 above dev panel) ────────────────────────────────────
  const toolArea = document.createElement('div');
  toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
  layoutWrap.appendChild(toolArea);

  // ── Dev panel + footer appended after toolArea ────────────────────────────
  buildDevPanel(layoutWrap);

  // ── sg-layout (row split: pipeline left | results right) ─────────────────
  const layout = document.createElement('sg-layout');
  layout.style.cssText = 'width:100%;height:100%;display:block;';
  toolArea.appendChild(layout);

  layout.setLayout({
    type: 'row', id: 'main', sizes: [0.35, 0.65],
    children: [
      {
        type: 'stack', id: 's-left', activeTab: 0,
        tabs: [{ id: 't-pipeline', title: 'Pipeline', tag: 'div', locked: true, closable: false }],
      },
      {
        type: 'stack', id: 's-right', activeTab: 0,
        tabs: [{ id: 't-welcome', title: 'Results', tag: 'div', locked: true, closable: false }],
      },
    ],
  });

  const leftPanel  = layout.getPanelElement('t-pipeline');
  const rightPanel = layout.getPanelElement('t-welcome');

  // ── Right panel welcome placeholder ──────────────────────────────────────
  _buildWelcomePlaceholder(rightPanel);

  // ── Wire connect button + cost display ───────────────────────────────────
  _wireConnectBar(state);

  // ── Build stepper shell inside leftPanel ─────────────────────────────────
  const { setStep: _setStep, getPanelEl } = buildStepper(leftPanel);
  setStep = _setStep;  // expose at module scope

  // ── Build all step panels into stepper panel slots ────────────────────────
  buildSourcesPanel(getPanelEl(1), state, _setStep);
  buildPresentationPanel(getPanelEl(2), state, _setStep);
  buildBriefsPanel(getPanelEl(3), state, _setStep);
  buildGenerationPanel(getPanelEl(4), state, layout, _setStep);
  buildExportPanel(getPanelEl(5), state, _setStep);

  // Start on step 1
  _setStep(1);
}

/**
 * Wire the connection bar at the top of the page.
 * Restores the saved API key from sessionStorage on load.
 * Saves it back on a successful connect.
 * Injects the live cost display after the status element.
 *
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @returns {void}
 */
function _wireConnectBar(state) {
  const apiKeyEl = document.getElementById('api-key');
  const btn      = document.getElementById('connect-btn');
  const statusEl = document.getElementById('conn-status');

  if (!btn) return;

  // Restore last-used key so the user doesn't have to re-enter on refresh
  const savedKey = sessionStorage.getItem(SESSION_KEY_API);
  if (savedKey && apiKeyEl) {
    apiKeyEl.value = savedKey;
  }

  btn.addEventListener('click', async () => {
    const apiKey = apiKeyEl?.value?.trim() || '';
    if (!apiKey) {
      if (statusEl) statusEl.textContent = 'API key required';
      return;
    }
    if (statusEl) statusEl.textContent = 'Connecting\u2026';
    btn.disabled = true;
    try {
      await window.__tool.connect({ apiKey });
      sessionStorage.setItem(SESSION_KEY_API, apiKey);
      if (statusEl) statusEl.textContent = 'Connected \u2713';
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    }
    btn.disabled = false;
  });

  // Inject live cost display after the status element
  buildCostDisplay(state);
}

/**
 * Build the right-panel welcome placeholder shown before any slides are generated.
 *
 * @param {HTMLElement} panel
 * @returns {void}
 */
function _buildWelcomePlaceholder(panel) {
  panel.style.cssText = 'overflow:hidden;height:100%;display:block;background:#0d0d1a;';
  const ph = document.createElement('div');
  ph.style.cssText = 'height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font-family:system-ui,sans-serif;padding:40px;box-sizing:border-box;text-align:center;';
  ph.innerHTML = `
    <div style="font-size:24px;font-weight:700;color:#e2e8f0;">PlaybookLM</div>
    <div style="font-size:14px;color:#718096;max-width:420px;line-height:1.7;">
      Upload sources &rarr; generate a presentation strategy &rarr; create slide briefs
      &rarr; generate images &rarr; export your deck.
    </div>
    <div style="font-size:13px;color:#4a5568;max-width:380px;line-height:1.8;text-align:left;">
      <strong style="color:#a0aec0;">Steps:</strong><br>
      1&nbsp; Load sources (PDFs, text, markdown)<br>
      2&nbsp; Generate presentation strategy<br>
      3&nbsp; Generate slide briefs (8 slides default)<br>
      4&nbsp; Generate slide images<br>
      5&nbsp; Export as PDF or ZIP
    </div>
    <div style="font-size:11px;color:#4a5568;margin-top:8px;">
      Slide results will appear here as tabs.
    </div>
  `;
  panel.appendChild(ph);
}
