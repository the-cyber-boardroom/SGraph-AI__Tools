/**
 * sg-llm-response-inspector — Collapsible JSON browser for LLM response data.
 *
 * Listens for llm:request-complete events and provides a structured view of:
 *   - Summary tab:  key fields (model, finish reason, tokens, latency, cost)
 *   - Images tab:   inline preview of any images returned by the provider
 *   - Chunks tab:   raw SSE chunks array with chunk-by-chunk navigation
 *   - Full Data tab: collapsible JSON tree of the entire response
 *
 * Compatible with OpenRouter, Anthropic, Ollama, OpenAI response shapes.
 * Relies on sg-llm-request v0.1.1+ which includes rawChunks[], images[], and
 * rawResponse in the REQUEST_COMPLETE event detail.
 *
 * Usage:
 *   <sg-llm-response-inspector></sg-llm-response-inspector>
 *   Place inside the same [data-llm-bus] container as sg-llm-request.
 *
 * @module sg-llm-response-inspector
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const STYLE = `
:host { display: block; height: 100%; }

* { box-sizing: border-box; }

.ri-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0d0d1a;
    color: #e2e8f0;
    font-family: monospace;
    font-size: 12px;
    overflow: hidden;
}

/* ── Tabs ────────────────────────────────────────────────────── */
.ri-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 8px 0;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
}
.ri-tab {
    padding: 4px 10px;
    cursor: pointer;
    border-radius: 4px 4px 0 0;
    color: #64748b;
    border: 1px solid transparent;
    border-bottom: none;
    background: none;
    font-family: monospace;
    font-size: 11px;
    transition: color 0.15s;
}
.ri-tab:hover { color: #94a3b8; }
.ri-tab.active {
    color: #7c9ef8;
    background: #111827;
    border-color: #1e2035;
}
.ri-tab .ri-badge {
    margin-left: 4px;
    background: #1e2035;
    border-radius: 8px;
    padding: 1px 5px;
    font-size: 10px;
    color: #64748b;
}
.ri-tab.active .ri-badge { color: #7c9ef8; }

/* ── Panels ──────────────────────────────────────────────────── */
.ri-panels { flex: 1; overflow: hidden; position: relative; }
.ri-panel {
    position: absolute;
    inset: 0;
    overflow: auto;
    padding: 10px;
    display: none;
}
.ri-panel.active { display: block; }

/* ── Empty state ─────────────────────────────────────────────── */
.ri-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #334155;
    gap: 8px;
}
.ri-empty-icon { font-size: 28px; }
.ri-empty-text { font-size: 11px; }

/* ── Summary table ───────────────────────────────────────────── */
.ri-summary-table {
    width: 100%;
    border-collapse: collapse;
}
.ri-summary-table tr:hover td { background: #111827; }
.ri-summary-table td {
    padding: 4px 8px;
    border-bottom: 1px solid #1e2035;
    vertical-align: top;
}
.ri-summary-table td:first-child {
    color: #64748b;
    width: 140px;
    white-space: nowrap;
}
.ri-summary-table td:last-child {
    color: #e2e8f0;
    word-break: break-all;
}

/* ── Images ──────────────────────────────────────────────────── */
.ri-images-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 4px;
}
.ri-image-card {
    border: 1px solid #1e2035;
    border-radius: 6px;
    overflow: hidden;
    max-width: 360px;
}
.ri-image-card img {
    display: block;
    max-width: 100%;
    max-height: 300px;
    object-fit: contain;
    background: #111827;
}
.ri-image-meta {
    padding: 4px 8px;
    color: #64748b;
    font-size: 10px;
    word-break: break-all;
}

/* ── Chunks ──────────────────────────────────────────────────── */
.ri-chunks-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding: 4px 0;
    border-bottom: 1px solid #1e2035;
}
.ri-chunks-controls button {
    padding: 3px 8px;
    background: #1e2035;
    border: 1px solid #2d3748;
    border-radius: 4px;
    color: #94a3b8;
    font-family: monospace;
    font-size: 11px;
    cursor: pointer;
}
.ri-chunks-controls button:hover { background: #283452; }
.ri-chunks-controls button:disabled { opacity: 0.4; cursor: default; }
.ri-chunk-counter { color: #64748b; font-size: 11px; }
.ri-chunk-view {
    background: #111827;
    border: 1px solid #1e2035;
    border-radius: 4px;
    padding: 8px;
    white-space: pre-wrap;
    word-break: break-all;
    color: #a5b4fc;
    font-size: 11px;
    max-height: calc(100% - 60px);
    overflow: auto;
}

/* ── JSON tree ───────────────────────────────────────────────── */
.ri-tree-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}
.ri-tree-controls button {
    padding: 3px 8px;
    background: #1e2035;
    border: 1px solid #2d3748;
    border-radius: 4px;
    color: #94a3b8;
    font-family: monospace;
    font-size: 11px;
    cursor: pointer;
}
.ri-tree-controls button:hover { background: #283452; }

.ri-tree { font-size: 11px; line-height: 1.6; }
.ri-tree-node { margin-left: 16px; }
.ri-tree-toggle {
    cursor: pointer;
    user-select: none;
    color: #64748b;
    margin-right: 3px;
    font-size: 9px;
    display: inline-block;
    width: 10px;
}
.ri-tree-key   { color: #93c5fd; }
.ri-tree-str   { color: #86efac; }
.ri-tree-num   { color: #fbbf24; }
.ri-tree-bool  { color: #f472b6; }
.ri-tree-null  { color: #64748b; }
.ri-tree-img-preview {
    display: inline-block;
    vertical-align: middle;
    max-height: 60px;
    max-width: 100px;
    margin: 2px 6px;
    border: 1px solid #1e2035;
    border-radius: 3px;
    cursor: pointer;
}
.ri-tree-collapsed > .ri-tree-node { display: none; }
`;

/**
 * Render a JSON value as a collapsible DOM tree.
 *
 * @param {*} value
 * @param {string} [keyLabel]
 * @param {number} [depth=0]
 * @param {boolean} [collapsed=false]
 * @returns {HTMLElement}
 */
function buildTree(value, keyLabel, depth = 0, collapsed = false) {
    const wrap = document.createElement('div');

    const isObj   = value !== null && typeof value === 'object' && !Array.isArray(value);
    const isArr   = Array.isArray(value);
    const isImg   = typeof value === 'string' && (value.startsWith('data:image') || value.startsWith('http'));
    const isLong  = typeof value === 'string' && value.length > 120;

    // Key prefix
    const prefix = document.createElement('span');
    if (keyLabel !== undefined) {
        const k = document.createElement('span');
        k.className = 'ri-tree-key';
        k.textContent = JSON.stringify(keyLabel) + ': ';
        prefix.appendChild(k);
    }

    if (isObj || isArr) {
        const count  = isArr ? value.length : Object.keys(value).length;
        const open   = isArr ? '[' : '{';
        const close  = isArr ? ']' : '}';
        const toggle = document.createElement('span');
        toggle.className = 'ri-tree-toggle';
        toggle.textContent = collapsed ? '▶' : '▼';

        const header = document.createElement('div');
        header.appendChild(toggle);
        header.appendChild(prefix);
        const typeLabel = document.createElement('span');
        typeLabel.style.color = '#64748b';
        typeLabel.textContent = `${open}${count}${close}`;
        header.appendChild(typeLabel);
        wrap.appendChild(header);

        const children = document.createElement('div');
        children.className = 'ri-tree-node';
        if (collapsed) wrap.classList.add('ri-tree-collapsed');

        const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
        for (const [k, v] of entries) {
            children.appendChild(buildTree(v, k, depth + 1, depth > 1));
        }
        wrap.appendChild(children);

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isNowCollapsed = wrap.classList.toggle('ri-tree-collapsed');
            toggle.textContent = isNowCollapsed ? '▶' : '▼';
        });
    } else {
        const leaf = document.createElement('div');
        leaf.appendChild(prefix);

        const val = document.createElement('span');
        if (value === null) {
            val.className = 'ri-tree-null';
            val.textContent = 'null';
        } else if (typeof value === 'boolean') {
            val.className = 'ri-tree-bool';
            val.textContent = String(value);
        } else if (typeof value === 'number') {
            val.className = 'ri-tree-num';
            val.textContent = String(value);
        } else {
            val.className = 'ri-tree-str';
            const display = isLong ? JSON.stringify(value).slice(0, 120) + '…"' : JSON.stringify(value);
            val.textContent = display;
            if (isLong) val.title = 'Click to expand';
        }

        // Inline image preview for base64/url strings that look like images
        if (isImg && typeof value === 'string' && value.startsWith('data:image')) {
            const img = document.createElement('img');
            img.className = 'ri-tree-img-preview';
            img.src = value;
            img.title = 'Click to open full size';
            img.addEventListener('click', () => { window.open(value, '_blank'); });
            leaf.appendChild(img);
        }

        leaf.appendChild(val);
        wrap.appendChild(leaf);
    }

    return wrap;
}

/** @exports SgLlmResponseInspector */
export class SgLlmResponseInspector extends HTMLElement {

    constructor() {
        super();
        this._shadow = this.attachShadow({ mode: 'open' });
        this._data   = null;   // last REQUEST_COMPLETE detail
        this._chunkIdx = 0;
        this._activeTab = 'summary';
    }

    connectedCallback() {
        this._shadow.innerHTML = `<style>${STYLE}</style><div class="ri-root" id="root"></div>`;
        this._root = this._shadow.getElementById('root');
        this._render();

        this._onComplete = (e) => { this._data = e.detail; this._chunkIdx = 0; this._render(); };
        this._bus().addEventListener(SGL_LLM.REQUEST_COMPLETE, this._onComplete);
    }

    disconnectedCallback() {
        this._bus().removeEventListener(SGL_LLM.REQUEST_COMPLETE, this._onComplete);
    }

    /**
     * Return nearest ancestor with [data-llm-bus], or parentElement as fallback.
     *
     * @returns {Element}
     */
    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    _render() {
        this._root.innerHTML = '';
        if (!this._data) {
            this._root.innerHTML = `
                <div class="ri-empty">
                    <div class="ri-empty-icon">🔍</div>
                    <div class="ri-empty-text">No response captured yet. Send a request to inspect.</div>
                </div>`;
            return;
        }

        const d = this._data;
        const imgCount   = (d.images   || []).length;
        const chunkCount = (d.rawChunks || []).length;

        // Tabs
        const tabs = document.createElement('div');
        tabs.className = 'ri-tabs';
        const tabDefs = [
            { id: 'summary',  label: 'Summary'   },
            { id: 'images',   label: 'Images',   count: imgCount   },
            { id: 'chunks',   label: 'Chunks',   count: chunkCount },
            { id: 'fulldata', label: 'Full Data' },
        ];
        for (const t of tabDefs) {
            const btn = document.createElement('button');
            btn.className = 'ri-tab' + (this._activeTab === t.id ? ' active' : '');
            btn.dataset.tab = t.id;
            btn.textContent = t.label;
            if (t.count !== undefined) {
                const badge = document.createElement('span');
                badge.className = 'ri-badge';
                badge.textContent = t.count;
                btn.appendChild(badge);
            }
            btn.addEventListener('click', () => {
                this._activeTab = t.id;
                this._render();
            });
            tabs.appendChild(btn);
        }
        this._root.appendChild(tabs);

        // Panels
        const panels = document.createElement('div');
        panels.className = 'ri-panels';
        panels.appendChild(this._buildSummaryPanel(d));
        panels.appendChild(this._buildImagesPanel(d));
        panels.appendChild(this._buildChunksPanel(d));
        panels.appendChild(this._buildFullDataPanel(d));
        this._root.appendChild(panels);
    }

    /** @param {Object} d */
    _buildSummaryPanel(d) {
        const p = this._panel('summary');
        const rows = [
            ['model',          d.model           || '—'],
            ['finish_reason',  d.finishReason     || '—'],
            ['latency',        d.latencyMs != null ? `${d.latencyMs} ms` : '—'],
            ['prompt_tokens',  d.promptTokens     ?? '—'],
            ['completion_tokens', d.completionTokens ?? '—'],
            ['images',         (d.images || []).length],
            ['raw_chunks',     (d.rawChunks || []).length],
            ['streaming',      d.rawChunks?.length > 0 ? 'yes' : (d.rawResponse ? 'no' : '—')],
            ['content_length', typeof d.content === 'string' ? `${d.content.length} chars` : '—'],
        ];
        const table = document.createElement('table');
        table.className = 'ri-summary-table';
        for (const [k, v] of rows) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
            table.appendChild(tr);
        }
        p.appendChild(table);
        return p;
    }

    /** @param {Object} d */
    _buildImagesPanel(d) {
        const p = this._panel('images');
        const images = d.images || [];
        if (images.length === 0) {
            p.innerHTML = '<div style="color:#334155;padding:20px;text-align:center;">No images in this response.</div>';
            return p;
        }
        const grid = document.createElement('div');
        grid.className = 'ri-images-grid';
        for (let i = 0; i < images.length; i++) {
            const imgObj = images[i];
            // Supports OpenAI-compat: { type:"image_url", image_url:{ url:"data:..." } }
            // Supports Anthropic:     { type:"image", source:{ type:"base64", media_type, data } }
            const url = imgObj?.image_url?.url
                || (imgObj?.source?.type === 'base64'
                    ? `data:${imgObj.source.media_type};base64,${imgObj.source.data}`
                    : null);

            const card = document.createElement('div');
            card.className = 'ri-image-card';
            if (url) {
                const img = document.createElement('img');
                img.src   = url;
                img.alt   = `Image ${i + 1}`;
                img.title = 'Click to open full size';
                img.addEventListener('click', () => window.open(url, '_blank'));
                card.appendChild(img);
            }
            const meta = document.createElement('div');
            meta.className = 'ri-image-meta';
            meta.textContent = `Image ${i + 1} · type: ${imgObj?.type || '?'}`;
            if (imgObj?.image_url?.url) {
                const urlShort = imgObj.image_url.url.slice(0, 60) + (imgObj.image_url.url.length > 60 ? '…' : '');
                meta.textContent += ` · ${urlShort}`;
            }
            card.appendChild(meta);
            grid.appendChild(card);
        }
        p.appendChild(grid);
        return p;
    }

    /** @param {Object} d */
    _buildChunksPanel(d) {
        const p = this._panel('chunks');
        const chunks = d.rawChunks || [];
        if (chunks.length === 0) {
            if (d.rawResponse) {
                const note = document.createElement('div');
                note.style.cssText = 'color:#64748b;padding:4px 0 10px;font-size:11px;';
                note.textContent = 'Non-streaming response — single JSON body (see Full Data tab).';
                p.appendChild(note);
            } else {
                p.innerHTML = '<div style="color:#334155;padding:20px;text-align:center;">No streaming chunks captured.</div>';
                return p;
            }
        }

        const controls = document.createElement('div');
        controls.className = 'ri-chunks-controls';

        const prevBtn = document.createElement('button');
        prevBtn.textContent = '◀ Prev';
        prevBtn.disabled = this._chunkIdx === 0;

        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Next ▶';
        nextBtn.disabled = this._chunkIdx >= chunks.length - 1;

        const counter = document.createElement('span');
        counter.className = 'ri-chunk-counter';
        counter.textContent = chunks.length ? `${this._chunkIdx + 1} / ${chunks.length}` : '0 chunks';

        const chunkView = document.createElement('pre');
        chunkView.className = 'ri-chunk-view';
        const updateView = () => {
            if (chunks.length === 0) { chunkView.textContent = ''; return; }
            chunkView.textContent = JSON.stringify(chunks[this._chunkIdx], null, 2);
            counter.textContent = `${this._chunkIdx + 1} / ${chunks.length}`;
            prevBtn.disabled = this._chunkIdx === 0;
            nextBtn.disabled = this._chunkIdx >= chunks.length - 1;
        };
        updateView();

        prevBtn.addEventListener('click', () => { if (this._chunkIdx > 0) { this._chunkIdx--; updateView(); } });
        nextBtn.addEventListener('click', () => { if (this._chunkIdx < chunks.length - 1) { this._chunkIdx++; updateView(); } });

        controls.appendChild(prevBtn);
        controls.appendChild(counter);
        controls.appendChild(nextBtn);
        p.appendChild(controls);
        p.appendChild(chunkView);
        return p;
    }

    /** @param {Object} d */
    _buildFullDataPanel(d) {
        const p = this._panel('fulldata');

        // Build a synthetic full-data object that merges all available data
        const fullData = {
            summary: {
                model:             d.model,
                finishReason:      d.finishReason,
                latencyMs:         d.latencyMs,
                promptTokens:      d.promptTokens,
                completionTokens:  d.completionTokens,
            },
            content:     d.content,
            images:      d.images      || [],
            rawChunks:   d.rawChunks   || [],
            rawResponse: d.rawResponse || null,
        };

        const controls = document.createElement('div');
        controls.className = 'ri-tree-controls';

        const expandBtn = document.createElement('button');
        expandBtn.textContent = 'Expand All';
        const collapseBtn = document.createElement('button');
        collapseBtn.textContent = 'Collapse All';

        expandBtn.addEventListener('click', () => {
            treeEl.querySelectorAll('.ri-tree-collapsed').forEach(n => {
                n.classList.remove('ri-tree-collapsed');
                const t = n.querySelector('.ri-tree-toggle');
                if (t) t.textContent = '▼';
            });
        });
        collapseBtn.addEventListener('click', () => {
            treeEl.querySelectorAll('.ri-tree-node').forEach(n => {
                const parent = n.parentElement;
                if (parent && parent !== treeEl) {
                    parent.classList.add('ri-tree-collapsed');
                    const t = parent.querySelector(':scope > div > .ri-tree-toggle');
                    if (t) t.textContent = '▶';
                }
            });
        });

        controls.appendChild(expandBtn);
        controls.appendChild(collapseBtn);
        p.appendChild(controls);

        const treeEl = document.createElement('div');
        treeEl.className = 'ri-tree';
        treeEl.appendChild(buildTree(fullData, undefined, 0, false));
        p.appendChild(treeEl);
        return p;
    }

    /**
     * Create a panel div for a given tab id.
     *
     * @param {string} id
     * @returns {HTMLDivElement}
     */
    _panel(id) {
        const div = document.createElement('div');
        div.className = 'ri-panel' + (this._activeTab === id ? ' active' : '');
        div.dataset.panel = id;
        return div;
    }

    /** Clear the current response data. */
    clear() {
        this._data = null;
        this._chunkIdx = 0;
        this._render();
    }

    /** @returns {Object|null} Last captured response detail */
    getData() { return this._data; }
}

customElements.define('sg-llm-response-inspector', SgLlmResponseInspector);
window.SgLlmResponseInspector = SgLlmResponseInspector;
