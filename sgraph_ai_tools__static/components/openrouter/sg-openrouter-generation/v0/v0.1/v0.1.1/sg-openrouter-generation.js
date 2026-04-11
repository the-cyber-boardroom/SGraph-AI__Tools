/**
 * sg-openrouter-generation — Generation request detail viewer.
 *
 * Uses sg-layout internally for a resizable 3-panel interface:
 *   Left  — "Recent" history panel (sg-or-gen-history)
 *   Right — "Detail" tab (sg-or-gen-detail) + "Raw JSON" tab (sg-or-gen-raw)
 *
 * Generation IDs are captured automatically from llm:request-complete events
 * and stored in sessionStorage. Click a history row to re-fetch its details.
 *
 * API endpoint:
 *   GET https://openrouter.ai/api/v1/generation?id={generation_id}
 *   Authorization: Bearer <api-key>
 *
 * Consumes (on [data-llm-bus] ancestor):
 *   llm:connected        — { provider, apiKey } → stores key (openrouter only)
 *   llm:disconnected     — clears key
 *   llm:request-complete — auto-captures generation ID from rawResponse.id
 *
 * Consumes (on document — crosses sg-layout shadow boundary):
 *   or:generation-selected — { id } — fired by sg-openrouter-activity row click
 *   or:admin-connected     — { managementKey } → fallback API key
 *
 * v0.1.1 changes:
 *   - `_fetch` retries up to 3 times (2 s / 4 s / 6 s) on HTTP 404 so the
 *     generation record has time to propagate on OpenRouter's side before
 *     giving up.
 *   - `hide-recent` boolean attribute: when present the inner layout shows
 *     only Detail + Raw JSON tabs (no Recent history column). Useful when
 *     the component is embedded in a per-result panel where history is not
 *     relevant.
 *
 * @module sg-openrouter-generation
 * @version 0.1.1
 */

import '/core/sg-layout/v0.1.0/sg-layout.js';
import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const GEN_URL      = 'https://openrouter.ai/api/v1/generation';
const HISTORY_KEY  = 'or-generation-history';
const HISTORY_MAX  = 50;

// ── Module-level singleton ─────────────────────────────────────────────────────
// One generation component per page — sub-components access it via this ref.
let _genInst = null;

// ── Helper functions ──────────────────────────────────────────────────────────

function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _fmtCost(n) {
    if (n === null || n === undefined) return '—';
    if (n === 0) return '$0.0000';
    if (n < 0.00001) return `$${n.toExponential(3)}`;
    return `$${n.toFixed(Math.max(4, -Math.floor(Math.log10(n)) + 2))}`;
}

function _fmtMs(n) {
    if (!n) return '—';
    if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
    return `${Math.round(n)}ms`;
}

function _fmtTok(n) {
    if (n === null || n === undefined || n === 0) return null;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function _relTime(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60)    return `${Math.round(s)}s ago`;
    if (s < 3600)  return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
}

function _syntaxHL(obj) {
    const json = JSON.stringify(obj, null, 2);
    return json
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
            if (/^"/.test(m)) return /:$/.test(m) ? `<span class="jk">${m}</span>` : `<span class="js">${m}</span>`;
            if (/true|false|null/.test(m)) return `<span class="jb">${m}</span>`;
            return `<span class="jn">${m}</span>`;
        });
}

// ── sg-or-gen-history ─────────────────────────────────────────────────────────
// Left panel: list of captured generation IDs.

