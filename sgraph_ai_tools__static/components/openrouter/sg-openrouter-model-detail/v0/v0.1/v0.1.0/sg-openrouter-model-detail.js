/**
 * sg-openrouter-model-detail — Full details panel for a single OpenRouter model.
 *
 * Listens for llm:model-changed on the bus and displays the complete data for
 * the selected model: description, all pricing fields ($/M tokens), architecture,
 * context length, max completion tokens, supported parameters and more.
 *
 * The model list is fetched once on llm:connected and cached in memory.
 * A search input allows looking up models without needing the models table.
 *
 * API endpoint:
 *   GET https://openrouter.ai/api/v1/models
 *   Authorization: Bearer <api-key>   (optional — public endpoint)
 *
 * Consumes (on [data-llm-bus] ancestor):
 *   llm:connected    — { provider, apiKey } → fetches model list
 *   llm:disconnected — clears selection
 *   llm:model-changed — { model } → shows detail for that model ID
 *
 * Attributes: (none)
 *
 * Public API:
 *   detail.showModel(id)   → display model by ID
 *   detail.refresh()       → re-fetch model list
 *
 * @module sg-openrouter-model-detail
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';

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
.md-toolbar {
    display: flex;
    gap: 6px;
    padding: 7px 8px;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
    align-items: center;
}
.md-search {
    flex: 1;
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    color: #c8d0e0;
    font-family: monospace;
    font-size: 11px;
    padding: 4px 8px;
    min-width: 0;
}
.md-search:focus { outline: none; border-color: #3b82f6; }
.md-search::placeholder { color: #374151; }
.md-btn {
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    color: #64748b;
    cursor: pointer;
    font-family: monospace;
    font-size: 11px;
    padding: 4px 8px;
    white-space: nowrap;
}
.md-btn:hover { border-color: #3b82f6; color: #60a5fa; }

/* ── Suggestions dropdown ─────────────────────────────── */
.md-suggestions {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
}
.md-dropdown {
    position: absolute;
    top: 100%;
    left: 0; right: 0;
    background: #12122a;
    border: 1px solid #3b82f6;
    border-top: none;
    border-radius: 0 0 4px 4px;
    max-height: 160px;
    overflow-y: auto;
    z-index: 10;
    display: none;
}
.md-dropdown.open { display: block; }
.md-dropdown::-webkit-scrollbar { width: 4px; }
.md-dropdown::-webkit-scrollbar-thumb { background: #1e2035; }
.md-opt {
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.md-opt:hover, .md-opt.focused { background: #1e3a6e; color: #93c5fd; }

/* ── Scroll area ─────────────────────────────────────── */
.md-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 10px;
}
.md-scroll::-webkit-scrollbar { width: 6px; }
.md-scroll::-webkit-scrollbar-track { background: #0d0d1a; }
.md-scroll::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

/* ── State ───────────────────────────────────────────── */
.md-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #1e2035;
    font-size: 11px;
    text-align: center;
    padding: 20px;
}
.md-spinner {
    display: inline-block;
    width: 10px; height: 10px;
    border: 1px solid #374151;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Model header ────────────────────────────────────── */
.md-model-header {
    margin-bottom: 12px;
}
.md-model-id {
    font-size: 14px;
    color: #c8d0e0;
    font-weight: 600;
    word-break: break-all;
    margin-bottom: 2px;
}
.md-model-name { font-size: 11px; color: #64748b; margin-bottom: 6px; }
.md-model-desc {
    font-size: 11px;
    color: #64748b;
    line-height: 1.5;
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    padding: 7px 9px;
    max-height: 80px;
    overflow-y: auto;
}
.md-model-desc::-webkit-scrollbar { width: 4px; }
.md-model-desc::-webkit-scrollbar-thumb { background: #1e2035; }

/* ── Tags ────────────────────────────────────────────── */
.md-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 6px 0 10px;
}
.md-tag {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 2px;
    border: 1px solid;
}
.md-tag-free    { color: #4ade80; border-color: #166534; background: #0a1a0d; }
.md-tag-vision  { color: #a78bfa; border-color: #4c1d95; background: #1e0a4e; }
.md-tag-code    { color: #60a5fa; border-color: #1e3a6e; background: #0a1228; }
.md-tag-ctx128  { color: #94a3b8; border-color: #1e2035; background: #12122a; }
.md-tag-ctx200  { color: #c084fc; border-color: #3b0764; background: #150520; }
.md-tag-mod     { color: #fbbf24; border-color: #92400e; background: #1a0e00; }

/* ── Sections ────────────────────────────────────────── */
.md-section { margin-bottom: 12px; }
.md-section-title {
    font-size: 9px;
    letter-spacing: 0.08em;
    color: #374151;
    text-transform: uppercase;
    margin-bottom: 5px;
    padding-bottom: 4px;
    border-bottom: 1px solid #1e2035;
}

/* ── Pricing grid ────────────────────────────────────── */
.md-price-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 10px;
}
.md-price-item {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
}
.md-price-key { font-size: 10px; color: #374151; }
.md-price-val { font-size: 11px; }
.md-price-free  { color: #4ade80; }
.md-price-cheap { color: #86efac; }
.md-price-mid   { color: #fbbf24; }
.md-price-exp   { color: #f87171; }

/* ── KV ──────────────────────────────────────────────── */
.md-kv { display: flex; flex-direction: column; gap: 4px; }
.md-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
}
.md-key { color: #374151; font-size: 10px; white-space: nowrap; flex-shrink: 0; }
.md-val { color: #c8d0e0; font-size: 11px; text-align: right; word-break: break-word; }
.md-val.dim  { color: #374151; }
.md-val.blue { color: #60a5fa; }

/* ── Params ──────────────────────────────────────────── */
.md-params {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.md-param {
    font-size: 9px;
    padding: 2px 5px;
    border-radius: 2px;
    border: 1px solid #1e2035;
    color: #374151;
    background: #12122a;
}
`;

function _pricePerM(str) {
    const n = parseFloat(str ?? '0');
    return isNaN(n) ? 0 : n * 1_000_000;
}

function _fmtPrice(str) {
    const perM = _pricePerM(str);
    const FREE = 0.0000001;
    if (perM < FREE)   return { text: 'free',             cls: 'md-price-free'  };
    if (perM < 1.0)    return { text: `$${perM.toFixed(3)}/M`, cls: 'md-price-cheap' };
    if (perM < 10)     return { text: `$${perM.toFixed(2)}/M`, cls: 'md-price-mid'   };
    return               { text: `$${perM.toFixed(1)}/M`, cls: 'md-price-exp'   };
}

function _fmtCtx(n) {
    if (!n) return '—';
    if (n >= 1_000_000) return `${(n/1_000_000).toFixed(0)}M tokens`;
    if (n >= 1_000)     return `${(n/1_000).toFixed(0)}k tokens`;
    return `${n} tokens`;
}

function _tags(m) {
    const tags = [];
    const mod  = (m.architecture?.modality ?? '').toLowerCase();
    const id   = m.id.toLowerCase();
    const FREE = 0.0000001;
    if (_pricePerM(m.pricing?.prompt) < FREE && _pricePerM(m.pricing?.completion) < FREE) tags.push('free');
    if (mod.includes('image') && mod.includes('->')) tags.push('vision');
    if (id.includes('code') || id.includes('coder')) tags.push('code');
    if ((m.context_length ?? 0) >= 200_000) tags.push('ctx200k');
    else if ((m.context_length ?? 0) >= 128_000) tags.push('ctx128k');
    if (m.top_provider?.is_moderated) tags.push('moderated');
    return tags;
}

export class SgOpenrouterModelDetail extends HTMLElement {
    constructor() {
        super();
        this._apiKey    = '';
        this._models    = [];
        this._current   = null;
        this._boundHandlers = {};
        this._shadow    = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._renderShell();
        this._bindBusEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [ev, fn] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(ev, fn);
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    showModel(id) {
        const m = this._models.find(m => m.id === id);
        if (m) { this._current = m; this._renderDetail(m); }
        else   this._renderState(`Model "${id}" not loaded yet`);
    }

    refresh() {
        this._fetchModels();
    }

    // ── Bus ────────────────────────────────────────────────────────────────

    _bindBusEvents() {
        const bus = this._bus();
        const on  = (ev, fn) => {
            const bound = fn.bind(this);
            this._boundHandlers[ev] = bound;
            bus.addEventListener(ev, bound);
        };
        on(SGL_LLM.CONNECTED,     this._onConnected);
        on(SGL_LLM.DISCONNECTED,  this._onDisconnected);
        on(SGL_LLM.MODEL_CHANGED, this._onModelChanged);
    }

    _onConnected(e) {
        if (e.detail?.provider !== 'openrouter') { this._apiKey = ''; return; }
        this._apiKey = e.detail?.apiKey ?? '';
        this._fetchModels();
    }

    _onDisconnected() {
        this._apiKey = '';
        this._models = [];
        this._current = null;
        this._renderState('Connect to OpenRouter to see model details');
    }

    _onModelChanged(e) {
        const id = e.detail?.model;
        if (!id) return;
        const m = this._models.find(m => m.id === id);
        if (m) {
            this._current = m;
            this._renderDetail(m);
            const s = this._shadow.querySelector('.md-search');
            if (s) s.value = id;
        }
    }

    // ── Fetch ──────────────────────────────────────────────────────────────

    async _fetchModels() {
        try {
            const headers = this._apiKey ? { Authorization: `Bearer ${this._apiKey}` } : {};
            const res  = await fetch(MODELS_URL, { headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            this._models = json.data ?? [];
            // If there was already a selected model, re-render it
            if (this._current) {
                const refreshed = this._models.find(m => m.id === this._current.id);
                if (refreshed) { this._current = refreshed; this._renderDetail(refreshed); }
            }
        } catch (err) {
            console.warn('[sg-openrouter-model-detail] fetch error:', err.message);
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────

    _renderShell() {
        this._shadow.innerHTML = `<style>${CSS}</style>
<div class="md-toolbar">
    <div class="md-suggestions">
        <input class="md-search" type="search" placeholder="Search or select a model…" spellcheck="false" autocomplete="off">
        <div class="md-dropdown" id="md-dropdown"></div>
    </div>
    <button class="md-btn" id="md-refresh-btn" title="Refresh model list">↺</button>
</div>
<div class="md-scroll" id="md-content">
    <div class="md-state">Select a model from the Models table<br>or search above</div>
</div>`;

        const input    = this._shadow.querySelector('.md-search');
        const dropdown = this._shadow.querySelector('#md-dropdown');

        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            if (!q) { dropdown.classList.remove('open'); return; }
            const hits = this._models
                .filter(m => m.id.toLowerCase().includes(q))
                .slice(0, 12);
            if (!hits.length) { dropdown.classList.remove('open'); return; }
            dropdown.innerHTML = hits.map(m =>
                `<div class="md-opt" data-id="${_esc(m.id)}">${_esc(m.id)}</div>`
            ).join('');
            dropdown.classList.add('open');
        });

        dropdown.addEventListener('click', e => {
            const opt = e.target.closest('.md-opt');
            if (!opt) return;
            input.value = opt.dataset.id;
            dropdown.classList.remove('open');
            this.showModel(opt.dataset.id);
        });

        input.addEventListener('keydown', e => {
            if (e.key === 'Escape') { dropdown.classList.remove('open'); return; }
            if (e.key === 'Enter') {
                dropdown.classList.remove('open');
                this.showModel(input.value.trim());
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', e => {
            if (!this._shadow.contains(e.composedPath()[0])) {
                dropdown.classList.remove('open');
            }
        });

        this._shadow.querySelector('#md-refresh-btn')
            .addEventListener('click', () => this.refresh());
    }

    _renderState(msg) {
        const el = this._shadow.querySelector('#md-content');
        if (el) el.innerHTML = `<div class="md-state">${_esc(msg)}</div>`;
    }

    _renderDetail(m) {
        const tags = _tags(m);
        const tagHtml = tags.map(t => {
            const cls = t === 'ctx128k' ? 'md-tag-ctx128'
                      : t === 'ctx200k' ? 'md-tag-ctx200'
                      : t === 'moderated' ? 'md-tag-mod'
                      : `md-tag-${t}`;
            return `<span class="md-tag ${cls}">${_esc(t)}</span>`;
        }).join('');

        const priceItem = (label, val) => {
            if (!val || parseFloat(val) === 0 && label !== 'prompt' && label !== 'completion') return '';
            const { text, cls } = _fmtPrice(val);
            return `<div class="md-price-item">
                <span class="md-price-key">${_esc(label)}</span>
                <span class="md-price-val ${cls}">${text}</span>
            </div>`;
        };

        const kv = (k, v, cls = '') => v != null && v !== ''
            ? `<div class="md-row"><span class="md-key">${_esc(k)}</span><span class="md-val ${cls}">${_esc(String(v))}</span></div>`
            : '';

        const sec = (title, content) => `
<div class="md-section">
    <div class="md-section-title">${_esc(title)}</div>
    ${content}
</div>`;

        const pricing = m.pricing ?? {};
        const arch    = m.architecture ?? {};
        const tp      = m.top_provider ?? {};
        const params  = m.supported_parameters ?? [];

        const el = this._shadow.querySelector('#md-content');
        el.innerHTML = `
<div class="md-model-header">
    <div class="md-model-id">${_esc(m.id)}</div>
    ${m.name ? `<div class="md-model-name">${_esc(m.name)}</div>` : ''}
    ${m.description ? `<div class="md-model-desc">${_esc(m.description)}</div>` : ''}
    <div class="md-tags">${tagHtml}</div>
</div>

${sec('Context & Limits', `<div class="md-kv">
    ${kv('context length',      _fmtCtx(m.context_length))}
    ${kv('max completion',      tp.max_completion_tokens ? _fmtCtx(tp.max_completion_tokens) : null)}
    ${kv('knowledge cutoff',    m.knowledge_cutoff)}
    ${kv('modality',            arch.modality,   'blue')}
    ${kv('tokenizer',           arch.tokenizer)}
    ${kv('instruct type',       arch.instruct_type)}
</div>`)}

${sec('Pricing (per 1M tokens)', `<div class="md-price-grid">
    ${priceItem('prompt',      pricing.prompt)}
    ${priceItem('completion',  pricing.completion)}
    ${priceItem('image input', pricing.image)}
    ${priceItem('image gen',   pricing.image_output)}
    ${priceItem('audio input', pricing.audio)}
    ${priceItem('audio out',   pricing.audio_output)}
    ${priceItem('cache read',  pricing.input_cache_read)}
    ${priceItem('cache write', pricing.input_cache_write)}
    ${priceItem('reasoning',   pricing.internal_reasoning)}
    ${priceItem('web search',  pricing.web_search)}
    ${pricing.request && parseFloat(pricing.request) > 0
        ? `<div class="md-price-item"><span class="md-price-key">per request</span><span class="md-price-val md-price-mid">$${parseFloat(pricing.request).toFixed(5)}</span></div>` : ''}
</div>`)}

${params.length ? sec('Supported Parameters', `<div class="md-params">
    ${params.map(p => `<span class="md-param">${_esc(p)}</span>`).join('')}
</div>`) : ''}

${sec('Metadata', `<div class="md-kv">
    ${kv('provider',   m.id.split('/')[0],  'blue')}
    ${kv('created',    m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null)}
    ${kv('expiry',     m.expiration_date ?? null)}
    ${kv('moderated',  tp.is_moderated ? 'yes' : null)}
    ${kv('canonical',  m.canonical_slug ?? null)}
</div>`)}`;
    }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }
}

function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

customElements.define('sg-openrouter-model-detail', SgOpenrouterModelDetail);
window.SgOpenrouterModelDetail = SgOpenrouterModelDetail;
