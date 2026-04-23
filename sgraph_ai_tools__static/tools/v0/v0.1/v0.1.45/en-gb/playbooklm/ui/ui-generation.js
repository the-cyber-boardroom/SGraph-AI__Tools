/**
 * PlaybookLM — Step 4: Generation panel with fractal slide workspace.
 *
 * v0.1.2 changes:
 *  - Slide workspace: each slide tab now contains a nested sg-layout with:
 *      Left (38%): slide info panel — title, version history list, editable
 *                  brief prompt + system prompt, per-version stats.
 *      Right (62%): image preview with version navigation (◀ / ▶), Regenerate
 *                   button, and download link.
 *  - Version history: shows all generated versions for a slide; clicking a
 *    version entry calls state.setSelectedVersion() to switch the display.
 *  - Iterative editing: user can edit brief/system prompt and click
 *    "New Version" to regenerate with the custom prompt. New version is added
 *    to the version history and selected automatically.
 *  - state.onChange() drives all reactive updates inside the workspace.
 *
 * @module ui-generation
 * @version 0.1.2
 */

import { SgLayout }                              from '/core/sg-layout/v0.1.0/sg-layout.js';
import { buildModelSelector, getPhaseModel }     from './ui-model-config.js';

/**
 * Build the Step 4 Generation panel.
 *
 * @param {HTMLElement} container
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {object} layout - outer sg-layout instance
 * @param {(n: number) => void} setStep
 * @param {Map<number, string>} [sharedTabMap] - shared tab map from shell (also used by deck view)
 * @returns {void}
 */
