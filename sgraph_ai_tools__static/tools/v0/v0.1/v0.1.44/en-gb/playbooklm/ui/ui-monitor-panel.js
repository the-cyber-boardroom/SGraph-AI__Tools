/**
 * PlaybookLM — Right-panel monitor pane (v0.1.44).
 *
 * Three tabs backed by existing platform components:
 *
 *  1. LLM Inspector — <sg-llm-response-inspector> on a persistent [data-llm-bus]
 *     container. Receives llm:request-complete events relayed from plm:llm-log:
 *       - text calls:  'done' phase → synthetic REQUEST_COMPLETE from rawResponse
 *       - image calls: 'response-raw' phase → full sg-llm-request ev.detail
 *
 *  2. Tool Console — <sg-tool-api-console> bound to window.__tool (19 methods).
 *
 *  3. Gen IDs — Custom list of OpenRouter generation IDs collected from
 *     plm:llm-log events. "Fetch cost" button calls OpenRouter generation API.
 *
 * @module ui-monitor-panel
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';

const TABS = [
  { id: 'llm',     label: '\uD83D\uDD0D LLM' },
  { id: 'console', label: '\u26A1 Console' },
  { id: 'genids',  label: '\uD83D\uDD11 Gen IDs' },
];

/**
 * Build the monitoring pane into the given container element.
 *
 * @param {HTMLElement} container - Must be sized (flex column, 100% height).
 * @returns {void}
 */
export function buildMonitorPanel(container) {
  container.style.cssText =
    'display:flex;flex-direction:column;height:100%;background:#0d0d1a;overflow:hidden;font-family:system-ui,sans-serif;';

  // ── Tab bar ──────────────────────────────────────────────────────────────
  const tabBar = document.createElement('div');
  tabBar.style.cssText =
    'display:flex;gap:2px;padding:6px 8px 0;border-bottom:1px solid #1e2035;flex-shrink:0;background:#0d0d1a;';
  container.appendChild(tabBar);

  const panelWrap = document.createElement('div');
  panelWrap.style.cssText = 'flex:1;min-height:0;overflow:hidden;position:relative;';
  container.appendChild(panelWrap);

  /** @type {Record<string, HTMLElement>} */
  const panels = {};
  /** @type {Record<string, HTMLButtonElement>} */
  const tabBtns = {};
  let _active = 'llm';

  function _switchTab(id) {
    _active = id;
    for (const [tid, btn] of Object.entries(tabBtns)) {
      const on = tid === id;
      btn.style.cssText = on
        ? 'padding:4px 12px;border-radius:4px 4px 0 0;color:#7c9ef8;background:#111827;border:1px solid #1e2035;border-bottom:none;font-size:12px;cursor:pointer;font-family:system-ui,sans-serif;'
        : 'padding:4px 12px;border-radius:4px 4px 0 0;color:#64748b;background:none;border:1px solid transparent;border-bottom:none;font-size:12px;cursor:pointer;font-family:system-ui,sans-serif;';
    }
    for (const [pid, el] of Object.entries(panels)) {
      el.style.display = pid === id ? '' : 'none';
    }
  }

  for (const { id, label } of TABS) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText =
      'padding:4px 12px;border-radius:4px 4px 0 0;color:#64748b;background:none;border:1px solid transparent;border-bottom:none;font-size:12px;cursor:pointer;font-family:system-ui,sans-serif;';
    btn.addEventListener('click', () => _switchTab(id));
    tabBtns[id] = btn;
    tabBar.appendChild(btn);
  }

  // ── Panel 1: LLM Inspector ────────────────────────────────────────────────
  const llmBus = document.createElement('div');
  llmBus.setAttribute('data-llm-bus', '');
  llmBus.style.cssText = 'height:100%;overflow:hidden;';

  const inspector = document.createElement('sg-llm-response-inspector');
  llmBus.appendChild(inspector);
  panelWrap.appendChild(llmBus);
  panels.llm = llmBus;

  // Relay plm:llm-log → llm:request-complete on the bus
  document.addEventListener('plm:llm-log', (e) => {
    const d = e.detail;

    // Image: 'response-raw' has the full sg-llm-request REQUEST_COMPLETE detail object
    if (d.phase === 'response-raw' && d.rawDetail) {
      llmBus.dispatchEvent(new CustomEvent(SGL_LLM.REQUEST_COMPLETE, { detail: d.rawDetail }));
      return;
    }

    // Text: 'done' phase — construct a synthetic REQUEST_COMPLETE
    if (d.phase === 'done' && d.type === 'text') {
      const raw = d.rawResponse;
      llmBus.dispatchEvent(new CustomEvent(SGL_LLM.REQUEST_COMPLETE, {
        detail: {
          model:             d.model,
          content:           raw?.choices?.[0]?.message?.content ?? d.responsePreview ?? '',
          promptTokens:      d.usage?.prompt_tokens,
          completionTokens:  d.usage?.completion_tokens,
          cost:              d.cost,
          latencyMs:         d.latencyMs,
          finishReason:      raw?.choices?.[0]?.finish_reason ?? 'stop',
          images:            [],
          rawChunks:         [],
          rawResponse:       raw ?? null,
        },
      }));
    }
  });

  // ── Panel 2: Tool Console ────────────────────────────────────────────────
  const consolePnl = document.createElement('div');
  consolePnl.style.cssText = 'height:100%;display:none;overflow:hidden;';
  const toolConsole = document.createElement('sg-tool-api-console');
  consolePnl.appendChild(toolConsole);
  panelWrap.appendChild(consolePnl);
  panels.console = consolePnl;

  // ── Panel 3: Gen IDs ─────────────────────────────────────────────────────
  const genPnl = document.createElement('div');
  genPnl.style.cssText =
    'height:100%;display:none;overflow:auto;padding:12px;box-sizing:border-box;background:#0d0d1a;';
  panelWrap.appendChild(genPnl);
  panels.genids = genPnl;
  _buildGenIdsPanel(genPnl);

  // Activate first tab
  _switchTab('llm');
}

