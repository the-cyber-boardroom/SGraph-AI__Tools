/**
 * Infographic Generator — result panel builders.
 * Sets up the fractal inner layouts used for each generated result:
 *   setupResultFractal  — image viewer | details split
 *   setupLoadingState   — loading spinner inside image pane
 *   setupDetailsPanel   — context / generation split in details pane
 *   extractImageSrc     — pulls an image URL out of an LLM response
 *
 * @module panels
 * @version 0.1.25
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';

// ── Fractal result tab setup ───────────────────────────────────────────────────

let fractalCounter = 0;

/**
 * Creates an inner sg-layout inside panelEl with two panes:
 * - left (65%): image/infographic viewer
 * - right (35%): details (model, stats, controls)
 * @param {HTMLElement} panelEl
 * @param {string} model
 * @returns {Promise<{imgPanel: HTMLElement, detailsPanel: HTMLElement}>}
 */
async function setupResultFractal(panelEl, model) {
    const id = ++fractalCounter;
    panelEl.style.cssText = 'width:100%;height:100%;display:block;overflow:hidden;';

    const inner = document.createElement('sg-layout');
    inner.style.cssText = 'width:100%;height:100%;display:block;';
    panelEl.appendChild(inner);

    const ready = new Promise(resolve => inner.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
    inner.setLayout({
        type: 'row', id: `fr${id}`, sizes: [0.65, 0.35],
        children: [
            { type: 'stack', id: `fi${id}`, activeTab: 0,
              tabs: [{ type: 'tab', id: `fti${id}`, title: 'Infographic', tag: 'div', locked: true, closable: false }] },
            { type: 'stack', id: `fd${id}`, activeTab: 0,
              tabs: [{ type: 'tab', id: `ftd${id}`, title: 'Details', tag: 'div', locked: false, closable: false }] },
        ],
    });
    await ready;

    const imgPanel     = inner.getPanelElement(`fti${id}`);
    const detailsPanel = inner.getPanelElement(`ftd${id}`);
    return { imgPanel, detailsPanel };
}

/**
 * Populates the image panel with a loading state (spinner text + timer + cancel button).
 * Sets panelEl._clearTimer and panelEl._cancel.
 * @param {HTMLElement} imgPanel
 * @param {string} model
 */
function setupLoadingState(imgPanel, model) {
    imgPanel.style.cssText = 'position:relative;height:100%;overflow:hidden;background:#0d0d1a;display:block;';

    const loadDiv = document.createElement('div');
    loadDiv.dataset.role = 'loading';
    loadDiv.style.cssText = [
        'position:absolute', 'inset:0', 'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center', 'gap:10px',
        'font-family:system-ui,sans-serif',
    ].join(';');

    const modelLbl = document.createElement('div');
    modelLbl.style.cssText = 'font-size:12px;color:#4a5568;font-weight:600;';
    modelLbl.textContent = model;

    const statusLbl = document.createElement('div');
    statusLbl.style.cssText = 'font-size:15px;color:#a0aec0;';
    statusLbl.textContent = 'Generating\u2026';

    const elapsedLbl = document.createElement('div');
    elapsedLbl.style.cssText = 'font-size:13px;color:#4a5568;';
    elapsedLbl.textContent = '0s elapsed';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '\u25a0 Cancel';
    cancelBtn.style.cssText = [
        'background:#7f1d1d', 'border:none', 'border-radius:6px', 'color:#fca5a5',
        'padding:6px 16px', 'font-size:13px', 'font-weight:600', 'cursor:pointer', 'margin-top:4px',
    ].join(';');
    cancelBtn.addEventListener('click', () => imgPanel._cancel?.());

    loadDiv.appendChild(modelLbl);
    loadDiv.appendChild(statusLbl);
    loadDiv.appendChild(elapsedLbl);
    loadDiv.appendChild(cancelBtn);
    imgPanel.appendChild(loadDiv);

    const t0 = Date.now();
    const timer = setInterval(() => {
        elapsedLbl.textContent = `${Math.floor((Date.now() - t0) / 1000)}s elapsed`;
    }, 1000);
    imgPanel._clearTimer = () => clearInterval(timer);

    // Preallocate image (hidden until result arrives)
    const img = document.createElement('img');
    img.style.cssText = 'display:none;position:absolute;inset:0;margin:auto;max-width:100%;max-height:100%;object-fit:contain;width:auto;height:auto;';
    imgPanel.appendChild(img);
}

/**
 * Populates the details panel with a resizable sg-layout column split:
 *   top  — Context  (stats, editable prompts, export via sg-infographic-export)
 *   bottom — Generation (sg-openrouter-generation)
 * @param {HTMLElement} detailsPanel
 * @param {string} model
 * @param {{ systemPrompt?: string, doc?: object, direction?: string }} ctx
 * @returns {Promise<{ update: (detail: object) => void, showGeneration: (id: string, key: string) => void, setExportSource: (src: string, filename: string) => void }>}
 */
async function setupDetailsPanel(detailsPanel, model, ctx = {}) {
    detailsPanel.style.cssText = 'width:100%;height:100%;display:block;overflow:hidden;';

    // ── Inner sg-layout: Context (top) | Generation (bottom) ─────────────────
    const id    = ++fractalCounter;
    const inner = document.createElement('sg-layout');
    inner.style.cssText = 'width:100%;height:100%;display:block;';
    detailsPanel.appendChild(inner);

    const ready = new Promise(resolve => inner.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
    inner.setLayout({
        type: 'column', id: `dl${id}`, sizes: [0.45, 0.55],
        children: [
            { type: 'stack', id: `dc${id}`, activeTab: 0,
              tabs: [{ type: 'tab', id: `dct${id}`, title: 'Context', tag: 'div', locked: true, closable: false }] },
            { type: 'stack', id: `dg${id}`, activeTab: 0,
              tabs: [{ type: 'tab', id: `dgt${id}`, title: 'Generation', tag: 'div', locked: true, closable: false }] },
        ],
    });
    await ready;

    const ctxPanel = inner.getPanelElement(`dct${id}`);
    const genPanel = inner.getPanelElement(`dgt${id}`);

    // ── Helpers (append into ctxPanel) ───────────────────────────────────────
    ctxPanel.style.cssText = 'height:100%;overflow:auto;background:#0a0a18;display:block;padding:12px;box-sizing:border-box;font-family:system-ui,sans-serif;';

    const lbl = text => {
        const d = document.createElement('div');
        d.style.cssText = 'font-size:10px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px;margin-top:10px;';
        d.textContent = text;
        ctxPanel.appendChild(d);
        return d;
    };
    const val = text => {
        const d = document.createElement('div');
        d.style.cssText = 'font-size:13px;color:#a0aec0;margin-bottom:4px;';
        d.textContent = text || '\u2014';
        ctxPanel.appendChild(d);
        return d;
    };
    const editArea = (content, placeholder, rows = 3) => {
        const ta = document.createElement('textarea');
        ta.value = content || '';
        ta.placeholder = placeholder || '';
        ta.rows = rows;
        ta.style.cssText = [
            'width:100%', 'box-sizing:border-box', 'resize:vertical',
            'background:#111122', 'border:1px solid #1a1a3a', 'border-radius:4px',
            'color:#a0aec0', 'padding:6px 8px', 'font-size:11px', 'line-height:1.5',
            'outline:none', 'font-family:system-ui,sans-serif', 'margin-bottom:4px',
        ].join(';');
        ta.addEventListener('focus', () => ta.style.borderColor = '#4ECDC4');
        ta.addEventListener('blur',  () => ta.style.borderColor = '#1a1a3a');
        ctxPanel.appendChild(ta);
        return ta;
    };
    const sep = () => {
        const hr = document.createElement('hr');
        hr.style.cssText = 'border:none;border-top:1px solid #1a1a3a;margin:10px 0 4px;';
        ctxPanel.appendChild(hr);
    };

    // ── Stats ────────────────────────────────────────────────────────────────
    lbl('Model');
    const modelEl = val(model.split('/').pop());
    modelEl.title = model;
    lbl('Duration');
    const durationEl = val('\u2014');
    lbl('Tokens');
    const tokensEl = val('\u2014');

    sep();

    // ── Request context (editable) ────────────────────────────────────────────
    lbl('System Prompt');
    editArea(ctx.systemPrompt, 'System prompt\u2026', 4);

    if (ctx.doc) {
        lbl('Document');
        const docNameEl = document.createElement('div');
        docNameEl.style.cssText = 'font-size:12px;color:#4ECDC4;word-break:break-all;margin-bottom:2px;';
        docNameEl.textContent = ctx.doc.name;
        ctxPanel.appendChild(docNameEl);
        if (ctx.doc.textContent) {
            const est = document.createElement('div');
            est.style.cssText = 'font-size:11px;color:#4a5568;margin-bottom:4px;';
            est.textContent = `~${Math.round(ctx.doc.textContent.length / 4).toLocaleString()} tokens`;
            ctxPanel.appendChild(est);
        }
    }

    if (ctx.direction) {
        lbl('Direction');
        const dirTa = document.createElement('textarea');
        dirTa.value = ctx.direction;
        dirTa.placeholder = 'Direction\u2026';
        dirTa.rows = 2;
        dirTa.style.cssText = [
            'width:100%', 'box-sizing:border-box', 'resize:vertical',
            'background:#111122', 'border:1px solid #1a1a3a', 'border-left:3px solid #4ECDC4',
            'border-radius:4px', 'color:#e2e8f0', 'padding:6px 8px',
            'font-size:11px', 'line-height:1.5', 'outline:none',
            'font-family:system-ui,sans-serif', 'margin-bottom:4px',
        ].join(';');
        dirTa.addEventListener('focus', () => dirTa.style.borderLeftColor = '#81e6d9');
        dirTa.addEventListener('blur',  () => dirTa.style.borderLeftColor = '#4ECDC4');
        ctxPanel.appendChild(dirTa);
    }

    sep();

    // ── Export component ──────────────────────────────────────────────────────
    const exportEl = document.createElement('sg-infographic-export');
    exportEl.style.cssText = 'display:block;width:100%;';
    ctxPanel.appendChild(exportEl);

    // ── Generation panel (full-height sg-openrouter-generation) ──────────────
    genPanel.style.cssText = 'height:100%;display:block;overflow:hidden;';
    const genEl = document.createElement('sg-openrouter-generation');
    genEl.setAttribute('hide-recent', '');
    genEl.style.cssText = 'display:block;width:100%;height:100%;';
    genPanel.appendChild(genEl);

    const t0 = Date.now();
    return {
        update(detail) {
            durationEl.textContent = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
            const usage = detail?.usage;
            if (usage) {
                const total = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
                tokensEl.textContent = total > 0 ? `${total.toLocaleString()} tokens` : '\u2014';
            }
        },
        showGeneration(genId, apiKey) {
            genEl._apiKey = apiKey;
            genEl.fetchGeneration(genId);
        },
        setExportSource(src, filename) {
            exportEl.setSource(src, filename);
        },
    };
}

// ── Image src extraction ───────────────────────────────────────────────────────

/**
 * Extracts an image src URL from an LLM response detail object.
 * @param {object} detail
 * @returns {string|null}
 */
function extractImageSrc(detail) {
    const images = detail?.images;
    if (images?.length > 0) {
        const im = images[0];
        if (im.type === 'image_url' && im.image_url?.url) return im.image_url.url;
        if (im.type === 'image' && im.source?.data)
            return `data:${im.source.media_type || 'image/jpeg'};base64,${im.source.data}`;
    }
    const txt = detail?.content || '';
    const m = txt.match(/data:image\/[^;'"]+;base64,[A-Za-z0-9+/=]+/)
           || txt.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/)
           || txt.match(/https?:\/\/\S+\.(?:png|jpg|jpeg|webp|gif)/i);
    return m ? (m[1] || m[0]) : null;
}

export { setupResultFractal, setupLoadingState, setupDetailsPanel, extractImageSrc };
