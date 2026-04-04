/**
 * sg-openrouter-activity — OpenRouter aggregated usage by date + model.
 *
 * Fetches GET /api/v1/activity which returns usage aggregated by
 * (date, model). Requires the management key (listens for or:admin-connected).
 *
 * Each row: date | model | provider | requests | cost | prompt | completion
 *
 * Note: This endpoint returns aggregated stats — no individual generation IDs.
 * Use sg-openrouter-generation for per-request detail lookup.
 *
 * API endpoint:
 *   GET https://openrouter.ai/api/v1/activity?limit=25&offset=0
 *   Authorization: Bearer <management-key>
 *
 * Consumes (on [data-llm-bus] ancestor):
 *   or:admin-connected  — { managementKey } → load activity
 *   or:admin-disconnected — clear display
 *
 * Emits: (none)
 *
 * @module sg-openrouter-activity
 * @version 0.1.0
 */

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
.oa-btn.active { border-color: #3b82f6; color: #60a5fa; background: #0d1a3d; }
.oa-spinner {
    display: inline-block;
    width: 9px; height: 9px;
    border: 1px solid #374151;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Body ────────────────────────────────────────────── */
.oa-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
}
.oa-body::-webkit-scrollbar { width: 6px; }
.oa-body::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

/* ── Raw JSON view ───────────────────────────────────── */
.oa-raw {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 10px;
    font-family: monospace;
    font-size: 11px;
    line-height: 1.5;
    display: none;
}
.oa-raw::-webkit-scrollbar { width: 6px; }
.oa-raw::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }
.oa-raw pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: #c8d0e0;
}
.oa-raw .jk { color: #93c5fd; }
.oa-raw .js { color: #4ade80; }
.oa-raw .jn { color: #fbbf24; }
.oa-raw .jb { color: #a78bfa; }

/* ── Empty / error ───────────────────────────────────── */
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
.oa-table thead th.sorted.desc::after { content: ' ▼'; }

.oa-table tbody tr {
    border-bottom: 1px solid #0f0f1e;
    transition: background 0.1s;
}
.oa-table tbody tr:hover { background: #12122a; }
.oa-table tbody td {
    padding: 5px 8px;
    vertical-align: middle;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 0;
}

.col-date   { width: 82px; }
.col-model  { width: auto; }
.col-prov   { width: 80px; }
.col-reqs   { width: 42px; text-align: right; }
.col-cost   { width: 70px; text-align: right; }
.col-prompt { width: 60px; text-align: right; }
.col-compl  { width: 60px; text-align: right; }

.v-date   { color: #64748b; font-size: 10px; }
.v-model  { color: #93c5fd; }
.v-prov   { color: #64748b; font-size: 10px; }
.v-reqs   { color: #c8d0e0; }
.v-cost   { color: #fbbf24; }
.v-free   { color: #374151; }
.v-tok    { color: #64748b; }

/* ── Key filter ──────────────────────────────────────── */
.oa-key-select {
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    color: #64748b;
    font-family: monospace;
    font-size: 10px;
    padding: 2px 6px;
    max-width: 130px;
    cursor: pointer;
}
.oa-key-select:focus { outline: none; border-color: #3b82f6; }
.oa-key-select option { background: #12122a; }

/* ── Pager ───────────────────────────────────────────── */
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
        this._shadow      = this.attachShadow({ mode: 'open' });
        this._mgmtKey     = null;
        this._rows        = [];
        this._rawJson     = null;
        this._offset      = 0;
        this._total       = 0;
        this._loading     = false;
        this._showRaw     = false;
        this._sortCol     = 'date';
        this._sortDesc    = true;
        this._keyFilter   = '';   // api_key_hash filter
        this._availKeys   = [];   // from or:keys-loaded
    }

    connectedCallback() {
        this._render();
        this._setupBus();
    }

    disconnectedCallback() {
        this._teardownBus();
    }

    // ── Bus ───────────────────────────────────────────────────────────────────

    _setupBus() {
        this._onAdminConnected = e => {
            this._mgmtKey = e.detail?.managementKey;
            if (this._mgmtKey) { this._offset = 0; this._fetch(); }
        };
        this._onAdminDisconnected = () => {
            this._mgmtKey = null;
            this._rows    = [];
            this._rawJson = null;
            this._showEmpty('Connect admin key to see activity');
        };
        this._onKeysLoaded = e => {
            this._availKeys = e.detail?.keys ?? [];
            this._updateKeySelect();
        };
        // Use document directly — sg-layout shadow DOM blocks parentElement walking
        document.addEventListener('or:admin-connected',    this._onAdminConnected);
        document.addEventListener('or:admin-disconnected', this._onAdminDisconnected);
        document.addEventListener('or:keys-loaded',        this._onKeysLoaded);
    }

    _teardownBus() {
        document.removeEventListener('or:admin-connected',    this._onAdminConnected);
        document.removeEventListener('or:admin-disconnected', this._onAdminDisconnected);
        document.removeEventListener('or:keys-loaded',        this._onKeysLoaded);
    }

    // ── Fetch ─────────────────────────────────────────────────────────────────

    async _fetch() {
        if (!this._mgmtKey || this._loading) return;
        this._loading = true;
        this._setRefreshing(true);

        try {
            let url = `${ACTIVITY_URL}?limit=${PAGE_SIZE}&offset=${this._offset}`;
            if (this._keyFilter) url += `&api_key_hash=${encodeURIComponent(this._keyFilter)}`;
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${this._mgmtKey}` },
            });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const json = await res.json();
            this._rawJson = json;

            const items  = Array.isArray(json) ? json : (json.data ?? []);
            this._total  = json.meta?.total ?? json.total ?? items.length;
            this._rows   = items;

            if (this._showRaw) {
                this._renderRaw();
            } else {
                this._renderTable();
            }
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
    <select class="oa-key-select" id="key-select" title="Filter by API key">
        <option value="">All keys</option>
    </select>
    <span class="oa-count" id="count"></span>
    <button class="oa-btn" id="raw-btn" title="Toggle raw JSON">{ }</button>
    <button class="oa-btn" id="refresh-btn" title="Refresh">↻</button>
</div>
<div class="oa-body" id="body">
    <div class="oa-empty">Connect admin key to see activity</div>
</div>
<div class="oa-raw" id="raw"></div>
<div class="oa-pager" id="pager" style="display:none">
    <span class="oa-pager-info" id="pager-info"></span>
    <button class="oa-btn" id="prev-btn">‹ Prev</button>
    <button class="oa-btn" id="next-btn">Next ›</button>
</div>`;

        this._shadow.getElementById('key-select').addEventListener('change', e => {
            this._keyFilter = e.target.value;
            this._offset = 0;
            if (this._mgmtKey) this._fetch();
        });
        this._shadow.getElementById('refresh-btn').addEventListener('click', () => {
            if (this._mgmtKey) { this._offset = 0; this._fetch(); }
        });
        this._shadow.getElementById('raw-btn').addEventListener('click', () => {
            this._showRaw = !this._showRaw;
            this._shadow.getElementById('raw-btn').classList.toggle('active', this._showRaw);
            if (this._showRaw) {
                this._shadow.getElementById('body').style.display = 'none';
                this._shadow.getElementById('raw').style.display = '';
                this._renderRaw();
            } else {
                this._shadow.getElementById('body').style.display = '';
                this._shadow.getElementById('raw').style.display = 'none';
                this._renderTable();
            }
        });
        this._shadow.getElementById('prev-btn').addEventListener('click', () => {
            if (this._offset > 0) { this._offset = Math.max(0, this._offset - PAGE_SIZE); this._fetch(); }
        });
        this._shadow.getElementById('next-btn').addEventListener('click', () => {
            if (this._offset + PAGE_SIZE < this._total) { this._offset += PAGE_SIZE; this._fetch(); }
        });
    }

    _renderTable() {
        const body = this._shadow.getElementById('body');

        if (!this._rows.length) {
            body.innerHTML = '<div class="oa-empty">No activity found</div>';
            this._shadow.getElementById('pager').style.display = 'none';
            this._shadow.getElementById('count').textContent = '';
            return;
        }

        // Sort
        const sorted = [...this._rows].sort((a, b) => {
            const av = this._sortVal(a), bv = this._sortVal(b);
            if (av < bv) return this._sortDesc ? 1 : -1;
            if (av > bv) return this._sortDesc ? -1 : 1;
            return 0;
        });

        const table = document.createElement('table');
        table.className = 'oa-table';

        const cols = [
            { key: 'date',              label: 'Date',    cls: 'col-date'   },
            { key: 'model',             label: 'Model',   cls: 'col-model'  },
            { key: 'provider_name',     label: 'Provider',cls: 'col-prov'   },
            { key: 'requests',          label: 'Reqs',    cls: 'col-reqs'   },
            { key: 'usage',             label: 'Cost',    cls: 'col-cost'   },
            { key: 'prompt_tokens',     label: 'Prompt',  cls: 'col-prompt' },
            { key: 'completion_tokens', label: 'Compl.',  cls: 'col-compl'  },
        ];

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (const col of cols) {
            const th = document.createElement('th');
            th.className = col.cls + (this._sortCol === col.key ? ' sorted' + (this._sortDesc ? ' desc' : '') : '');
            th.textContent = col.label;
            th.dataset.col = col.key;
            th.addEventListener('click', () => {
                if (this._sortCol === col.key) this._sortDesc = !this._sortDesc;
                else { this._sortCol = col.key; this._sortDesc = true; }
                this._renderTable();
            });
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const row of sorted) {
            const model    = row.model ?? row.model_permaslug ?? '—';
            const provider = row.provider_name ?? '—';
            const date     = row.date ? row.date.slice(0, 10) : '—';
            const reqs     = row.requests ?? '—';
            const cost     = typeof row.usage === 'number' ? row.usage : null;
            const prompt   = row.prompt_tokens ?? 0;
            const compl    = row.completion_tokens ?? 0;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-date"><span class="v-date">${this._esc(date)}</span></td>
                <td class="col-model"><span class="v-model" title="${this._esc(model)}">${this._shortModel(model)}</span></td>
                <td class="col-prov"><span class="v-prov" title="${this._esc(provider)}">${this._esc(provider.slice(0, 10))}</span></td>
                <td class="col-reqs"><span class="v-reqs">${reqs}</span></td>
                <td class="col-cost">${cost !== null && cost > 0 ? `<span class="v-cost">$${cost.toFixed(5)}</span>` : '<span class="v-free">free</span>'}</td>
                <td class="col-prompt"><span class="v-tok">${this._fmtNum(prompt)}</span></td>
                <td class="col-compl"><span class="v-tok">${this._fmtNum(compl)}</span></td>`;
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        body.innerHTML = '';
        body.appendChild(table);

        // Count label
        const from  = this._offset + 1;
        const to    = Math.min(this._offset + this._rows.length, this._total);
        this._shadow.getElementById('count').textContent =
            this._total > PAGE_SIZE ? `${from}–${to} / ${this._total}` : `${this._rows.length}`;

        // Pager
        const pager = this._shadow.getElementById('pager');
        pager.style.display = this._total > PAGE_SIZE ? '' : 'none';
        if (this._total > PAGE_SIZE) {
            this._shadow.getElementById('pager-info').textContent =
                `Page ${Math.floor(this._offset / PAGE_SIZE) + 1} / ${Math.ceil(this._total / PAGE_SIZE)}`;
            this._shadow.getElementById('prev-btn').disabled = this._offset <= 0;
            this._shadow.getElementById('next-btn').disabled = this._offset + PAGE_SIZE >= this._total;
        }
    }

    _renderRaw() {
        const el = this._shadow.getElementById('raw');
        if (!el) return;
        if (!this._rawJson) {
            el.innerHTML = '<div class="oa-empty">No data yet</div>';
            return;
        }
        el.innerHTML = `<pre>${this._syntaxHighlight(this._rawJson)}</pre>`;
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
        btn.disabled = on;
        btn.innerHTML = on ? '<span class="oa-spinner"></span>' : '↻';
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _updateKeySelect() {
        const sel = this._shadow.getElementById('key-select');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">All keys</option>';
        for (const k of this._availKeys) {
            if (!k.hash) continue;
            const opt = document.createElement('option');
            opt.value       = k.hash;
            opt.textContent = (k.label || k.name || k.hash).slice(0, 20);
            opt.title       = k.hash;
            if (k.hash === current) opt.selected = true;
            sel.appendChild(opt);
        }
    }

    _sortVal(row) {
        switch (this._sortCol) {
            case 'date':              return row.date ?? '';
            case 'model':             return (row.model ?? row.model_permaslug ?? '');
            case 'provider_name':     return row.provider_name ?? '';
            case 'requests':          return row.requests ?? 0;
            case 'usage':             return typeof row.usage === 'number' ? row.usage : -1;
            case 'prompt_tokens':     return row.prompt_tokens ?? 0;
            case 'completion_tokens': return row.completion_tokens ?? 0;
            default: return '';
        }
    }

    _fmtNum(n) {
        if (!n) return '0';
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
        return String(n);
    }

    _shortModel(model) {
        const slash = model.lastIndexOf('/');
        const name  = slash >= 0 ? model.slice(slash + 1) : model;
        return name.length > 28 ? name.slice(0, 26) + '..' : name;
    }

    _syntaxHighlight(obj) {
        const json = JSON.stringify(obj, null, 2);
        return json
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, match => {
                if (/^"/.test(match)) {
                    return /:$/.test(match) ? `<span class="jk">${match}</span>` : `<span class="js">${match}</span>`;
                }
                if (/true|false/.test(match)) return `<span class="jb">${match}</span>`;
                if (/null/.test(match))       return `<span class="jb">${match}</span>`;
                return `<span class="jn">${match}</span>`;
            });
    }

    _esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
}

customElements.define('sg-openrouter-activity', SgOpenrouterActivity);