/**
 * Build the Generation IDs sub-panel.
 * Listens for plm:llm-log events and collects OpenRouter generation IDs.
 *
 * @param {HTMLElement} container
 * @returns {void}
 */
function _buildGenIdsPanel(container) {
  /** @type {Array<{generationId:string, model:string, type:string, cost:number|null, ts:number}>} */
  const _entries = [];

  // Header row
  const hdr = document.createElement('div');
  hdr.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';

  const title = document.createElement('span');
  title.style.cssText =
    'font-size:11px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.06em;';
  title.textContent = 'OpenRouter Generation IDs';
  hdr.appendChild(title);

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.cssText =
    'background:none;border:1px solid #2d2d5e;border-radius:3px;color:#4a5568;font-size:11px;padding:2px 8px;cursor:pointer;';
  clearBtn.addEventListener('click', () => { _entries.length = 0; _render(); });
  hdr.appendChild(clearBtn);
  container.appendChild(hdr);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  container.appendChild(list);

  const empty = document.createElement('div');
  empty.style.cssText =
    'text-align:center;color:#334155;font-size:12px;padding:40px 0;';
  empty.textContent = 'No generation IDs yet. Run a pipeline step to capture them.';
  container.appendChild(empty);

  function _render() {
    list.innerHTML = '';
    empty.style.display = _entries.length ? 'none' : '';

    for (const entry of _entries) {
      const card = document.createElement('div');
      card.style.cssText =
        'background:#111827;border:1px solid #1e2035;border-radius:4px;padding:8px 10px;font-family:ui-monospace,"Cascadia Code","Fira Mono",monospace;font-size:11px;';

      // Top row: type badge + model name + cost
      const top = document.createElement('div');
      top.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';

      const badge = document.createElement('span');
      badge.style.cssText = entry.type === 'image'
        ? 'font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:#0d3d3a;color:#4ECDC4;border:1px solid #2c7a73;text-transform:uppercase;letter-spacing:0.05em;flex-shrink:0;'
        : 'font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:#3b2d8a;color:#c4b5fd;border:1px solid #5b21b6;text-transform:uppercase;letter-spacing:0.05em;flex-shrink:0;';
      badge.textContent = entry.type;
      top.appendChild(badge);

      const modelEl = document.createElement('span');
      modelEl.style.cssText = 'color:#a0aec0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:11px;';
      modelEl.textContent = entry.model.split('/').pop();
      modelEl.title = entry.model;
      top.appendChild(modelEl);

      if (entry.cost != null && entry.cost > 0) {
        const costEl = document.createElement('span');
        costEl.style.cssText = 'color:#f6c90e;white-space:nowrap;font-size:11px;flex-shrink:0;';
        costEl.textContent = `$${entry.cost.toFixed(5)}`;
        top.appendChild(costEl);
      }
      card.appendChild(top);

      // ID row: truncated ID + "Fetch cost" button
      const idRow = document.createElement('div');
      idRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

      const idSpan = document.createElement('span');
      idSpan.style.cssText =
        'color:#4a5568;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:11px;';
      idSpan.textContent = entry.generationId;
      idSpan.title = entry.generationId;
      idRow.appendChild(idSpan);

      const fetchBtn = document.createElement('button');
      fetchBtn.textContent = 'Fetch cost';
      fetchBtn.style.cssText =
        'background:none;border:1px solid #2d2d5e;border-radius:3px;color:#4a5568;font-size:10px;padding:2px 8px;cursor:pointer;white-space:nowrap;flex-shrink:0;';

      fetchBtn.addEventListener('click', async () => {
        fetchBtn.textContent = '\u2026';
        fetchBtn.disabled = true;
        try {
          const r = await fetch(`https://openrouter.ai/api/v1/generation?id=${entry.generationId}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = await r.json();
          const tc = j?.data?.total_cost;
          if (tc != null) {
            fetchBtn.textContent = `$${Number(tc).toFixed(6)}`;
            fetchBtn.style.color = '#f6c90e';
          } else {
            fetchBtn.textContent = 'No cost data';
            fetchBtn.style.color = '#718096';
          }
        } catch (err) {
          fetchBtn.textContent = `Error`;
          fetchBtn.title = err.message;
          fetchBtn.style.color = '#fc8181';
        }
      });
      idRow.appendChild(fetchBtn);
      card.appendChild(idRow);
      list.appendChild(card);
    }
  }

  // Listen for plm:llm-log events to capture generation IDs
  document.addEventListener('plm:llm-log', (e) => {
    const d = e.detail;
    if (!d.generationId) return;

    // Avoid duplicates (response-raw and done can carry same ID)
    if (_entries.some(x => x.generationId === d.generationId)) return;

    // Capture from 'done' (text) or 'response-raw' (image)
    if (d.phase !== 'done' && d.phase !== 'response-raw') return;

    _entries.unshift({
      generationId: d.generationId,
      model:        d.model,
      type:         d.type,
      cost:         d.cost ?? null,
      ts:           d.ts,
    });

    if (_entries.length > 50) _entries.length = 50;
    _render();
  });

  _render();
}