class SgOrGenHistory extends HTMLElement {
    connectedCallback() {
        this._shadow = this.attachShadow({ mode: 'open' });
        this._shadow.innerHTML = `<style>
:host {
    display: flex; flex-direction: column; height: 100%;
    font-family: monospace; font-size: 11px;
    background: #0d0d1a; color: #c8d0e0;
    overflow: hidden;
}
.h-body { flex: 1; overflow-y: auto; min-height: 0; }
.h-body::-webkit-scrollbar { width: 4px; }
.h-body::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 2px; }
.h-row {
    padding: 6px 10px; cursor: pointer;
    border-bottom: 1px solid #0f0f1e;
    transition: background 0.1s;
}
.h-row:hover  { background: #12122a; }
.h-row.active { background: #1e2035; }
.h-model { font-size: 10px; color: #93c5fd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.h-meta  { font-size: 9px; color: #374151; margin-top: 2px; }
.h-empty { color: #374151; font-size: 10px; padding: 12px; text-align: center; line-height: 1.6; }
</style>
<div class="h-body" id="body"><div class="h-empty">No captures yet.<br>Make a request to start capturing.</div></div>`;

        this._onRefresh = () => this._render();
        document.addEventListener('or:gen-history-refresh', this._onRefresh);
        this._render();
    }

    disconnectedCallback() {
        document.removeEventListener('or:gen-history-refresh', this._onRefresh);
    }

    _render() {
        const gen  = _genInst;
        const body = this._shadow.getElementById('body');
        if (!gen || !body) return;

        const history   = gen._history;
        const activeId  = gen._currentId;

        if (!history.length) {
            body.innerHTML = '<div class="h-empty">No captures yet.<br>Make a request to start capturing.</div>';
            return;
        }

        body.innerHTML = '';
        for (const h of history) {
            const row = document.createElement('div');
            row.className = 'h-row' + (h.id === activeId ? ' active' : '');
            const model = h.model ? h.model.split('/').pop() : '—';
            const cost  = h.cost !== null ? ` · ${_fmtCost(h.cost)}` : '';
            row.innerHTML = `
                <div class="h-model" title="${_esc(h.id)}">${_esc(model.slice(0, 24))}</div>
                <div class="h-meta">${_esc(_relTime(h.ts))}${_esc(cost)}</div>`;
            row.addEventListener('click', () => gen._loadFromHistory(h.id));
            body.appendChild(row);
        }
    }
}
customElements.define('sg-or-gen-history', SgOrGenHistory);

// ── sg-or-gen-detail ──────────────────────────────────────────────────────────
// Right-panel "Detail" tab: formatted generation metadata.

const DETAIL_CSS = `
:host {
    display: flex; flex-direction: column; height: 100%;
    font-family: monospace; font-size: 12px;
    background: #0d0d1a; color: #c8d0e0;
}
.d-scroll {
    flex: 1; overflow-y: auto; min-height: 0; padding: 10px;
}
.d-scroll::-webkit-scrollbar { width: 6px; }
.d-scroll::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

/* State */
.d-state {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: #1e2035; font-size: 11px; text-align: center; padding: 20px;
}
.d-spinner {
    display: inline-block; width: 10px; height: 10px;
    border: 1px solid #374151; border-top-color: #3b82f6;
    border-radius: 50%; animation: spin 0.7s linear infinite; margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.d-error { color: #f87171; font-size: 11px; }

/* Sections */
.d-section { margin-bottom: 12px; }
.d-section-title {
    font-size: 9px; letter-spacing: 0.08em; color: #374151;
    text-transform: uppercase; margin-bottom: 6px; padding-bottom: 4px;
    border-bottom: 1px solid #1e2035;
}
.d-kv { display: flex; flex-direction: column; gap: 4px; }
.d-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; min-height: 16px; }
.d-key { color: #374151; font-size: 10px; white-space: nowrap; flex-shrink: 0; }
.d-val { color: #c8d0e0; font-size: 11px; text-align: right; word-break: break-word; }
.d-val.green { color: #4ade80; } .d-val.amber { color: #fbbf24; }
.d-val.blue  { color: #60a5fa; } .d-val.red   { color: #f87171; }

/* Cost highlight */
.d-cost-big { font-size: 18px; color: #c8d0e0; margin-bottom: 2px; }
.d-cost-row { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
.d-cost-label { font-size: 10px; color: #374151; }

/* Token bar */
.d-token-bar { height: 4px; background: #1e2035; border-radius: 2px; overflow: hidden; margin: 4px 0 8px; display: flex; }
.d-token-seg { height: 100%; }
.d-token-seg.prompt     { background: #3b82f6; }
.d-token-seg.completion { background: #22c55e; }
.d-token-seg.reasoning  { background: #a78bfa; }
.d-token-seg.cached     { background: #374151; }
.d-token-legend { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.d-legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #64748b; }
.d-legend-dot  { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
`;

