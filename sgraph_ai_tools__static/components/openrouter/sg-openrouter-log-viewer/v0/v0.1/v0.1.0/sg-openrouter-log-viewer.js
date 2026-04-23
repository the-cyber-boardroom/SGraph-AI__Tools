/**
 * sg-openrouter-log-viewer — CSV generation log importer and analyzer.
 *
 * Accepts the CSV export from openrouter.ai/activity (manually exported).
 * CSV columns:
 *   generation_id, created_at, cost_total, cost_web_search, cost_cache,
 *   cost_file_processing, byok_usage_inference, tokens_prompt, tokens_completion,
 *   tokens_reasoning, tokens_cached, model_permaslug, provider_name, variant,
 *   cancelled, streamed, user, finish_reason_raw, finish_reason_normalized,
 *   generation_time_ms, time_to_first_token_ms, app_name, api_key_name
 *
 * Stores parsed rows in localStorage (key: or-logs-data) for persistence.
 *
 * Three tabs:
 *   Import    — file drop zone or paste area
 *   Table     — sortable, filterable per-generation rows
 *   Analytics — cost by model, cost by key, requests/day, latency, providers
 *
 * @module sg-openrouter-log-viewer
 * @version 0.1.0
 */

const STORE_KEY  = 'or-logs-data';
const MAX_STORED = 10000;  // cap stored rows

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
    overflow: hidden;
}

