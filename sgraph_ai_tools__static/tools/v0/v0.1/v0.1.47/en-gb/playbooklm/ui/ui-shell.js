/**
 * PlaybookLM — UI shell builder.
 *
 * v0.1.7 changes:
 *  - Right panel "Results" tab replaced by vault start screen
 *    (sg-vault-manager + deck picker). Once a deck is connected or skipped,
 *    the start screen is removed and replaced with generation workspace tabs.
 *  - Vault status bar added above the stepper (below the OpenRouter bar).
 *  - buildVaultStatusBar and buildVaultStartScreen from ui-vault-panel.js.
 *
 * @module ui-shell
 * @version 0.1.7
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
import { buildVaultStartScreen, buildVaultStatusBar } from './ui-vault-panel.js';

const SESSION_KEY_API = 'plm-api-key';

/** @type {(n: number) => void} */
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

  // Vault status bar sits above the tool area
  const statusBarWrap = document.createElement('div');
  statusBarWrap.style.cssText = 'flex-shrink:0;';
  layoutWrap.appendChild(statusBarWrap);

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
          { id: 't-welcome', title: 'Results',               tag: 'div', locked: true, closable: false },
          { id: 't-deck',    title: '\uD83C\uDFDE Deck',     tag: 'div', locked: true, closable: false },
          { id: 't-monitor', title: '\uD83D\uDD0D Monitor',  tag: 'div', locked: true, closable: false },
        ],
      },
    ],
  });

  const leftPanel    = layout.getPanelElement('t-pipeline');
  const rightPanel   = layout.getPanelElement('t-welcome');
  const deckPanel    = layout.getPanelElement('t-deck');
  const monitorPanel = layout.getPanelElement('t-monitor');

  buildMonitorPanel(monitorPanel);
  _wireConnectBar(state);

  // Vault status bar
  buildVaultStatusBar(statusBarWrap, state);

  // Shared slide tab map
  /** @type {Map<number, string>} */
  const _tabMap = new Map();

  // State-aware stepper
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
  buildGenerationPanel(getPanelEl(4), state, layout, _setStep, _tabMap);
  buildExportPanel(getPanelEl(5), state, _setStep);

  buildDeckViewPanel(deckPanel, state, layout, () => _tabMap);

  // ── Vault start screen ────────────────────────────────────────────────────

  buildVaultStartScreen(
    rightPanel,
    state,
    // onVaultConnected: vault connected + deck ready → clear start screen
    (vault, deckId) => {
      state.setVault(vault, deckId);
      _clearAndShowWorkspace(rightPanel);
      _setStep(1);
    },
    // onSkip: no vault → clear start screen
    () => {
      _clearAndShowWorkspace(rightPanel);
      _setStep(1);
    },
  );
}

/**
 * Clear the vault start screen and show a plain workspace placeholder.
 *
 * @param {HTMLElement} panel
 */
function _clearAndShowWorkspace(panel) {
  panel.innerHTML = '';
  panel.style.cssText = 'overflow:hidden;height:100%;display:block;background:#0d0d1a;';
  const ph = document.createElement('div');
  ph.style.cssText =
    'height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:12px;font-family:system-ui,sans-serif;padding:40px;box-sizing:border-box;text-align:center;';
  ph.innerHTML = `
    <div style="font-size:13px;color:#4a5568;max-width:380px;line-height:1.8;text-align:left;">
      <strong style="color:#a0aec0;">Ready.</strong><br>
      Slide workspaces appear here as tabs. Use the \uD83C\uDFDE Deck tab for a full overview.
    </div>
  `;
  panel.appendChild(ph);
}

/**
 * Wire the OpenRouter connection bar.
 *
 * @param {import('../api/pipeline-state.js').PipelineState} state
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