class SgOrGenDetail extends HTMLElement {
    connectedCallback() {
        this._shadow = this.attachShadow({ mode: 'open' });
        this._shadow.innerHTML = `<style>${DETAIL_CSS}</style>
<div class="d-scroll" id="content">
    <div class="d-state">Waiting for a generation…<br><span style="color:#1e2035;font-size:10px">Use the toolbar above to fetch a generation</span></div>
</div>`;
        this._onData = e => {
            const el = this._shadow.getElementById('content');
            if (el) el.innerHTML = e.detail.html;
        };
        document.addEventListener('or:gen-detail-set', this._onData);
    }
    disconnectedCallback() {
        document.removeEventListener('or:gen-detail-set', this._onData);
    }
}
customElements.define('sg-or-gen-detail', SgOrGenDetail);

// ── sg-or-gen-raw ─────────────────────────────────────────────────────────────
// Right-panel "Raw JSON" tab: syntax-highlighted raw API response.

class SgOrGenRaw extends HTMLElement {
    connectedCallback() {
        this._shadow = this.attachShadow({ mode: 'open' });
        this._shadow.innerHTML = `<style>
:host { display: flex; flex-direction: column; height: 100%; background: #0d0d1a; font-family: monospace; font-size: 11px; color: #c8d0e0; }
.r-scroll { flex: 1; overflow-y: auto; min-height: 0; padding: 10px; }
.r-scroll::-webkit-scrollbar { width: 6px; }
.r-scroll::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
.jk { color: #93c5fd; } .js { color: #4ade80; } .jn { color: #fbbf24; } .jb { color: #a78bfa; }
.r-empty { color: #374151; padding: 12px; font-size: 10px; }
</style>
<div class="r-scroll" id="content"><div class="r-empty">No data yet — fetch a generation first.</div></div>`;
        this._onData = e => {
            const el = this._shadow.getElementById('content');
            if (el) el.innerHTML = e.detail.html;
        };
        document.addEventListener('or:gen-raw-set', this._onData);
    }
    disconnectedCallback() {
        document.removeEventListener('or:gen-raw-set', this._onData);
    }
}
customElements.define('sg-or-gen-raw', SgOrGenRaw);

// ── Main component ────────────────────────────────────────────────────────────

const TOOLBAR_CSS = `
:host {
    display: flex; flex-direction: column; height: 100%; min-height: 0;
    font-family: monospace; font-size: 12px; background: #0d0d1a; color: #c8d0e0;
}
.og-toolbar {
    display: flex; gap: 6px; padding: 7px 8px;
    border-bottom: 1px solid #1e2035; flex-shrink: 0; align-items: center;
}
.og-id-input {
    flex: 1; background: #12122a; border: 1px solid #1e2035; border-radius: 4px;
    color: #c8d0e0; font-family: monospace; font-size: 11px; padding: 4px 8px; min-width: 0;
}
.og-id-input:focus { outline: none; border-color: #3b82f6; }
.og-id-input::placeholder { color: #374151; }
.og-btn {
    background: #12122a; border: 1px solid #1e2035; border-radius: 4px;
    color: #64748b; cursor: pointer; font-family: monospace; font-size: 11px;
    padding: 4px 10px; white-space: nowrap;
}
.og-btn:hover { border-color: #3b82f6; color: #60a5fa; }
.og-btn.primary { background: #1e3a6e; border-color: #3b82f6; color: #93c5fd; }
.og-auto-badge {
    font-size: 10px; padding: 2px 6px; border-radius: 3px;
    border: 1px solid #166534; color: #4ade80; background: #0a1a0d; white-space: nowrap;
}
sg-layout { flex: 1; min-height: 0; }
`;

