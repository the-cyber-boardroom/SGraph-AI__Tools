/**
 * PlaybookLM — UI shell builder (v0.1.45).
 *
 * Changes from v0.1.44:
 *  - Right panel gains a "🎞 Deck" tab backed by ui-deck-view.js.
 *    The deck view shows a reactive grid of all generated slides.
 *  - buildGenerationPanel now receives a getTabMap callback so the deck
 *    view can activate slide workspace tabs on thumbnail click.
 *  - buildExportPanel receives setStep (was already wired but now explicit).
 *
 * @module ui-shell
 * @version 0.1.6
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
import { buildMonitorPanel }      from './ui-monitor-panel.js';
import { buildDeckViewPanel }     from './ui-deck-view.js';

/** sessionStorage key for the OpenRouter API key. */
const SESSION_KEY_API = 'plm-api-key';

/**
 * Navigate to a pipeline step. Set after buildShell() completes.
 *
 * @type {(n: number) => void}
 */
export let setStep = (_n) => {};

/**
 * Build the full UI shell.
 *
 * @param {object} opts
 * @param {import('../api/pipeline-state.js').PipelineState} opts.state
 * @param {object} opts.manifest
 * @returns {Promise<void>}
 */
export async function buildShell({ state, manifest }) {
  const layoutWrap = document.getElementById('layout-wrap');
  if (!layoutWrap) return;

  layoutWrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

  const toolArea = document.createElement('div');
  toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
  layoutWrap.appendChild(toolArea);

  buildDevPanel(layoutWrap);

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
        tabs: [
          { id: 't-welcome', title: 'Results',          tag: 'div', locked: true, closable: false },
          { id: 't-deck',    title: '\uD83C\uDFDE Deck', tag: 'div', locked: true, closable: false },
          { id: 't-monitor', title: '\uD83D\uDD0D Monitor', tag: 'div', locked: true, closable: false },
        ],
      },
    ],
  });

  const leftPanel    = layout.getPanelElement('t-pipeline');
  const rightPanel   = layout.getPanelElement('t-welcome');
  const deckPanel    = layout.getPanelElement('t-deck');
  const monitorPanel = layout.getPanelElement('t-monitor');

  _buildWelcomePlaceholder(rightPanel);
  buildMonitorPanel(monitorPanel);
  _wireConnectBar(state);

  // ── Slide tab map shared between generation panel and deck view ───────────
  /** @type {Map<number, string>} slide index → tabId */
  const _tabMap = new Map();

  // ── State-aware stepper ───────────────────────────────────────────────────
  const getCompletedSteps = () => {
    const done = new Set();
    if (state.getSources().length > 0)                              done.add(1);
    if (state.getPresentation())                                    done.add(2);
    if (state.getSlideBriefs().length > 0)                         done.add(3);
    if (state.getSlideBriefs().length > 0)                         done.add(4);
    if (state.getSlideResults().some(r => r.status === 'complete')) done.add(5);
    return done;
  };

  const { setStep: _setStep, getPanelEl, refreshStatus } = buildStepper(leftPanel, getCompletedSteps);
  setStep = _setStep;

  state.onChange(refreshStatus);

  buildSourcesPanel(getPanelEl(1), state, _setStep);
  buildPresentationPanel(getPanelEl(2), state, _setStep);
  buildBriefsPanel(getPanelEl(3), state, _setStep);

  // Pass getTabMap so deck view can activate slide workspace tabs
  buildGenerationPanel(getPanelEl(4), state, layout, _setStep, _tabMap);
  buildExportPanel(getPanelEl(5), state, _setStep);

  // Deck view — reacts to state, activates tabs via _tabMap
  buildDeckViewPanel(deckPanel, state, layout, () => _tabMap);

  _setStep(1);
}

/**
 * Wire the connection bar.
 *
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @returns {void}
 */
function _wireConnectBar(state) {
  const apiKeyEl = document.getElementById('api-key');
  const btn      = document.getElementById('connect-btn');
  const statusEl = document.getElementById('conn-status');

  if (!btn) return;

  const savedKey = sessionStorage.getItem(SESSION_KEY_API);
  if (savedKey && apiKeyEl) apiKeyEl.value = savedKey;

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

  buildCostDisplay(state);
}

/**
 * Build the right-panel welcome placeholder.
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
      4&nbsp; Generate slide images (with version history)<br>
      5&nbsp; Export as PDF, ZIP, or Session Archive
    </div>
    <div style="font-size:11px;color:#4a5568;margin-top:8px;">
      Slide workspaces appear here as tabs. Use the \uD83C\uDFDE Deck tab for a full overview.
    </div>
  `;
  panel.appendChild(ph);
}