export function buildGenerationPanel(container, state, layout, setStep, sharedTabMap) {
  container.style.cssText = 'overflow-y:auto;height:100%;box-sizing:border-box;padding:16px;background:#0d0d1a;font-family:system-ui,sans-serif;display:flex;flex-direction:column;gap:12px;';

  container.innerHTML = `
    <h2 class="plm-step-title">Step 4 &mdash; Generate Slides</h2>
    <p class="plm-step-desc">Generate slide images from your briefs. Each slide opens as a tab with full version history.</p>
    <div id="plm-model-selector-4"></div>
    <div class="plm-row-controls">
      <button id="plm-gen-all-btn" class="plm-btn-primary">Generate All Slides</button>
      <button id="plm-stop-btn" class="plm-btn-danger" style="display:none;">Stop</button>
      <span id="plm-gen-status" class="plm-status-text"></span>
    </div>
    <div id="plm-slide-grid" class="plm-slide-grid"></div>
  `;

  container.querySelector('#plm-model-selector-4').appendChild(buildModelSelector(4));

  const genAllBtn = container.querySelector('#plm-gen-all-btn');
  const stopBtn   = container.querySelector('#plm-stop-btn');
  const statusEl  = container.querySelector('#plm-gen-status');
  const gridEl    = container.querySelector('#plm-slide-grid');

  /** @type {Map<number, string>} slide index → tabId (shared with deck view if provided) */
  const _tabMap = sharedTabMap || new Map();
  /** @type {Map<number, () => void>} slide index → refresh function */
  const _refreshMap = new Map();

  function _renderGrid() {
    const briefs  = state.getSlideBriefs();
    const results = state.getSlideResults();
    gridEl.innerHTML = '';

    briefs.forEach((brief, i) => {
      const res  = results.find(r => r.index === i);
      const vers = state.getSlideVersions(i);
      const card = document.createElement('div');
      card.className = `plm-slide-card ${res ? `plm-slide-${res.status}` : ''}`;

      const vLabel = vers.length > 0 ? ` <span style="color:#4ECDC4;font-size:10px;">(v${vers.length})</span>` : '';
      card.innerHTML = `
        <div class="plm-slide-card-num">${i + 1}</div>
        <div class="plm-slide-card-title">${_esc(brief.title)}${vLabel}</div>
        <div class="plm-slide-card-status">${_statusLabel(res)}</div>
        <button class="plm-btn-secondary plm-slide-gen-btn" data-index="${i}" ${!state.connected ? 'disabled' : ''}>
          ${res?.status === 'complete' ? 'New Version' : 'Generate'}
        </button>
      `;

      if (res?.status === 'complete' && _tabMap.has(i)) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', e => {
          if (!e.target.closest('button')) {
            const tabId = _tabMap.get(i);
            if (tabId) layout.activateTab?.(tabId);
          }
        });
      }

      card.querySelector('.plm-slide-gen-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!state.connected) { statusEl.textContent = 'Connect first'; return; }
        await _generateOne(i);
      });

      gridEl.appendChild(card);
    });
  }

  async function _generateOne(index) {
    const briefs = state.getSlideBriefs();
    statusEl.textContent = `Generating slide ${index + 1}\u2026`;
    statusEl.className = 'plm-status-text plm-status-info';

    // Create or reuse tab
    let tabId = _tabMap.get(index);
    if (!tabId) {
      tabId = layout.addTabToStack('s-right', { tag: 'div', title: `Slide ${index + 1}` });
      _tabMap.set(index, tabId);
    }
    const panelEl = layout.getPanelElement(tabId);
    layout.activateTab?.(tabId);

    // Show loading while generating, build workspace after
    _renderSlideLoading(panelEl, briefs[index].title, index + 1);

    try {
      await window.__tool.generateSlide({ index, model: getPhaseModel(4) });
      // Build or refresh the fractal workspace
      const existing = _refreshMap.get(index);
      if (existing) {
        existing();
      } else {
        const refresh = _buildSlideWorkspace(panelEl, state, layout, index);
        _refreshMap.set(index, refresh);
      }
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
      if (state.stopped) { statusEl.textContent = 'Stopped'; break; }
      statusEl.textContent = `Generating slide ${i + 1} of ${briefs.length}\u2026`;
      await _generateOne(i);
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

// ── Slide workspace (fractal sg-layout) ───────────────────────────────────────

/**
 * Build a fractal slide workspace inside the given panel element.
 * Returns a refresh() function to re-render after a new version is added.
 *
 * @param {HTMLElement} panel
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {object} outerLayout
 * @param {number} index
 * @returns {() => void} refresh function
 */
function _buildSlideWorkspace(panel, state, outerLayout, index) {
  panel.style.cssText = 'height:100%;overflow:hidden;display:block;background:#0d0d1a;';
  panel.innerHTML = '';

  // Fractal inner layout
  const innerLayout = document.createElement('sg-layout');
  innerLayout.style.cssText = 'width:100%;height:100%;display:block;';
  panel.appendChild(innerLayout);

  innerLayout.setLayout({
    type: 'row', id: `ws-${index}`, sizes: [0.38, 0.62],
    children: [
      { type: 'stack', id: `ws-info-${index}`, activeTab: 0,
        tabs: [{ id: `ws-info-tab-${index}`, title: 'Slide Info', tag: 'div', locked: true, closable: false }] },
      { type: 'stack', id: `ws-img-${index}`, activeTab: 0,
        tabs: [{ id: `ws-img-tab-${index}`, title: 'Image', tag: 'div', locked: true, closable: false }] },
    ],
  });

  const infoEl = innerLayout.getPanelElement(`ws-info-tab-${index}`);
  const imgEl  = innerLayout.getPanelElement(`ws-img-tab-${index}`);

  _renderInfoPanel(infoEl, state, outerLayout, index);
  _renderImagePanel(imgEl, state, index);

  // Return refresh function
  function refresh() {
    _renderInfoPanel(infoEl, state, outerLayout, index);
    _renderImagePanel(imgEl, state, index);
  }
  return refresh;
}

/**
 * Render the left info panel: version history, stats, editable prompts.
 *
 * @param {HTMLElement} el
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {object} outerLayout
 * @param {number} index
 * @returns {void}
 */
function _renderInfoPanel(el, state, outerLayout, index) {
  const briefs   = state.getSlideBriefs();
  const brief    = briefs[index] || { title: '', prompt: '' };
  const versions = state.getSlideVersions(index);
  const selIdx   = state.getSelectedVersion(index);

  el.style.cssText = 'height:100%;overflow-y:auto;background:#0d0d1a;padding:12px;box-sizing:border-box;font-family:system-ui,sans-serif;display:flex;flex-direction:column;gap:10px;';
  el.innerHTML = '';

  // ── Title ──────────────────────────────────────────────────────────────────
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:13px;font-weight:700;color:#e2e8f0;border-bottom:1px solid #1e2035;padding-bottom:8px;';
  titleEl.textContent = `Slide ${index + 1}: ${brief.title}`;
  el.appendChild(titleEl);

  // ── Version history ────────────────────────────────────────────────────────
  if (versions.length > 0) {
    const verSect = document.createElement('div');
    verSect.innerHTML = `<div style="font-size:10px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Versions (${versions.length})</div>`;

    const verList = document.createElement('div');
    verList.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    versions.forEach((ver, vIdx) => {
      const isActive = vIdx === selIdx;
      const row = document.createElement('div');
      row.style.cssText = isActive
        ? 'background:#1a2744;border:1px solid #4ECDC4;border-radius:4px;padding:6px 8px;cursor:pointer;font-size:11px;'
        : 'background:#111827;border:1px solid #1e2035;border-radius:4px;padding:6px 8px;cursor:pointer;font-size:11px;';

      const ts   = new Date(ver.ts).toLocaleTimeString();
      const cost = `$${(ver.cost || 0).toFixed(5)}`;
      const lat  = ver.latencyMs ? `${(ver.latencyMs / 1000).toFixed(1)}s` : '';

      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:${isActive ? '#4ECDC4' : '#a0aec0'};font-weight:${isActive ? '700' : '400'};">v${vIdx + 1}${isActive ? ' ✓' : ''}</span>
          <span style="color:#f6c90e;">${cost}</span>
        </div>
        <div style="color:#4a5568;margin-top:2px;">${ts}${lat ? ' · ' + lat : ''}</div>
        <div style="color:#64748b;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_escAttr(ver.model)}">${ver.model.split('/').pop()}</div>
      `;

      row.addEventListener('click', () => {
        state.setSelectedVersion(index, vIdx);
        _renderInfoPanel(el, state, outerLayout, index);
        // Re-render image panel in parent
        const imgTabId = `ws-img-tab-${index}`;
        try {
          const imgEl = el.closest('sg-layout')?.getPanelElement?.(imgTabId)
            || document.querySelector(`[data-panel-id="${imgTabId}"]`);
          if (imgEl) _renderImagePanel(imgEl, state, index);
        } catch (_) {}
      });

      verList.appendChild(row);
    });

    verSect.appendChild(verList);
    el.appendChild(verSect);

    // ── Selected version stats ───────────────────────────────────────────────
    if (selIdx >= 0 && versions[selIdx]) {
      const ver = versions[selIdx];
      const statEl = document.createElement('div');
      statEl.style.cssText = 'background:#111827;border:1px solid #1e2035;border-radius:4px;padding:8px;font-size:11px;color:#718096;';
      statEl.innerHTML = `
        <div style="font-size:10px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">v${selIdx + 1} Details</div>
        <div>Model: <span style="color:#a0aec0;">${_esc(ver.model)}</span></div>
        <div>Cost: <span style="color:#f6c90e;">$${(ver.cost || 0).toFixed(6)}</span></div>
        <div>Latency: <span style="color:#a0aec0;">${ver.latencyMs}ms</span></div>
        <div>Generated: <span style="color:#a0aec0;">${new Date(ver.ts).toLocaleString()}</span></div>
      `;
      el.appendChild(statEl);
    }
  }

  // ── Editable brief prompt ──────────────────────────────────────────────────
  const briefSect = document.createElement('div');
  briefSect.innerHTML = `<div style="font-size:10px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Visual Brief (editable)</div>`;

  const briefTa = document.createElement('textarea');
  briefTa.value = (versions[selIdx]?.briefPrompt) || brief.prompt;
  briefTa.style.cssText = 'width:100%;height:80px;resize:vertical;background:#111827;border:1px solid #1e2035;border-radius:4px;color:#a0aec0;font-size:11px;padding:6px;box-sizing:border-box;font-family:ui-monospace,"Cascadia Code","Fira Mono",monospace;line-height:1.5;';
  briefSect.appendChild(briefTa);
  el.appendChild(briefSect);

  // ── Editable system prompt ─────────────────────────────────────────────────
  const sysSect = document.createElement('div');
  sysSect.innerHTML = `<div style="font-size:10px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">System Prompt (editable)</div>`;

  const DEFAULT_SYS = `You are an expert visual communicator and presentation designer.
Create visually striking, clear, and professional slide images.
Use a dark background (#0a0a1a) with teal accents (#4ECDC4), white headlines, and clear hierarchy.
Each slide should have a strong visual composition with one key idea per slide.`;

  const sysTa = document.createElement('textarea');
  sysTa.value = (versions[selIdx]?.systemPrompt) || DEFAULT_SYS;
  sysTa.style.cssText = 'width:100%;height:80px;resize:vertical;background:#111827;border:1px solid #1e2035;border-radius:4px;color:#a0aec0;font-size:11px;padding:6px;box-sizing:border-box;font-family:ui-monospace,"Cascadia Code","Fira Mono",monospace;line-height:1.5;';
  sysSect.appendChild(sysTa);
  el.appendChild(sysSect);

  // ── New Version button ─────────────────────────────────────────────────────
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;align-items:center;';

  const regenBtn = document.createElement('button');
  regenBtn.className = 'plm-btn-primary';
  regenBtn.textContent = versions.length > 0 ? 'Generate New Version' : 'Generate';
  regenBtn.style.cssText += 'font-size:12px;padding:6px 14px;';

  const regenStatus = document.createElement('span');
  regenStatus.className = 'plm-status-text';

  regenBtn.addEventListener('click', async () => {
    if (!state.connected) { regenStatus.textContent = 'Connect first'; return; }
    regenBtn.disabled = true;
    regenStatus.textContent = 'Generating\u2026';
    regenStatus.className = 'plm-status-text plm-status-info';

    try {
      await window.__tool.generateSlide({
        index,
        model:              getPhaseModel(4),
        customBrief:        briefTa.value.trim() || undefined,
        customSystemPrompt: sysTa.value.trim() || undefined,
      });
      regenStatus.textContent = 'Done \u2713';
      regenStatus.className = 'plm-status-text plm-status-ok';
      // Refresh this panel (versions list + stats updated)
      _renderInfoPanel(el, state, outerLayout, index);
    } catch (err) {
      regenStatus.textContent = `Error: ${err.message}`;
      regenStatus.className = 'plm-status-text plm-status-error';
    } finally {
      regenBtn.disabled = false;
    }
  });

  btnRow.appendChild(regenBtn);
  btnRow.appendChild(regenStatus);
  el.appendChild(btnRow);
}

/**
 * Render the right image panel for the currently selected version.
 *
 * @param {HTMLElement} el
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {number} index
 * @returns {void}
 */
function _renderImagePanel(el, state, index) {
  const versions = state.getSlideVersions(index);
  const selIdx   = state.getSelectedVersion(index);
  const briefs   = state.getSlideBriefs();
  const brief    = briefs[index] || { title: '' };

  el.style.cssText = 'height:100%;overflow:hidden;background:#0d0d1a;display:flex;flex-direction:column;';
  el.innerHTML = '';

  if (!versions.length) {
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    const ph = document.createElement('div');
    ph.style.cssText = 'color:#4a5568;font-family:system-ui,sans-serif;font-size:13px;text-align:center;';
    ph.textContent = 'No image generated yet.';
    el.appendChild(ph);
    return;
  }

  const ver = versions[selIdx] || versions[versions.length - 1];

  // ── Top bar ────────────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #1a1a3a;flex-shrink:0;font-family:system-ui,sans-serif;';

  const titleSpan = document.createElement('span');
  titleSpan.style.cssText = 'font-size:12px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
  titleSpan.textContent = `Slide ${index + 1}: ${brief.title}`;
  bar.appendChild(titleSpan);

  // Version nav
  const navWrap = document.createElement('div');
  navWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:8px;';

  const prevBtn = document.createElement('button');
  prevBtn.textContent = '\u25C0';
  prevBtn.style.cssText = 'background:none;border:1px solid #1e2035;border-radius:3px;color:#718096;padding:2px 7px;cursor:pointer;font-size:11px;';
  prevBtn.disabled = selIdx <= 0;

  const verLabel = document.createElement('span');
  verLabel.style.cssText = 'font-size:11px;color:#718096;min-width:50px;text-align:center;';
  verLabel.textContent = `v${selIdx + 1} / ${versions.length}`;

  const nextBtn = document.createElement('button');
  nextBtn.textContent = '\u25B6';
  nextBtn.style.cssText = 'background:none;border:1px solid #1e2035;border-radius:3px;color:#718096;padding:2px 7px;cursor:pointer;font-size:11px;';
  nextBtn.disabled = selIdx >= versions.length - 1;

  prevBtn.addEventListener('click', () => {
    if (selIdx > 0) {
      state.setSelectedVersion(index, selIdx - 1);
      _renderImagePanel(el, state, index);
    }
  });

  nextBtn.addEventListener('click', () => {
    if (selIdx < versions.length - 1) {
      state.setSelectedVersion(index, selIdx + 1);
      _renderImagePanel(el, state, index);
    }
  });

  navWrap.appendChild(prevBtn);
  navWrap.appendChild(verLabel);
  navWrap.appendChild(nextBtn);

  const dlBtn = document.createElement('a');
  dlBtn.textContent = 'Download';
  dlBtn.href = ver.imageSrc;
  dlBtn.download = `slide-${String(index + 1).padStart(2, '0')}-v${selIdx + 1}.png`;
  dlBtn.className = 'plm-btn-secondary';
  dlBtn.style.cssText += 'text-decoration:none;font-size:11px;padding:3px 10px;margin-left:8px;';

  bar.appendChild(navWrap);
  bar.appendChild(dlBtn);
  el.appendChild(bar);

  // ── Image ──────────────────────────────────────────────────────────────────
  const imgWrap = document.createElement('div');
  imgWrap.style.cssText = 'flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:12px;';

  const img = document.createElement('img');
  img.src = ver.imageSrc;
  img.alt = `Slide ${index + 1} v${selIdx + 1}`;
  img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;box-shadow:0 4px 24px rgba(0,0,0,0.6);';
  imgWrap.appendChild(img);
  el.appendChild(imgWrap);
}

// ── Loading / error states ─────────────────────────────────────────────────────

/**
 * @param {HTMLElement} panel
 * @param {string} title
 * @param {number} num
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
 * @param {HTMLElement} panel
 * @param {string} errorMsg
 * @param {number} num
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
 * @param {{status: string}|undefined} res
 * @returns {string}
 */
function _statusLabel(res) {
  if (!res) return 'Not generated';
  const map = { pending: 'Pending', generating: 'Generating\u2026', complete: 'Done', error: 'Error' };
  return map[res.status] || res.status;
}

/** @param {string} s */
function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** @param {string} s */
function _escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
