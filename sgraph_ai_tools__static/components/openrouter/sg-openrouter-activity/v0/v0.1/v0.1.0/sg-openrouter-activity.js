/**
 * sg-openrouter-activity — Recent OpenRouter generation list.
 *
 * Fetches a paginated list of recent generations from the OpenRouter
 * activity API and displays them in a clickable table. Clicking a row
 * fires an `or:generation-selected` event on the [data-llm-bus] ancestor
 * so that sg-openrouter-generation can fetch the full details.
 *
 * API endpoint:
 *   GET https://openrouter.ai/api/v1/activity
 *   Authorization: Bearer <api-key>
 *   Query params: limit (default 25), offset
 *
 * Consumes (on [data-llm-bus] ancestor):
 *   llm:connected        — { provider, apiKey } → loads list (openrouter only)
 *   llm:disconnected     — clears display
 *   llm:request-complete → auto-refresh after each generation
 *
 * Emits (on [data-llm-bus] ancestor):
 *   or:generation-selected — { id: string } — user clicked a row
 *
 * @module sg-openrouter-activity
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const ACTIVITY_URL = 'https://openrouter.ai/api/v1/activity';
const PAGE_SIZE    = 25;

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
.oa-toolbar {
    display: flex;
    gap: 6px;
    padding: 7px 8px;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
    align-items: center;
}
.oa-title {
    flex: 1;
    font-size: 10px;
    letter-spacing: 0.06em;
    color: #374151;
    text-transform: uppercase;
}
.oa-count {
    font-size: 10px;
    color: #374151;
}
.oa-btn {
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    color: #64748b;
    cursor: pointer;
    font-family: monospace;
    font-size: 11px;
    padding: 3px 10px;
    white-space: nowrap;
}
.oa-btn:hover { border-color: #3b82f6; color: #60a5fa; }
.oa-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.oa-spinner {
    display: inline-block;
    width: 9px; height: 9px;
    border: 1px solid #374151;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Scroll body ─────────────────────────────────────── */
.oa-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
}
.oa-body::-webkit-scrollbar { width: 6px; }
.oa-body::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

/* ── Empty / error state ─────────────────────────────── */
.oa-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #374151;
    font-size: 11px;
    text-align: center;
    padding: 1rem;
}