const INNER_LAYOUT = {
    type: 'row',
    sizes: [0.28, 0.72],
    children: [
        {
            type: 'stack',
            tabs: [{ tag: 'sg-or-gen-history', title: 'Recent' }],
        },
        {
            type: 'stack',
            tabs: [
                { tag: 'sg-or-gen-detail', title: 'Detail'   },
                { tag: 'sg-or-gen-raw',    title: 'Raw JSON' },
            ],
        },
    ],
};

/** Layout used when `hide-recent` attribute is set — no Recent history column. */
const INNER_LAYOUT_NO_RECENT = {
    type: 'stack',
    tabs: [
        { tag: 'sg-or-gen-detail', title: 'Detail'   },
        { tag: 'sg-or-gen-raw',    title: 'Raw JSON' },
    ],
};

export class SgOpenrouterGeneration extends HTMLElement {

    constructor() {
        super();
        this._apiKey        = '';
        this._data          = null;
        this._currentId     = null;
        this._boundHandlers = {};
        this._shadow        = this.attachShadow({ mode: 'open' });
        this._history       = this._loadHistory();
    }

    connectedCallback() {
        _genInst = this;
        this._renderShell();
        this._bindBusEvents();
    }

    disconnectedCallback() {
        if (_genInst === this) _genInst = null;
        const bus = this._bus();
        for (const [ev, entry] of Object.entries(this._boundHandlers)) {
            const target = entry.target ?? bus;
            const fn     = entry.bound  ?? entry;
            target.removeEventListener(ev, fn);
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    async fetchGeneration(id) {
        if (!id) return;
        this._shadow.querySelector('.og-id-input').value = id;
        await this._fetch(id);
    }

    clear() {
        this._data      = null;
        this._currentId = null;
        this._fireDetail(`<div class="d-state">Waiting for a generation…</div>`);
        this._fireRaw('<div class="r-empty">No data yet — fetch a generation first.</div>');
    }

    // ── History ───────────────────────────────────────────────────────────────

    _loadHistory() {
        try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); }
        catch { return []; }
    }

