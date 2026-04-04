/**
 * sg-openrouter-generation — Generation request detail viewer.
 *
 * Fetches metadata for a specific OpenRouter generation by ID.
 * Auto-captures the generation ID from llm:request-complete events
 * (reads rawResponse.id from the completion response). Falls back to
 * manual ID entry.
 *
 * Note: The generation endpoint returns metadata ONLY — no prompt text,
 * no completion content. Zero-knowledge boundary is preserved.
 *
 * API endpoint:
 *   GET https://openrouter.ai/api/v1/generation?id={generation_id}
 *   Authorization: Bearer <api-key>
 *
 * Consumes (on [data-llm-bus] ancestor):
 *   llm:connected        — { provider, apiKey } → stores key (openrouter only)
 *   llm:disconnected     — clears key
 *   llm:request-complete — auto-captures generation ID from rawResponse.id
 *   or:admin-connected   — { managementKey } → fallback key if no user key
 *   or:generation-selected — { id } — from sg-openrouter-activity row click
 *
 * Attributes: (none)
 *
 * Public API:
 *   gen.fetchGeneration(id)  → fetch and display a generation
 *   gen.clear()              → reset to idle
 *
 * @module sg-openrouter-generation
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const GEN_URL = 'https://openrouter.ai/api/v1/generation';

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
.og-toolbar {
    display: flex;
    gap: 6px;
    padding: 7px 8px;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
    align-items: center;
}
.og-id-input {
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
.og-id-input:focus { outline: none; border-color: #3b82f6; }
.og-id-input::placeholder { color: #374151; }
.og-btn {
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    color: #64748b;
    cursor: pointer;
    font-family: monospace;
    font-size: 11px;
    padding: 4px 10px;
    white-space: nowrap;
}
.og-btn:hover { border-color: #3b82f6; color: #60a5fa; }
.og-btn.primary { background: #1e3a6e; border-color: #3b82f6; color: #93c5fd; }
.og-auto-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid #166534;
    color: #4ade80;
    background: #0a1a0d;
    white-space: nowrap;
}

/* ── Scroll area ─────────────────────────────────────── */
.og-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 10px;
}
.og-scroll::-webkit-scrollbar { width: 6px; }
.og-scroll::-webkit-scrollbar-track { background: #0d0d1a; }
.og-scroll::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

/* ── State ───────────────────────────────────────────── */
.og-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #1e2035;
    font-size: 11px;
    text-align: center;
    padding: 20px;
}
.og-spinner {
    display: inline-block;
    width: 10px; height: 10px;
    border: 1px solid #374151;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.og-error { color: #f87171; font-size: 11px; }

/* ── Sections ────────────────────────────────────────── */
.og-section {
    margin-bottom: 12px;
}
.og-section-title {
    font-size: 9px;
    letter-spacing: 0.08em;
    color: #374151;
    text-transform: uppercase;
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid #1e2035;
}

/* ── KV rows ─────────────────────────────────────────── */
.og-kv { display: flex; flex-direction: column; gap: 4px; }
.og-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    min-height: 16px;
}
.og-key { color: #374151; font-size: 10px; white-space: nowrap; flex-shrink: 0; }
.og-val { color: #c8d0e0; font-size: 11px; text-align: right; word-break: break-word; }
.og-val.dim  { color: #374151; }
.og-val.green { color: #4ade80; }
.og-val.amber { color: #fbbf24; }
.og-val.blue  { color: #60a5fa; }
.og-val.red   { color: #f87171; }

/* ── Cost highlight ──────────────────────────────────── */
.og-cost-big {
    font-size: 18px;
    color: #c8d0e0;
    margin-bottom: 2px;
}
.og-cost-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 10px;
}
.og-cost-label { font-size: 10px; color: #374151; }

/* ── Token bar ───────────────────────────────────────── */
.og-token-bar {
    height: 4px;
    background: #1e2035;
    border-radius: 2px;
    overflow: hidden;
    margin: 4px 0 8px;
    display: flex;
}
.og-token-seg { height: 100%; }
.og-token-seg.prompt     { background: #3b82f6; }
.og-token-seg.completion { background: #22c55e; }
.og-token-seg.reasoning  { background: #a78bfa; }
.og-token-seg.cached     { background: #374151; }
.og-token-legend {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
}
.og-legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #64748b; }
.og-legend-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
`;

/** Format USD cost for display */
function _fmtCost(n) {
    if (n === null || n === undefined) return '—';
    if (n === 0) return '$0.0000';
    if (n < 0.00001) return `$${n.toExponential(3)}`;
    return `$${n.toFixed(Math.max(4, -Math.floor(Math.log10(n)) + 2))}`;
}

/** Format latency ms */
function _fmtMs(n) {
    if (!n) return '—';
    if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
    return `${Math.round(n)}ms`;
}

/** Format token count */
function _fmtTok(n) {
    if (n === null || n === undefined || n === 0) return null;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

export class SgOpenrouterGeneration extends HTMLElement {
    constructor() {
        super();
        this._apiKey  = '';
        this._data    = null;
        this._showRaw = false;
        this._boundHandlers = {};
        this._shadow = this.attachShadow({ mode: 'open' });
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

    async fetchGeneration(id) {
        if (!id) return;
        this._shadow.querySelector('.og-id-input').value = id;
        await this._fetch(id);
    }

    clear() {
        this._data = null;
        this._renderState('Waiting for a generation…');
    }

    // ── Bus ────────────────────────────────────────────────────────────────

    _bindBusEvents() {
        const bus = this._bus();
        const on  = (ev, fn) => {
            const bound = fn.bind(this);
            this._boundHandlers[ev] = bound;
            bus.addEventListener(ev, bound);
        };
        on(SGL_LLM.CONNECTED,        this._onConnected);
        on(SGL_LLM.DISCONNECTED,     this._onDisconnected);
        on(SGL_LLM.REQUEST_COMPLETE, this._onRequestComplete);
        on('or:generation-selected', this._onGenerationSelected);
        on('or:admin-connected',     this._onAdminConnected);
    }

    _onConnected(e) {
        if (e.detail?.provider !== 'openrouter') { this._apiKey = ''; return; }
        this._apiKey = e.detail?.apiKey ?? '';
    }

    _onAdminConnected(e) {
        // Use management key as fallback if no user API key
        if (!this._apiKey) this._apiKey = e.detail?.managementKey ?? '';
    }

    _onDisconnected() { this._apiKey = ''; }

    _onRequestComplete(e) {
        // Try to capture generation ID from the raw response
        const raw = e.detail?.rawResponse;
        const id  = raw?.id ?? e.detail?.id ?? null;
        if (!id) return;
        const badge = this._shadow.querySelector('.og-auto-badge');
        if (badge) { badge.textContent = 'auto'; badge.style.display = 'inline'; }
        this._shadow.querySelector('.og-id-input').value = id;
        this._fetch(id);
    }

    _onGenerationSelected(e) {
        const id = e.detail?.id;
        if (!id) return;
        const badge = this._shadow.querySelector('.og-auto-badge');
        if (badge) { badge.textContent = 'selected'; badge.style.display = 'inline'; }
        this._shadow.querySelector('.og-id-input').value = id;
        this._fetch(id);
    }

    // ── Fetch ──────────────────────────────────────────────────────────────

    async _fetch(id) {
        if (!id) return;
        if (!this._apiKey) {
            this._renderState('Connect to OpenRouter first', true);
            return;
        }
        this._renderLoading();
        try {
            const res = await fetch(`${GEN_URL}?id=${encodeURIComponent(id)}`, {
                headers: { Authorization: `Bearer ${this._apiKey}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            this._data = json.data ?? json;
            this._renderData();
            if (this._showRaw) this._renderRaw();
        } catch (err) {
            console.warn('[sg-openrouter-generation] error:', err.message);
            this._renderError(err.message);
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────

    _renderShell() {
        this._shadow.innerHTML = `<style>${CSS}
.og-raw {
    flex: 1; overflow-y: auto; min-height: 0; padding: 10px;
    font-family: monospace; font-size: 11px; line-height: 1.5;
    display: none;
}
.og-raw::-webkit-scrollbar { width: 6px; }
.og-raw::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }
.og-raw pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: #c8d0e0; }
.og-raw .jk { color: #93c5fd; }
.og-raw .js { color: #4ade80; }
.og-raw .jn { color: #fbbf24; }
.og-raw .jb { color: #a78bfa; }
.og-btn.active { border-color: #3b82f6; color: #60a5fa; background: #0d1a3d; }
</style>
<div class="og-toolbar">
    <input class="og-id-input" type="text" placeholder="Generation ID (gen-…)" spellcheck="false">
    <span class="og-auto-badge" style="display:none">auto</span>
    <button class="og-btn primary" id="og-fetch-btn">Fetch</button>
    <button class="og-btn" id="og-raw-btn" title="Toggle raw JSON">{ }</button>
    <button class="og-btn" id="og-clear-btn">Clear</button>
</div>
<div class="og-scroll" id="og-content">
    <div class="og-state">Waiting for a generation…<br><span style="color:#1e2035;font-size:10px">Send a request or paste a generation ID above</span></div>
</div>
<div class="og-raw" id="og-raw"></div>`;

        const input = this._shadow.querySelector('.og-id-input');
        this._shadow.querySelector('#og-fetch-btn').addEventListener('click', () => {
            this._fetch(input.value.trim());
        });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') this._fetch(input.value.trim()); });
        this._shadow.querySelector('#og-clear-btn').addEventListener('click', () => this.clear());
        this._shadow.querySelector('#og-raw-btn').addEventListener('click', () => {
            this._showRaw = !this._showRaw;
            this._shadow.querySelector('#og-raw-btn').classList.toggle('active', this._showRaw);
            this._shadow.querySelector('#og-content').style.display = this._showRaw ? 'none' : '';
            this._shadow.querySelector('#og-raw').style.display     = this._showRaw ? '' : 'none';
            if (this._showRaw && this._data) this._renderRaw();
        });
    }

    _renderState(msg, isError = false) {
        const el = this._shadow.querySelector('#og-content');
        if (el) el.innerHTML = `<div class="og-state ${isError ? 'og-error' : ''}">${_esc(msg)}</div>`;
    }

    _renderLoading() {
        const el = this._shadow.querySelector('#og-content');
        if (el) el.innerHTML = '<div class="og-state"><span class="og-spinner"></span> Fetching…</div>';
    }

    _renderError(msg) {
        const el = this._shadow.querySelector('#og-content');
        if (el) el.innerHTML = `<div class="og-state og-error">Error: ${_esc(msg)}</div>`;
    }

    _renderData() {
        const d = this._data;
        if (!d) return;

        const prompt     = d.tokens_prompt      ?? d.native_tokens_prompt      ?? 0;
        const completion = d.tokens_completion   ?? d.native_tokens_completion  ?? 0;
        const reasoning  = d.native_tokens_reasoning ?? 0;
        const cached     = d.native_tokens_cached    ?? 0;
        const total      = prompt + completion + reasoning + cached || 1;

        const bar = `
<div class="og-token-bar">
    <div class="og-token-seg prompt"     style="width:${(prompt    /total*100).toFixed(1)}%"></div>
    <div class="og-token-seg completion" style="width:${(completion/total*100).toFixed(1)}%"></div>
    <div class="og-token-seg reasoning"  style="width:${(reasoning /total*100).toFixed(1)}%"></div>
    <div class="og-token-seg cached"     style="width:${(cached    /total*100).toFixed(1)}%"></div>
</div>
<div class="og-token-legend">
    ${prompt    ? `<span class="og-legend-item"><span class="og-legend-dot" style="background:#3b82f6"></span>prompt ${_fmtTok(prompt)}</span>` : ''}
    ${completion? `<span class="og-legend-item"><span class="og-legend-dot" style="background:#22c55e"></span>completion ${_fmtTok(completion)}</span>` : ''}
    ${reasoning ? `<span class="og-legend-item"><span class="og-legend-dot" style="background:#a78bfa"></span>reasoning ${_fmtTok(reasoning)}</span>` : ''}
    ${cached    ? `<span class="og-legend-item"><span class="og-legend-dot" style="background:#374151"></span>cached ${_fmtTok(cached)}</span>` : ''}
</div>`;

        const row = (k, v, cls = '') => v !== null && v !== undefined && v !== ''
            ? `<div class="og-row"><span class="og-key">${_esc(k)}</span><span class="og-val ${cls}">${_esc(String(v))}</span></div>`
            : '';

        const sec = (title, rows) => `
<div class="og-section">
    <div class="og-section-title">${_esc(title)}</div>
    <div class="og-kv">${rows.filter(Boolean).join('')}</div>
</div>`;

        const el = this._shadow.querySelector('#og-content');
        el.innerHTML = `
<div class="og-cost-row">
    <div>
        <div class="og-cost-label">TOTAL COST</div>
        <div class="og-cost-big">${_fmtCost(d.total_cost ?? d.usage)}</div>
    </div>
    <div style="flex:1"></div>
    ${d.finish_reason ? `<span class="og-val ${d.finish_reason === 'stop' ? 'green' : 'amber'}" style="font-size:13px">${_esc(d.finish_reason)}</span>` : ''}
</div>

${bar}

${sec('Request', [
    row('id',          d.id),
    row('model',       d.model,         'blue'),
    row('provider',    d.provider_name),
    row('created',     d.created_at ? new Date(d.created_at).toLocaleString() : null),
    row('streamed',    d.streamed != null ? String(d.streamed) : null),
    row('cancelled',   d.cancelled ? 'yes' : null, 'red'),
    row('byok',        d.is_byok ? 'yes' : null),
    row('origin',      d.origin ?? d.http_referer),
])}

${sec('Latency', [
    row('total',       _fmtMs(d.latency)),
    row('generation',  _fmtMs(d.generation_time)),
    row('moderation',  d.moderation_latency ? _fmtMs(d.moderation_latency) : null),
])}

${sec('Tokens', [
    row('prompt',          _fmtTok(d.tokens_prompt)             ?? '—'),
    row('completion',      _fmtTok(d.tokens_completion)         ?? '—'),
    row('native prompt',   _fmtTok(d.native_tokens_prompt)),
    row('native compl.',   _fmtTok(d.native_tokens_completion)),
    row('reasoning',       _fmtTok(d.native_tokens_reasoning)),
    row('cached',          _fmtTok(d.native_tokens_cached)),
    row('cache discount',  d.cache_discount ? _fmtCost(d.cache_discount) : null, 'green'),
])}

${sec('Cost', [
    row('usage',           _fmtCost(d.usage)),
    row('upstream cost',   d.upstream_inference_cost ? _fmtCost(d.upstream_inference_cost) : null),
    row('media (prompt)',  d.num_media_prompt || null),
    row('search results',  d.num_search_results || null),
])}`;
    }

    _renderRaw() {
        const el = this._shadow.querySelector('#og-raw');
        if (!el || !this._data) return;
        const json = JSON.stringify(this._data, null, 2);
        const hl   = json
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
                if (/^"/.test(m)) return /:$/.test(m) ? `<span class="jk">${m}</span>` : `<span class="js">${m}</span>`;
                if (/true|false|null/.test(m)) return `<span class="jb">${m}</span>`;
                return `<span class="jn">${m}</span>`;
            });
        el.innerHTML = `<pre>${hl}</pre>`;
    }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return document;
    }
}

function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

if (!customElements.get('sg-openrouter-generation')) {
    customElements.define('sg-openrouter-generation', SgOpenrouterGeneration);
}
window.SgOpenrouterGeneration = SgOpenrouterGeneration;
