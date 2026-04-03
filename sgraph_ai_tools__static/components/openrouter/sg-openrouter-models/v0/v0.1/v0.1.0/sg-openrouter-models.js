/**
 * sg-openrouter-models — OpenRouter model explorer and selector.
 *
 * Fetches the full OpenRouter model catalogue and renders a searchable,
 * filterable table with pricing, context length, and modality. Clicking a
 * row emits llm:model-changed so the active model updates everywhere.
 *
 * The model list is public — no API key is required to browse. If a key is
 * available on the bus (via llm:connected) it is forwarded as the auth header
 * which may unlock provisioned/private models.
 *
 * Pricing from OpenRouter is USD per token. Display converts to USD per
 * 1 million tokens ($/M) for readability.
 *
 * API endpoint:
 *   GET https://openrouter.ai/api/v1/models
 *   Authorization: Bearer <api-key>   (optional — public endpoint)
 *   Response: {
 *     data: [{
 *       id, name, description, context_length,
 *       architecture: { modality, tokenizer, instruct_type },
 *       pricing: { prompt, completion, image, request },   // USD per token (strings)
 *       top_provider: { context_length, max_completion_tokens, is_moderated }
 *     }]
 *   }
 *
 * Consumes (on [data-llm-bus] ancestor):
 *   llm:connected       — { apiKey } → stores key for auth header
 *   llm:disconnected    — clears stored key (still can browse publicly)
 *
 * Emits (on [data-llm-bus] ancestor):
 *   llm:model-changed   — { model } → broadcast when user selects a model
 *
 * Attributes:
 *   provider  — filter to only show models from this provider prefix
 *               e.g. provider="anthropic" shows only "anthropic/*" models
 *
 * Public API:
 *   models.refresh()   → re-fetch the model list
 *
 * @module sg-openrouter-models
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';

// Price threshold for "cheap" category: prompt < $1 per million tokens
const CHEAP_THRESHOLD_PER_M = 1.0;
// Price threshold for "free" category
const FREE_THRESHOLD = 0.0000001;

const CSS = `
:host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-family: monospace;
    font-size: 12px;
    background: #0d0d1a;
    color: #c8d0e0;
}

/* ── Toolbar ─────────────────────────────────────────── */
.orm-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
    align-items: center;
}
.orm-search {
    flex: 1;
    min-width: 120px;
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    color: #c8d0e0;
    padding: 4px 8px;
    font-family: monospace;
    font-size: 12px;
}
.orm-search:focus { outline: none; border-color: #3b82f6; }
.orm-search::placeholder { color: #374151; }

.orm-filters {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
}
.orm-filter-btn {
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 3px;
    color: #64748b;
    cursor: pointer;
    font-family: monospace;
    font-size: 11px;
    padding: 3px 7px;
    transition: all 0.15s;
    white-space: nowrap;
}
.orm-filter-btn:hover { border-color: #3b82f6; color: #93c5fd; }
.orm-filter-btn.active { background: #1e3a6e; border-color: #3b82f6; color: #60a5fa; }

.orm-count {
    color: #374151;
    font-size: 11px;
    white-space: nowrap;
    margin-left: auto;
}
.orm-refresh-btn {
    background: none;
    border: 1px solid #1e2035;
    border-radius: 3px;
    color: #374151;
    cursor: pointer;
    font-size: 11px;
    padding: 3px 6px;
}
.orm-refresh-btn:hover { border-color: #3b82f6; color: #60a5fa; }

/* ── Table ───────────────────────────────────────────── */
.orm-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
}
.orm-scroll::-webkit-scrollbar { width: 6px; }
.orm-scroll::-webkit-scrollbar-track { background: #0d0d1a; }
.orm-scroll::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
}
thead {
    position: sticky;
    top: 0;
    background: #0d0d1a;
    z-index: 1;
}
th {
    padding: 6px 8px;
    border-bottom: 1px solid #1e2035;
    color: #374151;
    font-size: 10px;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
}
th:hover { color: #64748b; }
th.sort-asc::after  { content: ' ▲'; color: #3b82f6; }
th.sort-desc::after { content: ' ▼'; color: #3b82f6; }

td {
    padding: 5px 8px;
    border-bottom: 1px solid #10101f;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
}

col.col-name    { width: 35%; }
col.col-ctx     { width: 10%; }
col.col-in      { width: 12%; }
col.col-out     { width: 12%; }
col.col-mod     { width: 12%; }
col.col-tags    { width: 19%; }

tr.orm-row {
    cursor: pointer;
    transition: background 0.1s;
}
tr.orm-row:hover { background: #12122a; }
tr.orm-row.selected { background: #1e3a6e; }

.model-name { color: #c8d0e0; font-weight: 500; font-size: 11px; }
.model-provider { color: #374151; font-size: 10px; }

.price-free  { color: #4ade80; }
.price-cheap { color: #86efac; }
.price-mid   { color: #fbbf24; }
.price-exp   { color: #f87171; }

/* Tags */
.tag {
    display: inline-block;
    border-radius: 2px;
    font-size: 9px;
    padding: 1px 4px;
    margin: 1px 1px 1px 0;
    border: 1px solid;
    white-space: nowrap;
}
.tag-vision  { color: #a78bfa; border-color: #4c1d95; background: #1e0a4e; }
.tag-free    { color: #4ade80; border-color: #166534; background: #0a1a0d; }
.tag-code    { color: #60a5fa; border-color: #1e3a6e; background: #0a1228; }
.tag-ctx128  { color: #94a3b8; border-color: #1e2035; background: #12122a; }
.tag-ctx200  { color: #c084fc; border-color: #3b0764; background: #150520; }

/* States */
.orm-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 40px;
    color: #374151;
    font-size: 12px;
    flex: 1;
}
.orm-spinner {
    display: inline-block;
    width: 12px; height: 12px;
    border: 1px solid #374151;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
`;

/** Derive capability tags for a model record. */
function _tags(m) {
    const tags = [];
    const mod = (m.architecture?.modality ?? '').toLowerCase();
    const id  = m.id.toLowerCase();
    const nm  = (m.name ?? '').toLowerCase();

    if (_pricePerM(m.pricing?.prompt) < FREE_THRESHOLD &&
        _pricePerM(m.pricing?.completion) < FREE_THRESHOLD) tags.push('free');
    if (mod.includes('image') && mod.includes('->')) tags.push('vision');
    if (id.includes('code') || id.includes('coder') || nm.includes('code')) tags.push('code');
    if ((m.context_length ?? 0) >= 200_000) tags.push('ctx200k');
    else if ((m.context_length ?? 0) >= 128_000) tags.push('ctx128k');
    return tags;
}

/** USD per token string → USD per million tokens (number). */
function _pricePerM(str) {
    const n = parseFloat(str ?? '0');
    return isNaN(n) ? 0 : n * 1_000_000;
}

/** Format USD/M for display. */
function _fmtPrice(str) {
    const perM = _pricePerM(str);
    if (perM < FREE_THRESHOLD) return '<span class="price-free">free</span>';
    if (perM < CHEAP_THRESHOLD_PER_M) return `<span class="price-cheap">$${perM.toFixed(3)}</span>`;
    if (perM < 10) return `<span class="price-mid">$${perM.toFixed(2)}</span>`;
    return `<span class="price-exp">$${perM.toFixed(1)}</span>`;
}

/** Format context length for display. */
function _fmtCtx(n) {
    if (!n) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return String(n);
}

/** Provider slug from model id (part before first slash). */
function _provider(id) {
    const slash = id.indexOf('/');
    return slash > -1 ? id.slice(0, slash) : id;
}

/** Model display name without provider prefix. */
function _modelName(m) {
    const slash = m.id.indexOf('/');
    return slash > -1 ? m.id.slice(slash + 1) : m.id;
}

export class SgOpenrouterModels extends HTMLElement {

    constructor() {
        super();
        this._apiKey        = '';
        this._models        = [];     // raw from API
        this._filtered      = [];     // after search/filter
        this._selectedId    = '';
        this._searchQ       = '';
        this._activeFilters = new Set();
        this._sortCol       = 'name';
        this._sortDir       = 1;     // 1 = asc, -1 = desc
        this._boundHandlers = {};
        this._shadow        = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._renderShell();
        this._bindBusEvents();
        this.refresh();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [ev, fn] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(ev, fn);
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /** Re-fetch the model list from OpenRouter. */
    refresh() {
        this._fetch();
    }

    // ── Bus events ─────────────────────────────────────────────────────────

    _bindBusEvents() {
        const bus = this._bus();
        const on  = (ev, fn) => {
            const bound = fn.bind(this);
            this._boundHandlers[ev] = bound;
            bus.addEventListener(ev, bound);
        };
        on(SGL_LLM.CONNECTED,    this._onConnected);
        on(SGL_LLM.DISCONNECTED, this._onDisconnected);
        on(SGL_LLM.MODEL_CHANGED, this._onModelChanged);
    }

    _onConnected(e) {
        if (e.detail?.provider !== 'openrouter') { this._apiKey = ''; return; }
        this._apiKey = e.detail?.apiKey ?? '';
    }

    _onDisconnected() {
        this._apiKey = '';
    }

    _onModelChanged(e) {
        const id = e.detail?.model;
        if (id && id !== this._selectedId) {
            this._selectedId = id;
            this._highlightSelected();
        }
    }

    // ── Fetch ──────────────────────────────────────────────────────────────

    async _fetch() {
        this._setLoading(true);
        try {
            const headers = this._apiKey ? { Authorization: `Bearer ${this._apiKey}` } : {};
            const res  = await fetch(MODELS_URL, { headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            this._models = (json.data ?? []).sort((a, b) => a.id.localeCompare(b.id));
            this._applyFilter();
        } catch (err) {
            console.warn('[sg-openrouter-models] fetch error:', err.message);
            this._setError(err.message);
        } finally {
            this._setLoading(false);
        }
    }

    // ── Filter / sort ──────────────────────────────────────────────────────

    _applyFilter() {
        const q   = this._searchQ.toLowerCase();
        const flt = this._activeFilters;

        let list = this._models;

        // Provider attribute
        const provAttr = this.getAttribute('provider');
        if (provAttr) list = list.filter(m => _provider(m.id) === provAttr);

        // Keyword search
        if (q) {
            list = list.filter(m =>
                m.id.toLowerCase().includes(q) ||
                (m.name ?? '').toLowerCase().includes(q) ||
                (m.description ?? '').toLowerCase().includes(q)
            );
        }

        // Capability filters
        if (flt.has('free'))   list = list.filter(m => _tags(m).includes('free'));
        if (flt.has('vision')) list = list.filter(m => _tags(m).includes('vision'));
        if (flt.has('code'))   list = list.filter(m => _tags(m).includes('code'));
        if (flt.has('cheap'))  list = list.filter(m =>
            _pricePerM(m.pricing?.prompt) < CHEAP_THRESHOLD_PER_M &&
            _pricePerM(m.pricing?.prompt) >= FREE_THRESHOLD
        );

        // Sort
        list = [...list].sort((a, b) => {
            let va, vb;
            switch (this._sortCol) {
                case 'provider': va = _provider(a.id); vb = _provider(b.id); break;
                case 'ctx':  va = a.context_length ?? 0; vb = b.context_length ?? 0; break;
                case 'in':   va = _pricePerM(a.pricing?.prompt);    vb = _pricePerM(b.pricing?.prompt);    break;
                case 'out':  va = _pricePerM(a.pricing?.completion); vb = _pricePerM(b.pricing?.completion); break;
                default:     va = a.id; vb = b.id;
            }
            if (va < vb) return -1 * this._sortDir;
            if (va > vb) return  1 * this._sortDir;
            return 0;
        });

        this._filtered = list;
        this._renderTable();
    }

    _toggleSort(col) {
        if (this._sortCol === col) {
            this._sortDir *= -1;
        } else {
            this._sortCol = col;
            this._sortDir = 1;
        }
        this._applyFilter();
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    _renderShell() {
        this._shadow.innerHTML = `<style>${CSS}</style>
<div class="orm-toolbar">
    <input class="orm-search" type="search" placeholder="Search models…" spellcheck="false">
    <div class="orm-filters">
        <button class="orm-filter-btn" data-filter="free">free</button>
        <button class="orm-filter-btn" data-filter="vision">vision</button>
        <button class="orm-filter-btn" data-filter="code">code</button>
        <button class="orm-filter-btn" data-filter="cheap">cheap</button>
    </div>
    <span class="orm-count"></span>
    <button class="orm-refresh-btn" title="Refresh model list">↺</button>
</div>
<div class="orm-scroll">
    <div class="orm-state"><span class="orm-spinner"></span> Loading models…</div>
</div>`;

        // Toolbar events
        this._shadow.querySelector('.orm-search').addEventListener('input', e => {
            this._searchQ = e.target.value;
            this._applyFilter();
        });
        this._shadow.querySelector('.orm-refresh-btn').addEventListener('click', () => this.refresh());
        this._shadow.querySelectorAll('.orm-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const f = btn.dataset.filter;
                if (this._activeFilters.has(f)) {
                    this._activeFilters.delete(f);
                    btn.classList.remove('active');
                } else {
                    this._activeFilters.add(f);
                    btn.classList.add('active');
                }
                this._applyFilter();
            });
        });
    }

    _renderTable() {
        const scroll = this._shadow.querySelector('.orm-scroll');
        const count  = this._shadow.querySelector('.orm-count');
        count.textContent = `${this._filtered.length} / ${this._models.length} models`;

        const sc = (col) => {
            const cls = this._sortCol === col
                ? (this._sortDir === 1 ? 'sort-asc' : 'sort-desc')
                : '';
            return cls;
        };

        scroll.innerHTML = `
<table>
    <colgroup>
        <col class="col-name">
        <col class="col-ctx">
        <col class="col-in">
        <col class="col-out">
        <col class="col-mod">
        <col class="col-tags">
    </colgroup>
    <thead>
        <tr>
            <th class="${sc('name')}"    data-sort="name">Model</th>
            <th class="${sc('ctx')}"     data-sort="ctx">Ctx</th>
            <th class="${sc('in')}"      data-sort="in">In $/M</th>
            <th class="${sc('out')}"     data-sort="out">Out $/M</th>
            <th class="${sc('provider')}" data-sort="provider">Provider</th>
            <th>Tags</th>
        </tr>
    </thead>
    <tbody id="orm-tbody"></tbody>
</table>`;

        // Sort headers
        scroll.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => this._toggleSort(th.dataset.sort));
        });

        const tbody = scroll.querySelector('#orm-tbody');
        const rows  = this._filtered.map(m => this._rowHtml(m)).join('');
        tbody.innerHTML = rows || '<tr><td colspan="6" style="color:#374151;text-align:center;padding:20px">No models match</td></tr>';

        tbody.querySelectorAll('tr.orm-row').forEach(tr => {
            tr.addEventListener('click', () => this._selectModel(tr.dataset.id));
        });

        this._highlightSelected();
    }

    _rowHtml(m) {
        const tags     = _tags(m);
        const tagsHtml = tags.map(t => `<span class="tag tag-${t === 'ctx128k' ? 'ctx128' : t === 'ctx200k' ? 'ctx200' : t}">${t}</span>`).join('');
        const sel      = m.id === this._selectedId ? 'selected' : '';
        return `
<tr class="orm-row ${sel}" data-id="${_escape(m.id)}" title="${_escape(m.description ?? m.name ?? m.id)}">
    <td>
        <div class="model-name">${_escape(_modelName(m))}</div>
    </td>
    <td>${_fmtCtx(m.context_length)}</td>
    <td>${_fmtPrice(m.pricing?.prompt)}</td>
    <td>${_fmtPrice(m.pricing?.completion)}</td>
    <td class="model-provider">${_escape(_provider(m.id))}</td>
    <td>${tagsHtml}</td>
</tr>`;
    }

    _highlightSelected() {
        this._shadow.querySelectorAll('tr.orm-row').forEach(tr => {
            tr.classList.toggle('selected', tr.dataset.id === this._selectedId);
        });
    }

    _selectModel(id) {
        this._selectedId = id;
        this._highlightSelected();
        const bus = this._bus();
        bus.dispatchEvent(new CustomEvent(SGL_LLM.MODEL_CHANGED, {
            bubbles: true,
            composed: true,
            detail: { model: id },
        }));
    }

    _setLoading(on) {
        const scroll = this._shadow.querySelector('.orm-scroll');
        if (!scroll) return;
        if (on && !this._models.length) {
            scroll.innerHTML = '<div class="orm-state"><span class="orm-spinner"></span> Loading…</div>';
        }
    }

    _setError(msg) {
        const scroll = this._shadow.querySelector('.orm-scroll');
        if (scroll) scroll.innerHTML = `<div class="orm-state">Failed to load models: ${_escape(msg)}</div>`;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }
}

function _escape(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

customElements.define('sg-openrouter-models', SgOpenrouterModels);
window.SgOpenrouterModels = SgOpenrouterModels;