/* ── Tabs ── */
.olv-tabs {
    display: flex;
    gap: 2px;
    padding: 0 10px;
    border-bottom: 1px solid #1e2035;
    background: #08080f;
    flex-shrink: 0;
}
.olv-tab {
    padding: 7px 12px; font-size: 11px; cursor: pointer;
    color: #374151; border: none; background: none;
    border-bottom: 2px solid transparent; font-family: inherit;
    transition: color 0.15s;
}
.olv-tab.active { color: #60a5fa; border-bottom-color: #3b82f6; }
.olv-tab:hover:not(.active) { color: #64748b; }

/* ── Panel ── */
.olv-panel { display: none; flex: 1; min-height: 0; overflow: hidden; }
.olv-panel.active { display: flex; flex-direction: column; }

/* ── Import panel ── */
.olv-import-body {
    flex: 1; display: flex; flex-direction: column; gap: 12px;
    padding: 14px; overflow-y: auto;
}
.olv-drop-zone {
    border: 2px dashed #1e2035; border-radius: 8px; padding: 20px;
    text-align: center; color: #374151; font-size: 11px;
    cursor: pointer; transition: all 0.2s; flex-shrink: 0;
}
.olv-drop-zone:hover, .olv-drop-zone.drag-over {
    border-color: #3b82f6; color: #60a5fa; background: #0d1020;
}
.olv-file-input { display: none; }
.olv-paste-area {
    background: #12122a; border: 1px solid #1e2035; border-radius: 4px;
    color: #c8d0e0; font-family: monospace; font-size: 11px;
    padding: 8px 10px; resize: vertical; min-height: 80px;
    outline: none; width: 100%; box-sizing: border-box;
}
.olv-paste-area:focus { border-color: #3b82f6; }
.olv-btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
.olv-btn {
    background: #12122a; border: 1px solid #1e2035; border-radius: 4px;
    color: #64748b; cursor: pointer; font-family: monospace; font-size: 11px; padding: 5px 14px;
}
.olv-btn:hover { border-color: #3b82f6; color: #60a5fa; }
.olv-btn.primary { background: #1e3a6e; border-color: #3b82f6; color: #93c5fd; }
.olv-btn.danger  { border-color: #7f1d1d; color: #f87171; }
.olv-btn.danger:hover { background: #1a0808; }
.olv-import-status { font-size: 11px; padding: 8px 10px; border-radius: 4px; flex-shrink: 0; }
.olv-import-status.ok   { background: rgba(74,222,128,0.1); color: #4ade80; border: 1px solid rgba(74,222,128,0.2); }
.olv-import-status.err  { background: rgba(248,113,113,0.1); color: #f87171; border: 1px solid rgba(248,113,113,0.2); }
.olv-import-status.info { background: rgba(59,130,246,0.1); color: #60a5fa; border: 1px solid rgba(59,130,246,0.2); }
.olv-stored-info { font-size: 10px; color: #374151; }

/* ── Table panel ── */
.olv-table-toolbar {
    display: flex; gap: 6px; align-items: center;
    padding: 6px 10px; border-bottom: 1px solid #1e2035; flex-shrink: 0; flex-wrap: wrap;
}
.olv-filter-input {
    background: #12122a; border: 1px solid #1e2035; border-radius: 4px;
    color: #c8d0e0; font-family: monospace; font-size: 11px; padding: 3px 8px;
    outline: none; width: 130px;
}
.olv-filter-input:focus { border-color: #3b82f6; }
.olv-filter-input::placeholder { color: #374151; }
.olv-select {
    background: #12122a; border: 1px solid #1e2035; border-radius: 4px;
    color: #64748b; font-family: monospace; font-size: 10px; padding: 3px 6px; cursor: pointer;
}
.olv-count { font-size: 10px; color: #374151; flex: 1; }
.olv-table-body { flex: 1; overflow-y: auto; min-height: 0; }
.olv-table-body::-webkit-scrollbar { width: 6px; }
.olv-table-body::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

.olv-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
.olv-tbl thead th {
    position: sticky; top: 0; background: #0d0d1a;
    border-bottom: 1px solid #1e2035; padding: 5px 6px;
    text-align: left; font-size: 10px; color: #374151; text-transform: uppercase;
    letter-spacing: 0.04em; white-space: nowrap; cursor: pointer; user-select: none;
}
.olv-tbl thead th:hover { color: #60a5fa; }
.olv-tbl thead th.sorted { color: #60a5fa; }
.olv-tbl thead th.sorted::after { content: ' ▲'; font-size: 9px; }
.olv-tbl thead th.sorted.desc::after { content: ' ▼'; }
.olv-tbl tbody tr { border-bottom: 1px solid #0f0f1e; }
.olv-tbl tbody tr:hover { background: #12122a; }
.olv-tbl tbody td { padding: 4px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0; }

.c-date   { width: 85px; }
.c-model  { width: auto; }
.c-prov   { width: 70px; }
.c-key    { width: 90px; }
.c-cost   { width: 65px; text-align: right; }
.c-prompt { width: 52px; text-align: right; }
.c-compl  { width: 52px; text-align: right; }
.c-lat    { width: 58px; text-align: right; }
.c-ok     { width: 30px; text-align: center; }

.v-date  { color: #64748b; font-size: 10px; }
.v-model { color: #93c5fd; }
.v-prov  { color: #64748b; font-size: 10px; }
.v-key   { color: #a78bfa; font-size: 10px; }
.v-cost  { color: #fbbf24; }
.v-free  { color: #374151; }
.v-tok   { color: #64748b; }
.v-lat   { color: #64748b; }
.v-ok    { color: #4ade80; }
.v-cancel{ color: #f87171; }

/* ── Analytics panel ── */
.olv-analytics-body {
    flex: 1; overflow-y: auto; padding: 12px 14px;
    display: flex; flex-direction: column; gap: 16px; min-height: 0;
}
.olv-analytics-body::-webkit-scrollbar { width: 6px; }
.olv-analytics-body::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

.olv-section { font-size: 10px; letter-spacing: 0.06em; color: #374151; text-transform: uppercase;
    border-bottom: 1px solid #1e2035; padding-bottom: 5px; margin-bottom: 8px; }

.olv-stat-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.olv-stat-card {
    background: #12122a; border: 1px solid #1e2035; border-radius: 6px;
    padding: 8px 10px;
}
.olv-stat-label { font-size: 10px; color: #374151; text-transform: uppercase; letter-spacing: 0.04em; }
.olv-stat-value { font-size: 16px; font-weight: 700; color: #c8d0e0; margin-top: 2px; }
.olv-stat-value.cost { color: #fbbf24; }
.olv-stat-value.ok   { color: #4ade80; }

.olv-bar-chart { display: flex; flex-direction: column; gap: 5px; }
.olv-bar-row { display: flex; align-items: center; gap: 6px; }
.olv-bar-name { font-size: 10px; color: #64748b; width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.olv-bar-track { flex: 1; height: 10px; background: #1e2035; border-radius: 3px; overflow: hidden; }
.olv-bar-fill  { height: 100%; border-radius: 3px; background: #1e3a6e; }
.olv-bar-fill.key  { background: #1a2050; }
.olv-bar-fill.prov { background: #1a2a20; }
.olv-bar-val  { font-size: 10px; color: #fbbf24; width: 60px; text-align: right; flex-shrink: 0; }

.olv-empty-panel {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: #374151; font-size: 11px; text-align: center; padding: 2rem;
}
`;

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error('CSV has no data rows');

    const headers = _splitCSVRow(lines[0]);
    const rows    = [];

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cells = _splitCSVRow(lines[i]);
        const row   = {};
        headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
        // Coerce numeric fields
        for (const f of ['cost_total','cost_web_search','cost_cache','cost_file_processing',
                          'byok_usage_inference','tokens_prompt','tokens_completion',
                          'tokens_reasoning','tokens_cached',
                          'generation_time_ms','time_to_first_token_ms']) {
            if (row[f] !== undefined && row[f] !== '') row[f] = parseFloat(row[f]) || 0;
        }
        row.cancelled = row.cancelled === 'true';
        row.streamed  = row.streamed  === 'true';
        rows.push(row);
    }
    return rows;
}

function _splitCSVRow(line) {
    const cells = [];
    let i = 0, cur = '';
    while (i < line.length) {
        if (line[i] === '"') {
            i++;
            while (i < line.length) {
                if (line[i] === '"' && line[i+1] === '"') { cur += '"'; i += 2; }
                else if (line[i] === '"') { i++; break; }
                else { cur += line[i++]; }
            }
            if (line[i] === ',') i++;
        } else {
            const end = line.indexOf(',', i);
            if (end === -1) { cur = line.slice(i); i = line.length; }
            else { cur = line.slice(i, end); i = end + 1; }
        }
        cells.push(cur);
        cur = '';
    }
    return cells;
}

// ── Component ─────────────────────────────────────────────────────────────────

export class SgOpenrouterLogViewer extends HTMLElement {

    constructor() {
        super();
        this._shadow    = this.attachShadow({ mode: 'open' });
        this._rows      = [];
        this._filtered  = [];
        this._sortCol   = 'created_at';
        this._sortDesc  = true;
        this._filterText = '';
        this._filterKey  = '';
        this._tab        = 'import';
    }

    connectedCallback() {
        this._render();
        this._loadStored();
    }

    // ── Render shell ──────────────────────────────────────────────────────────

    _render() {
        this._shadow.innerHTML = `<style>${CSS}</style>
<div class="olv-tabs">
  <button class="olv-tab active" data-tab="import">Import</button>
  <button class="olv-tab" data-tab="table">Table</button>
  <button class="olv-tab" data-tab="analytics">Analytics</button>
</div>
<div class="olv-panel active" id="panel-import">
  <div class="olv-import-body">
    <div class="olv-section">Import CSV log export from openrouter.ai/activity</div>
    <div class="olv-drop-zone" id="drop-zone">
      <div>📂 Drop CSV file here</div>
      <div style="margin-top:6px;font-size:10px;color:#374151">or click to browse</div>
    </div>
    <input type="file" class="olv-file-input" id="file-input" accept=".csv,text/csv">
    <div class="olv-section" style="margin-top:4px">Or paste CSV text</div>
    <textarea class="olv-paste-area" id="paste-area" rows="5"
      placeholder="generation_id,created_at,cost_total,…"></textarea>
    <div class="olv-btn-row">
      <button class="olv-btn primary" id="parse-btn">Parse &amp; import</button>
      <button class="olv-btn" id="append-btn">Append to existing</button>
      <button class="olv-btn danger" id="clear-btn">Clear stored data</button>
    </div>
    <div id="import-status" style="display:none" class="olv-import-status"></div>
    <div class="olv-stored-info" id="stored-info"></div>
  </div>
</div>
<div class="olv-panel" id="panel-table">
  <div class="olv-table-toolbar">
    <input class="olv-filter-input" id="search-input" placeholder="Search model / key…">
    <select class="olv-select" id="key-filter"><option value="">All keys</option></select>
    <select class="olv-select" id="finish-filter">
      <option value="">All status</option>
      <option value="stop">stop</option>
      <option value="cancelled">cancelled</option>
    </select>
    <span class="olv-count" id="table-count"></span>
  </div>
  <div class="olv-table-body" id="table-body">
    <div class="olv-empty-panel">No logs imported yet — use the Import tab</div>
  </div>
</div>
<div class="olv-panel" id="panel-analytics">
  <div id="analytics-body" class="olv-analytics-body">
    <div class="olv-empty-panel">No logs imported yet — use the Import tab</div>
  </div>
</div>`;

        // Tabs
        this._shadow.querySelectorAll('.olv-tab').forEach(tab => {
            tab.addEventListener('click', () => this._switchTab(tab.dataset.tab));
        });

        // Drop zone
        const dz = this._shadow.getElementById('drop-zone');
        const fi = this._shadow.getElementById('file-input');
        dz.addEventListener('click', () => fi.click());
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
        dz.addEventListener('drop', e => {
            e.preventDefault(); dz.classList.remove('drag-over');
            const f = e.dataTransfer?.files?.[0];
            if (f) this._readFile(f);
        });
        fi.addEventListener('change', () => { if (fi.files[0]) this._readFile(fi.files[0]); });

        // Buttons
        this._shadow.getElementById('parse-btn').addEventListener('click', () => {
            const text = this._shadow.getElementById('paste-area').value.trim();
            if (text) this._importCSV(text, false);
        });
        this._shadow.getElementById('append-btn').addEventListener('click', () => {
            const text = this._shadow.getElementById('paste-area').value.trim();
            if (text) this._importCSV(text, true);
        });
        this._shadow.getElementById('clear-btn').addEventListener('click', () => {
            if (!confirm('Clear all stored log data?')) return;
            this._rows = []; this._filtered = [];
            try { localStorage.removeItem(STORE_KEY); } catch {}
            this._updateStoredInfo();
            this._setImportStatus('Data cleared', 'info');
            this._renderTable();
            this._renderAnalytics();
        });

        // Table filters
        this._shadow.getElementById('search-input').addEventListener('input', e => {
            this._filterText = e.target.value.toLowerCase();
            this._applyFilter();
        });
        this._shadow.getElementById('key-filter').addEventListener('change', e => {
            this._filterKey = e.target.value;
            this._applyFilter();
        });
        this._shadow.getElementById('finish-filter').addEventListener('change', e => {
            this._filterFinish = e.target.value;
            this._applyFilter();
        });
    }

    _switchTab(tab) {
        this._tab = tab;
        this._shadow.querySelectorAll('.olv-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        this._shadow.querySelectorAll('.olv-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
        if (tab === 'table')     this._renderTable();
        if (tab === 'analytics') this._renderAnalytics();
    }

    // ── Import ────────────────────────────────────────────────────────────────

    _readFile(file) {
        const reader = new FileReader();
        reader.onload = e => {
            this._shadow.getElementById('paste-area').value = e.target.result;
            this._importCSV(e.target.result, false);
        };
        reader.onerror = () => this._setImportStatus('File read error', 'err');
        reader.readAsText(file);
    }

    _importCSV(text, append) {
        try {
            const parsed = parseCSV(text);
            if (!parsed.length) throw new Error('No rows parsed');

            if (append && this._rows.length) {
                // Merge by generation_id
                const existing = new Set(this._rows.map(r => r.generation_id));
                const newRows  = parsed.filter(r => !existing.has(r.generation_id));
                this._rows = [...this._rows, ...newRows].slice(-MAX_STORED);
                this._setImportStatus(`Appended ${newRows.length} new rows (${parsed.length - newRows.length} duplicates skipped). Total: ${this._rows.length}`, 'ok');
            } else {
                this._rows = parsed.slice(-MAX_STORED);
                this._setImportStatus(`Imported ${this._rows.length} rows`, 'ok');
            }

            this._saveStored();
            this._updateStoredInfo();
            this._populateKeyFilter();
            this._applyFilter();

            // Auto-switch to table
            setTimeout(() => this._switchTab('table'), 600);
        } catch (err) {
            this._setImportStatus(`Parse error: ${err.message}`, 'err');
        }
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    _loadStored() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw) return;
            const { rows } = JSON.parse(raw);
            if (Array.isArray(rows)) {
                this._rows     = rows;
                this._filtered = rows;
                this._populateKeyFilter();
                this._applyFilter();
                this._updateStoredInfo();
            }
        } catch {}
    }

    _saveStored() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify({ rows: this._rows, saved_at: new Date().toISOString() })); } catch {}
    }

    _updateStoredInfo() {
        const el = this._shadow.getElementById('stored-info');
        if (!el) return;
        el.textContent = this._rows.length
            ? `${this._rows.length} rows stored in localStorage`
            : 'No data stored';
    }

    _setImportStatus(msg, cls) {
        const el = this._shadow.getElementById('import-status');
        if (!el) return;
        el.style.display = '';
        el.className = `olv-import-status ${cls}`;
        el.textContent = msg;
    }

    // ── Table ─────────────────────────────────────────────────────────────────

    _populateKeyFilter() {
        const sel = this._shadow.getElementById('key-filter');
        if (!sel) return;
        const keys = [...new Set(this._rows.map(r => r.api_key_name).filter(Boolean))].sort();
        sel.innerHTML = '<option value="">All keys</option>';
        keys.forEach(k => {
            const o = document.createElement('option');
            o.value = k; o.textContent = k.length > 24 ? k.slice(0, 22) + '..' : k;
            if (k === this._filterKey) o.selected = true;
            sel.appendChild(o);
        });
    }

    _applyFilter() {
        this._filtered = this._rows.filter(r => {
            if (this._filterText) {
                const haystack = `${r.model_permaslug} ${r.api_key_name} ${r.provider_name} ${r.generation_id}`.toLowerCase();
                if (!haystack.includes(this._filterText)) return false;
            }
            if (this._filterKey && r.api_key_name !== this._filterKey) return false;
            if (this._filterFinish === 'cancelled' && !r.cancelled) return false;
            if (this._filterFinish === 'stop' && r.cancelled) return false;
            return true;
        });
        if (this._tab === 'table') this._renderTable();
    }

    _renderTable() {
        const body = this._shadow.getElementById('table-body');
        if (!body) return;

        const countEl = this._shadow.getElementById('table-count');
        if (!this._filtered.length) {
            body.innerHTML = `<div class="olv-empty-panel">${this._rows.length ? 'No rows match filter' : 'No logs imported yet'}</div>`;
            if (countEl) countEl.textContent = '';
            return;
        }

        if (countEl) countEl.textContent = `${this._filtered.length} of ${this._rows.length} rows`;

        // Sort
        const sorted = [...this._filtered].sort((a, b) => {
            const av = a[this._sortCol] ?? '', bv = b[this._sortCol] ?? '';
            return this._sortDesc ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
        });

        const COLS = [
            { key: 'created_at',         label: 'Time',    cls: 'c-date'   },
            { key: 'model_permaslug',    label: 'Model',   cls: 'c-model'  },
            { key: 'provider_name',      label: 'Provider',cls: 'c-prov'   },
            { key: 'api_key_name',       label: 'Key',     cls: 'c-key'    },
            { key: 'cost_total',         label: 'Cost',    cls: 'c-cost'   },
            { key: 'tokens_prompt',      label: 'Prompt',  cls: 'c-prompt' },
            { key: 'tokens_completion',  label: 'Compl.',  cls: 'c-compl'  },
            { key: 'generation_time_ms', label: 'Latency', cls: 'c-lat'    },
            { key: 'cancelled',          label: '✓',       cls: 'c-ok'     },
        ];

        const table = document.createElement('table');
        table.className = 'olv-tbl';

        const thead = document.createElement('thead');
        const hRow  = document.createElement('tr');
        for (const col of COLS) {
            const th = document.createElement('th');
            th.className = col.cls + (this._sortCol === col.key ? ' sorted' + (this._sortDesc ? ' desc' : '') : '');
            th.textContent = col.label;
            th.addEventListener('click', () => {
                if (this._sortCol === col.key) this._sortDesc = !this._sortDesc;
                else { this._sortCol = col.key; this._sortDesc = true; }
                this._renderTable();
            });
            hRow.appendChild(th);
        }
        thead.appendChild(hRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const r of sorted.slice(0, 500)) { // cap DOM rows
            const dt    = r.created_at ? r.created_at.slice(0, 16).replace('T', ' ') : '—';
            const model = r.model_permaslug ?? '—';
            const mName = model.includes('/') ? model.split('/').pop() : model;
            const prov  = (r.provider_name ?? '—').slice(0, 10);
            const key   = (r.api_key_name ?? '—').slice(0, 18);
            const cost  = typeof r.cost_total === 'number' ? r.cost_total : null;
            const lat   = r.generation_time_ms ? `${(r.generation_time_ms/1000).toFixed(1)}s` : '—';
            const ok    = r.cancelled ? '<span class="v-cancel">✗</span>' : '<span class="v-ok">✓</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
<td class="c-date"><span class="v-date">${_esc(dt)}</span></td>
<td class="c-model"><span class="v-model" title="${_esc(model)}">${_esc(mName.slice(0,28))}</span></td>
<td class="c-prov"><span class="v-prov">${_esc(prov)}</span></td>
<td class="c-key"><span class="v-key" title="${_esc(r.api_key_name ?? '')}">${_esc(key)}</span></td>
<td class="c-cost">${cost !== null && cost > 0 ? `<span class="v-cost">$${cost.toFixed(5)}</span>` : '<span class="v-free">free</span>'}</td>
<td class="c-prompt"><span class="v-tok">${_fmtNum(r.tokens_prompt)}</span></td>
<td class="c-compl"><span class="v-tok">${_fmtNum(r.tokens_completion)}</span></td>
<td class="c-lat"><span class="v-lat">${lat}</span></td>
<td class="c-ok">${ok}</td>`;
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        body.innerHTML = '';
        body.appendChild(table);
    }

    // ── Analytics ─────────────────────────────────────────────────────────────

    _renderAnalytics() {
        const body = this._shadow.getElementById('analytics-body');
        if (!body) return;

        if (!this._rows.length) {
            body.innerHTML = '<div class="olv-empty-panel">No logs imported yet</div>';
            return;
        }

        const rows = this._rows;

        // Aggregate
        const totalCost  = rows.reduce((s, r) => s + (r.cost_total || 0), 0);
        const totalReqs  = rows.length;
        const cancelled  = rows.filter(r => r.cancelled).length;
        const avgLat     = rows.filter(r => r.generation_time_ms > 0)
                               .reduce((s, r, _, a) => s + r.generation_time_ms / a.length, 0);
        const totalTok   = rows.reduce((s, r) => s + (r.tokens_prompt || 0) + (r.tokens_completion || 0), 0);

        // By model
        const byModel = {};
        for (const r of rows) {
            const m = r.model_permaslug ?? '—';
            if (!byModel[m]) byModel[m] = { cost: 0, reqs: 0 };
            byModel[m].cost += r.cost_total || 0;
            byModel[m].reqs++;
        }
        const topModels = Object.entries(byModel).sort((a,b) => b[1].cost - a[1].cost).slice(0, 10);

        // By key
        const byKey = {};
        for (const r of rows) {
            const k = r.api_key_name || '(none)';
            if (!byKey[k]) byKey[k] = { cost: 0, reqs: 0 };
            byKey[k].cost += r.cost_total || 0;
            byKey[k].reqs++;
        }
        const topKeys = Object.entries(byKey).sort((a,b) => b[1].cost - a[1].cost).slice(0, 10);

        // By provider
        const byProv = {};
        for (const r of rows) {
            const p = r.provider_name || '—';
            if (!byProv[p]) byProv[p] = { cost: 0, reqs: 0 };
            byProv[p].cost += r.cost_total || 0;
            byProv[p].reqs++;
        }
        const topProvs = Object.entries(byProv).sort((a,b) => b[1].cost - a[1].cost).slice(0, 8);

        // Requests per day
        const byDate = {};
        for (const r of rows) {
            const d = (r.created_at ?? '').slice(0, 10);
            if (!d) continue;
            if (!byDate[d]) byDate[d] = { reqs: 0, cost: 0 };
            byDate[d].reqs++;
            byDate[d].cost += r.cost_total || 0;
        }
        const days = Object.entries(byDate).sort((a,b) => a[0] > b[0] ? 1 : -1).slice(-30);

        body.innerHTML = '';

        // Summary cards
        const cards = document.createElement('div');
        cards.innerHTML = `<div class="olv-section">Summary (${totalReqs.toLocaleString()} generations)</div>`;
        const grid = document.createElement('div');
        grid.className = 'olv-stat-cards';
        grid.innerHTML = `
<div class="olv-stat-card"><div class="olv-stat-label">Total cost</div><div class="olv-stat-value cost">$${totalCost.toFixed(4)}</div></div>
<div class="olv-stat-card"><div class="olv-stat-label">Success rate</div><div class="olv-stat-value ok">${((1 - cancelled/totalReqs)*100).toFixed(1)}%</div></div>
<div class="olv-stat-card"><div class="olv-stat-label">Avg latency</div><div class="olv-stat-value">${(avgLat/1000).toFixed(2)}s</div></div>
<div class="olv-stat-card"><div class="olv-stat-label">Total tokens</div><div class="olv-stat-value">${_fmtNum(totalTok)}</div></div>
<div class="olv-stat-card"><div class="olv-stat-label">Cancelled</div><div class="olv-stat-value">${cancelled}</div></div>
<div class="olv-stat-card"><div class="olv-stat-label">Avg cost/req</div><div class="olv-stat-value cost">$${(totalCost/totalReqs).toFixed(5)}</div></div>`;
        cards.appendChild(grid);
        body.appendChild(cards);

        // Daily chart
        if (days.length > 1) body.appendChild(this._buildDailyChart(days));

        // By model
        body.appendChild(this._buildHBar(topModels, 'Cost by model', 'cost'));
        // By key
        body.appendChild(this._buildHBar(topKeys,   'Cost by API key', 'cost', 'key'));
        // By provider
        body.appendChild(this._buildHBar(topProvs,  'Cost by provider', 'cost', 'prov'));
    }

    _buildDailyChart(days) {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div class="olv-section">Requests per day (last ${days.length} days)</div>`;

        const W = 380, H = 70, PAD = { l: 32, r: 8, t: 6, b: 18 };
        const maxReqs = Math.max(...days.map(d => d[1].reqs), 1);
        const iW = W - PAD.l - PAD.r;
        const iH = H - PAD.t - PAD.b;

        if (days.length < 2) { wrap.innerHTML += '<div style="color:#374151;font-size:11px">Not enough data</div>'; return wrap; }

        const xs = days.map((_, i) => PAD.l + (i / (days.length - 1)) * iW);
        const ys = days.map(([, d]) => PAD.t + iH - (d.reqs / maxReqs) * iH);
        const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');

        const xLabels = days.filter((_, i) => i % Math.max(1, Math.floor(days.length / 5)) === 0).map(([date], _, arr) => {
            const idx = days.findIndex(d => d[0] === date);
            return `<text x="${xs[idx].toFixed(1)}" y="${H - 2}" font-size="8" fill="#374151" text-anchor="middle">${date.slice(5)}</text>`;
        }).join('');

        const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">
  <line x1="${PAD.l}" y1="${PAD.t + iH}" x2="${W - PAD.r}" y2="${PAD.t + iH}" stroke="#1e2035" stroke-width="0.5"/>
  <text x="${PAD.l - 3}" y="${PAD.t + 4}" font-size="8" fill="#374151" text-anchor="end">${maxReqs}</text>
  <polygon points="${xs[0]},${PAD.t + iH} ${points} ${xs[days.length-1]},${PAD.t + iH}" fill="#0d1a3d" opacity="0.8"/>
  <polyline points="${points}" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${xLabels}
</svg>`;

        const c = document.createElement('div');
        c.innerHTML = svg;
        wrap.appendChild(c);
        return wrap;
    }

    _buildHBar(entries, title, valKey, style) {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div class="olv-section">${_esc(title)}</div>`;
        if (!entries.length) { wrap.innerHTML += '<div style="color:#374151;font-size:11px">No data</div>'; return wrap; }

        const maxVal = entries[0][1][valKey] || 0.0001;
        const bars = entries.map(([name, stats]) => {
            const pct = Math.max(2, (stats[valKey] / maxVal) * 100).toFixed(1);
            const label = name.includes('/') ? name.split('/').pop() : name;
            const disp  = label.length > 22 ? label.slice(0, 20) + '..' : label;
            const valStr = valKey === 'cost' ? `$${stats.cost.toFixed(4)}` : stats[valKey];
            return `<div class="olv-bar-row">
  <span class="olv-bar-name" title="${_esc(name)}">${_esc(disp)}</span>
  <div class="olv-bar-track"><div class="olv-bar-fill ${style ?? ''}" style="width:${pct}%"></div></div>
  <span class="olv-bar-val">${valStr}</span>
</div>`;
        }).join('');

        const chart = document.createElement('div');
        chart.className = 'olv-bar-chart';
        chart.innerHTML = bars;
        wrap.appendChild(chart);
        return wrap;
    }
}

function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _fmtNum(n) {
    if (!n) return '0';
    if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${(n/1_000).toFixed(1)}k`;
    return String(n);
}

customElements.define('sg-openrouter-log-viewer', SgOpenrouterLogViewer);
