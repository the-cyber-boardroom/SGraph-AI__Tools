/**
 * PlaybookLM — UI shell builder.
 *
 * Sets up the sg-layout split panel, wires the dev panel, then delegates
 * each pipeline step to its dedicated UI module.
 *
 * Called by pipeline-api.js init() after api.activate().
 *
 * @module ui-shell
 * @version 0.1.0
 */

import { SgLayout }  from '/core/sg-layout/v0.1.0/sg-layout.js';

import { buildSourcesPanel }      from './ui-sources.js';
import { buildPresentationPanel } from './ui-presentation.js';
import { buildBriefsPanel }       from './ui-briefs.js';
import { buildGenerationPanel }   from './ui-generation.js';
import { buildExportPanel }       from './ui-export.js';
import { buildDevPanel }          from './ui-dev-panel.js';

/**
 * Build the full UI shell: layout, step panels, dev panel.
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
        tabs: [
          { id: 't-sources',      title: '1 Sources',      tag: 'div', locked: true, closable: false },
          { id: 't-presentation', title: '2 Presentation', tag: 'div', locked: true, closable: false },
          { id: 't-briefs',       title: '3 Briefs',       tag: 'div', locked: true, closable: false },
          { id: 't-generation',   title: '4 Generate',     tag: 'div', locked: true, closable: false },
          { id: 't-export',       title: '5 Export',       tag: 'div', locked: true, closable: false },
        ],
      },
      {
        type: 'stack', id: 's-right', activeTab: 0,
        tabs: [
          { id: 't-welcome', title: 'Results', tag: 'div', locked: true, closable: false },
        ],
      },
    ],
  });

  const sourcesEl      = layout.getPanelElement('t-sources');
  const presentationEl = layout.getPanelElement('t-presentation');
  const briefsEl       = layout.getPanelElement('t-briefs');
  const generationEl   = layout.getPanelElement('t-generation');
  const exportEl       = layout.getPanelElement('t-export');
  const rightPanel     = layout.getPanelElement('t-welcome');

  // ── Right panel welcome placeholder ──────────────────────────────────────
  _buildWelcomePlaceholder(rightPanel);

  // ── Wire connect button ───────────────────────────────────────────────────
  _wireConnectBar(state);

  // ── Build all left-panel steps ────────────────────────────────────────────
  buildSourcesPanel(sourcesEl, state);
  buildPresentationPanel(presentationEl, state);
  buildBriefsPanel(briefsEl, state);
  buildGenerationPanel(generationEl, state, layout);
  buildExportPanel(exportEl, state);
}

/**
 * Wire the connection bar at the top of the page.
 *
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @returns {void}
 */
function _wireConnectBar(state) {
  const apiKeyEl  = document.getElementById('api-key');
  const btn       = document.getElementById('connect-btn');
  const statusEl  = document.getElementById('conn-status');

  if (!btn) return;

  btn.addEventListener('click', async () => {
    const apiKey = apiKeyEl?.value?.trim() || '';
    if (!apiKey) {
      if (statusEl) statusEl.textContent = 'API key required';
      return;
    }
    if (statusEl) statusEl.textContent = 'Connecting…';
    btn.disabled = true;
    try {
      await window.__tool.connect({ apiKey });
      if (statusEl) statusEl.textContent = 'Connected ✓';
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    }
    btn.disabled = false;
  });
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