    _saveHistory() {
        try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(this._history)); } catch {}
    }

    _pushHistory(id, model) {
        this._history = this._history.filter(h => h.id !== id);
        this._history.unshift({ id, model, ts: Date.now(), cost: null });
        if (this._history.length > HISTORY_MAX) this._history.length = HISTORY_MAX;
        this._saveHistory();
        document.dispatchEvent(new CustomEvent('or:gen-history-refresh'));
    }

    _updateHistoryCost(id, cost) {
        const entry = this._history.find(h => h.id === id);
        if (entry && entry.cost === null) {
            entry.cost = cost;
            this._saveHistory();
            document.dispatchEvent(new CustomEvent('or:gen-history-refresh'));
        }
    }

    _loadFromHistory(id) {
        this._shadow.querySelector('.og-id-input').value = id;
        const badge = this._shadow.querySelector('.og-auto-badge');
        if (badge) { badge.textContent = 'history'; badge.style.display = 'inline'; }
        this._fetch(id);
    }

    // ── Bus ───────────────────────────────────────────────────────────────────

    _bindBusEvents() {
        const bus = this._bus();
        const on  = (ev, fn, target = bus) => {
            const bound = fn.bind(this);
            this._boundHandlers[ev] = { bound, target };
            target.addEventListener(ev, bound);
        };
        on(SGL_LLM.CONNECTED,        this._onConnected);
        on(SGL_LLM.DISCONNECTED,     this._onDisconnected);
        on(SGL_LLM.REQUEST_COMPLETE, this._onRequestComplete);
        on('or:generation-selected', this._onGenerationSelected, document);
        on('or:admin-connected',     this._onAdminConnected,     document);
    }

    _onConnected(e) {
        if (e.detail?.provider !== 'openrouter') return;
        this._apiKey = e.detail?.apiKey ?? '';
    }

    _onAdminConnected(e) {
        if (!this._apiKey) this._apiKey = e.detail?.managementKey ?? '';
    }

    _onDisconnected() { this._apiKey = ''; }

    _onRequestComplete(e) {
        const raw   = e.detail?.rawResponse;
        const id    = raw?.id    ?? e.detail?.id    ?? null;
        const model = raw?.model ?? e.detail?.model ?? null;
        if (!id) return;
        this._pushHistory(id, model);
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

    // ── Fetch ─────────────────────────────────────────────────────────────────

    /**
     * Fetch generation data from OpenRouter. Retries up to 3 times on HTTP 404
     * (generation record not yet propagated) with 2 s / 4 s / 6 s back-off.
     * @param {string} id - Generation ID
     * @param {number} [_attempt=0] - Internal retry counter
     */
    async _fetch(id, _attempt = 0) {
        if (!id) return;
        this._currentId = id;
        if (!this._apiKey) {
            this._fireDetail(`<div class="d-state d-error">Connect to OpenRouter first</div>`);
            return;
        }
        if (_attempt === 0) {
            this._fireDetail(`<div class="d-state"><span class="d-spinner"></span> Fetching…</div>`);
        }
        try {
            const res = await fetch(`${GEN_URL}?id=${encodeURIComponent(id)}`, {
                headers: { Authorization: `Bearer ${this._apiKey}` },
            });
            if (res.status === 404 && _attempt < 3) {
                const delay = (_attempt + 1) * 2000;
                this._fireDetail(`<div class="d-state"><span class="d-spinner"></span> Not ready yet — retrying in ${delay / 1000}s… (${_attempt + 1}/3)</div>`);
                await new Promise(r => setTimeout(r, delay));
                return this._fetch(id, _attempt + 1);
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            this._data = json.data ?? json;
            this._fireDetail(this._buildDetailHtml(this._data));
            this._fireRaw(`<pre>${_syntaxHL(this._data)}</pre>`);
            if (this._data?.total_cost != null) {
                this._updateHistoryCost(id, this._data.total_cost);
            }
            document.dispatchEvent(new CustomEvent('or:gen-history-refresh'));
        } catch (err) {
            console.warn('[sg-openrouter-generation] error:', err.message);
            this._fireDetail(`<div class="d-state d-error">Error: ${_esc(err.message)}</div>`);
        }
    }

    // ── Render helpers ────────────────────────────────────────────────────────

    _fireDetail(html) {
        document.dispatchEvent(new CustomEvent('or:gen-detail-set', { detail: { html } }));
    }

    _fireRaw(html) {
        document.dispatchEvent(new CustomEvent('or:gen-raw-set', { detail: { html } }));
    }

    _buildDetailHtml(d) {
        const prompt     = d.tokens_prompt      ?? d.native_tokens_prompt      ?? 0;
        const completion = d.tokens_completion   ?? d.native_tokens_completion  ?? 0;
        const reasoning  = d.native_tokens_reasoning ?? 0;
        const cached     = d.native_tokens_cached    ?? 0;
        const total      = prompt + completion + reasoning + cached || 1;

        const bar = `
<div class="d-token-bar">
    <div class="d-token-seg prompt"     style="width:${(prompt    /total*100).toFixed(1)}%"></div>
    <div class="d-token-seg completion" style="width:${(completion/total*100).toFixed(1)}%"></div>
    <div class="d-token-seg reasoning"  style="width:${(reasoning /total*100).toFixed(1)}%"></div>
    <div class="d-token-seg cached"     style="width:${(cached    /total*100).toFixed(1)}%"></div>
</div>
<div class="d-token-legend">
    ${prompt    ? `<span class="d-legend-item"><span class="d-legend-dot" style="background:#3b82f6"></span>prompt ${_fmtTok(prompt)}</span>` : ''}
    ${completion? `<span class="d-legend-item"><span class="d-legend-dot" style="background:#22c55e"></span>completion ${_fmtTok(completion)}</span>` : ''}
    ${reasoning ? `<span class="d-legend-item"><span class="d-legend-dot" style="background:#a78bfa"></span>reasoning ${_fmtTok(reasoning)}</span>` : ''}
    ${cached    ? `<span class="d-legend-item"><span class="d-legend-dot" style="background:#374151"></span>cached ${_fmtTok(cached)}</span>` : ''}
</div>`;

        const row = (k, v, cls = '') => v !== null && v !== undefined && v !== ''
            ? `<div class="d-row"><span class="d-key">${_esc(k)}</span><span class="d-val ${cls}">${_esc(String(v))}</span></div>`
            : '';

        const sec = (title, rows) => `
<div class="d-section">
    <div class="d-section-title">${_esc(title)}</div>
    <div class="d-kv">${rows.filter(Boolean).join('')}</div>
</div>`;

        return `
<div class="d-cost-row">
    <div>
        <div class="d-cost-label">TOTAL COST</div>
        <div class="d-cost-big">${_fmtCost(d.total_cost ?? d.usage)}</div>
    </div>
    <div style="flex:1"></div>
    ${d.finish_reason ? `<span class="d-val ${d.finish_reason === 'stop' ? 'green' : 'amber'}" style="font-size:13px">${_esc(d.finish_reason)}</span>` : ''}
</div>
${bar}
${sec('Request', [
    row('id',         d.id),
    row('model',      d.model, 'blue'),
    row('provider',   d.provider_name),
    row('created',    d.created_at ? new Date(d.created_at).toLocaleString() : null),
    row('streamed',   d.streamed != null ? String(d.streamed) : null),
    row('cancelled',  d.cancelled ? 'yes' : null, 'red'),
    row('byok',       d.is_byok ? 'yes' : null),
    row('origin',     d.origin ?? d.http_referer),
])}
${sec('Latency', [
    row('total',      _fmtMs(d.latency)),
    row('generation', _fmtMs(d.generation_time)),
    row('moderation', d.moderation_latency ? _fmtMs(d.moderation_latency) : null),
])}
${sec('Tokens', [
    row('prompt',          _fmtTok(d.tokens_prompt)),
    row('completion',      _fmtTok(d.tokens_completion)),
    row('native prompt',   _fmtTok(d.native_tokens_prompt)),
    row('native compl.',   _fmtTok(d.native_tokens_completion)),
    row('reasoning',       _fmtTok(d.native_tokens_reasoning)),
    row('cached',          _fmtTok(d.native_tokens_cached)),
    row('cache discount',  d.cache_discount ? _fmtCost(d.cache_discount) : null, 'green'),
])}
${sec('Cost', [
    row('usage',          _fmtCost(d.usage)),
    row('upstream cost',  d.upstream_inference_cost ? _fmtCost(d.upstream_inference_cost) : null),
    row('media (prompt)', d.num_media_prompt || null),
    row('search results', d.num_search_results || null),
])}`;
    }

    // ── Shell ─────────────────────────────────────────────────────────────────

    _renderShell() {
        this._shadow.innerHTML = `<style>${TOOLBAR_CSS}</style>
<div class="og-toolbar">
    <input class="og-id-input" type="text" placeholder="Generation ID (gen-…)" spellcheck="false">
    <span class="og-auto-badge" style="display:none">auto</span>
    <button class="og-btn primary" id="og-fetch-btn">Fetch</button>
    <button class="og-btn" id="og-clear-btn">Clear</button>
</div>
<sg-layout id="og-layout"></sg-layout>`;

        const input = this._shadow.querySelector('.og-id-input');
        this._shadow.querySelector('#og-fetch-btn').addEventListener('click', () => {
            this._fetch(input.value.trim());
        });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') this._fetch(input.value.trim()); });
        this._shadow.querySelector('#og-clear-btn').addEventListener('click', () => this.clear());

        customElements.whenDefined('sg-layout').then(() => {
            const innerLayout = this.hasAttribute('hide-recent') ? INNER_LAYOUT_NO_RECENT : INNER_LAYOUT;
            this._shadow.getElementById('og-layout').setLayout(innerLayout);
        });
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

if (!customElements.get('sg-openrouter-generation')) {
    customElements.define('sg-openrouter-generation', SgOpenrouterGeneration);
}