/* ── Table ───────────────────────────────────────────── */
.oa-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
}
.oa-table thead th {
    position: sticky;
    top: 0;
    background: #0d0d1a;
    border-bottom: 1px solid #1e2035;
    padding: 5px 8px;
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
}
.oa-table thead th:hover { color: #60a5fa; }
.oa-table thead th.sorted { color: #60a5fa; }
.oa-table thead th.sorted::after { content: ' ▲'; font-size: 9px; }
.oa-table thead th.sorted.desc::after { content: ' ▼'; font-size: 9px; }

.oa-table tbody tr {
    border-bottom: 1px solid #0f0f1e;
    cursor: pointer;
    transition: background 0.1s;
}
.oa-table tbody tr:hover { background: #12122a; }
.oa-table tbody tr.selected { background: #1e2035; }
.oa-table tbody td {
    padding: 5px 8px;
    vertical-align: middle;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 0;
}

/* Column widths */
.col-time   { width: 110px; }
.col-model  { width: auto; }
.col-cost   { width: 70px; text-align: right; }
.col-tokens { width: 65px; text-align: right; }
.col-lat    { width: 55px; text-align: right; }

.cost-val { color: #fbbf24; }
.cost-free { color: #374151; }
.model-val { color: #93c5fd; }
.time-val { color: #64748b; }
.token-val { color: #64748b; }
.lat-val { color: #64748b; }

/* ── Pagination ──────────────────────────────────────── */
.oa-pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 5px 8px;
    border-top: 1px solid #1e2035;
    flex-shrink: 0;
    font-size: 10px;
    color: #374151;
}
.oa-pager-info { flex: 1; }
`;

export class SgOpenrouterActivity extends HTMLElement {

    constructor() {
        super();
        this._shadow   = this.attachShadow({ mode: 'open' });
        this._apiKey   = null;
        this._rows     = [];
        this._offset   = 0;
        this._total    = 0;
        this._loading  = false;
        this._selectedId = null;
        this._sortCol  = 'created_at';
        this._sortDesc = true;
    }

    connectedCallback() {
        this._render();
        this._setupBus();
    }

    disconnectedCallback() {
        this._teardownBus();
    }

    // ── Bus wiring ────────────────────────────────────────────────────────────

    _setupBus() {
        this._onConnected = e => {
            if (e.detail?.provider !== 'openrouter') return;
            this._apiKey = e.detail.apiKey;
            this._offset = 0;
            this._fetch();
        };
        this._onDisconnected = () => {
            this._apiKey = null;
            this._rows   = [];
            this._offset = 0;
            this._total  = 0;
            this._showEmpty('Connect to see recent activity');
        };
        this._onComplete = () => {
            if (this._apiKey) this._fetch();
        };

        const bus = this._bus();
        bus.addEventListener(SGL_LLM.CONNECTED,        this._onConnected);
        bus.addEventListener(SGL_LLM.DISCONNECTED,     this._onDisconnected);
        bus.addEventListener(SGL_LLM.REQUEST_COMPLETE, this._onComplete);
    }

    _teardownBus() {
        const bus = this._bus();
        bus.removeEventListener(SGL_LLM.CONNECTED,        this._onConnected);
        bus.removeEventListener(SGL_LLM.DISCONNECTED,     this._onDisconnected);
        bus.removeEventListener(SGL_LLM.REQUEST_COMPLETE, this._onComplete);
    }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return document;
    }

    // ── Fetch ─────────────────────────────────────────────────────────────────

    async _fetch() {
        if (!this._apiKey || this._loading) return;
        this._loading = true;
        this._setRefreshing(true);

        try {
            const url = `${ACTIVITY_URL}?limit=${PAGE_SIZE}&offset=${this._offset}`;
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${this._apiKey}` },
            });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const json = await res.json();

            // OpenRouter returns { data: [...], meta: { total } } or just an array
            const items = Array.isArray(json) ? json
                        : (json.data ?? json.activity ?? []);
            this._total = json.meta?.total ?? json.total ?? items.length;
            this._rows  = items;
            this._renderTable();
        } catch (err) {
            this._showEmpty(`Error: ${err.message}`);
        } finally {
            this._loading = false;
            this._setRefreshing(false);
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    _render() {
        this._shadow.innerHTML = `<style>${CSS}</style>
<div class="oa-toolbar">
    <span class="oa-title">Activity</span>
    <span class="oa-count" id="count"></span>
    <button class="oa-btn" id="refresh-btn" title="Refresh">↻</button>
</div>
<div class="oa-body" id="body">
    <div class="oa-empty">Connect to see recent activity</div>
</div>
<div class="oa-pager" id="pager" style="display:none">
    <span class="oa-pager-info" id="pager-info"></span>
    <button class="oa-btn" id="prev-btn">‹ Prev</button>
    <button class="oa-btn" id="next-btn">Next ›</button>
</div>`;

        this._shadow.getElementById('refresh-btn').addEventListener('click', () => {
            if (this._apiKey) { this._offset = 0; this._fetch(); }
        });
        this._shadow.getElementById('prev-btn').addEventListener('click', () => {
            if (this._offset > 0) {
                this._offset = Math.max(0, this._offset - PAGE_SIZE);
                this._fetch();
            }
        });
        this._shadow.getElementById('next-btn').addEventListener('click', () => {
            if (this._offset + PAGE_SIZE < this._total) {
                this._offset += PAGE_SIZE;
                this._fetch();
            }
        });
    }

    _renderTable() {
        const body = this._shadow.getElementById('body');

        if (!this._rows.length) {
            body.innerHTML = '<div class="oa-empty">No recent activity</div>';
            this._shadow.getElementById('pager').style.display = 'none';
            this._shadow.getElementById('count').textContent = '';
            return;
        }

        // Sort
        const sorted = [...this._rows].sort((a, b) => {
            let av = this._sortVal(a, this._sortCol);
            let bv = this._sortVal(b, this._sortCol);
            if (av < bv) return this._sortDesc ? 1 : -1;
            if (av > bv) return this._sortDesc ? -1 : 1;
            return 0;
        });

        const table = document.createElement('table');
        table.className = 'oa-table';

        // Header
        const thead = document.createElement('thead');
        thead.innerHTML = `<tr>
            <th class="col-time${this._sortCol==='created_at'?' sorted'+(this._sortDesc?' desc':''): ''}  " data-col="created_at">Time</th>
            <th class="col-model${this._sortCol==='model'?' sorted'+(this._sortDesc?' desc':''):''}"  data-col="model">Model</th>
            <th class="col-cost${this._sortCol==='total_cost'?' sorted'+(this._sortDesc?' desc':''):''} " data-col="total_cost">Cost</th>
            <th class="col-tokens${this._sortCol==='tokens'?' sorted'+(this._sortDesc?' desc':''):''}" data-col="tokens">Tokens</th>
            <th class="col-lat${this._sortCol==='latency'?' sorted'+(this._sortDesc?' desc':''):''}"   data-col="latency">Lat</th>
        </tr>`;
        thead.querySelectorAll('th').forEach(th => {
            th.addEventListener('click', () => this._toggleSort(th.dataset.col));
        });
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');
        for (const row of sorted) {
            const tr = document.createElement('tr');
            if (row.id === this._selectedId) tr.classList.add('selected');

            const id       = row.id ?? row.generation_id ?? null;
            const model    = row.model ?? '—';
            const cost     = row.total_cost ?? row.cost ?? null;
            const tokens   = (row.usage?.total_tokens) ?? ((row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0)) ?? null;
            const latency  = row.latency ?? row.latency_ms ?? null;
            const time     = row.created_at ? new Date(row.created_at) : null;

            tr.innerHTML = `
                <td class="col-time"><span class="time-val">${time ? this._fmtTime(time) : '—'}</span></td>
                <td class="col-model"><span class="model-val" title="${this._esc(model)}">${this._shortModel(model)}</span></td>
                <td class="col-cost">${cost !== null ? `<span class="cost-val">$${cost.toFixed(5)}</span>` : '<span class="cost-free">free</span>'}</td>
                <td class="col-tokens"><span class="token-val">${tokens !== null ? this._fmtNum(tokens) : '—'}</span></td>
                <td class="col-lat"><span class="lat-val">${latency !== null ? this._fmtLatency(latency) : '—'}</span></td>`;

            if (id) {
                tr.addEventListener('click', () => this._selectRow(id, tr));
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        body.innerHTML = '';
        body.appendChild(table);

        // Count label
        const from  = this._offset + 1;
        const to    = Math.min(this._offset + this._rows.length, this._total);
        const total = this._total;
        this._shadow.getElementById('count').textContent =
            total > PAGE_SIZE ? `${from}–${to} / ${total}` : `${this._rows.length}`;

        // Pager
        const pager = this._shadow.getElementById('pager');
        pager.style.display = total > PAGE_SIZE ? '' : 'none';
        if (total > PAGE_SIZE) {
            this._shadow.getElementById('pager-info').textContent = `Page ${Math.floor(this._offset / PAGE_SIZE) + 1} / ${Math.ceil(total / PAGE_SIZE)}`;
            this._shadow.getElementById('prev-btn').disabled = this._offset <= 0;
            this._shadow.getElementById('next-btn').disabled = this._offset + PAGE_SIZE >= total;
        }
    }

    _selectRow(id, tr) {
        // Highlight
        this._selectedId = id;
        this._shadow.querySelectorAll('.oa-table tbody tr').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');

        // Fire event on bus
        this._bus().dispatchEvent(new CustomEvent('or:generation-selected', {
            bubbles: true,
            detail: { id },
        }));
    }

    _toggleSort(col) {
        if (this._sortCol === col) {
            this._sortDesc = !this._sortDesc;
        } else {
            this._sortCol  = col;
            this._sortDesc = true;
        }
        this._renderTable();
    }

    _sortVal(row, col) {
        switch (col) {
            case 'created_at': return row.created_at ?? '';
            case 'model':      return row.model ?? '';
            case 'total_cost': return row.total_cost ?? row.cost ?? -1;
            case 'tokens':     return (row.usage?.total_tokens) ?? ((row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0)) ?? -1;
            case 'latency':    return row.latency ?? row.latency_ms ?? -1;
            default: return '';
        }
    }

    _showEmpty(msg) {
        const body = this._shadow.getElementById('body');
        if (body) body.innerHTML = `<div class="oa-empty">${this._esc(msg)}</div>`;
        const pager = this._shadow.getElementById('pager');
        if (pager) pager.style.display = 'none';
        const count = this._shadow.getElementById('count');
        if (count) count.textContent = '';
    }

    _setRefreshing(on) {
        const btn = this._shadow.getElementById('refresh-btn');
        if (!btn) return;
        if (on) {
            btn.disabled = true;
            btn.innerHTML = '<span class="oa-spinner"></span>';
        } else {
            btn.disabled = false;
            btn.textContent = '↻';
        }
    }

    // ── Formatters ────────────────────────────────────────────────────────────

    _fmtTime(d) {
        const now   = new Date();
        const diffS = (now - d) / 1000;
        if (diffS < 60)    return `${Math.round(diffS)}s ago`;
        if (diffS < 3600)  return `${Math.round(diffS / 60)}m ago`;
        if (diffS < 86400) return `${Math.round(diffS / 3600)}h ago`;
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    _fmtNum(n) {
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
        return String(n);
    }

    _fmtLatency(ms) {
        if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.round(ms)}ms`;
    }

    _shortModel(model) {
        // Strip provider prefix if model is "provider/name"
        const slash = model.lastIndexOf('/');
        const name  = slash >= 0 ? model.slice(slash + 1) : model;
        return name.length > 28 ? name.slice(0, 26) + '..' : name;
    }

    _esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

customElements.define('sg-openrouter-activity', SgOpenrouterActivity);
