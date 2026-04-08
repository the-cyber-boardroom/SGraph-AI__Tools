/**
 * sg-openrouter-spending — Admin spending analytics dashboard.
 *
 * Fetches ALL activity pages from /api/v1/activity (up to 500 rows) and
 * caches in localStorage (15 min TTL). Computes:
 *   - Today / This week / This month / All-time totals
 *   - Per-key breakdown (if keys known from or:keys-loaded)
 *   - Top models by cost (SVG horizontal bar chart)
 *   - Daily spending over last 30 days (SVG line chart)
 *
 * Cache strategy:
 *   Key: or-cache-spending-{mgmtKeyHash}
 *   TTL: 15 minutes
 *   Manual bypass: Refresh button
 *
 * Consumes (document):
 *   or:admin-connected   — { managementKey }
 *   or:admin-disconnected
 *   or:keys-loaded       — { keys: [{hash, label}] }
 *
 * @module sg-openrouter-spending
 * @version 0.1.0
 */

const ACTIVITY_URL = 'https://openrouter.ai/api/v1/activity';
const FETCH_LIMIT  = 100;    // rows per API page
const MAX_ROWS     = 500;    // cap total rows fetched
const CACHE_TTL    = 15 * 60 * 1000;

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
.os-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
}
.os-title { flex: 1; font-size: 10px; letter-spacing: 0.06em; color: #374151; text-transform: uppercase; }
.os-age { font-size: 10px; color: #1e2035; }
.os-progress { font-size: 10px; color: #374151; }
.os-btn {
    background: #12122a; border: 1px solid #1e2035; border-radius: 4px;
    color: #64748b; cursor: pointer; font-family: monospace; font-size: 11px;
    padding: 3px 10px;
}
.os-btn:hover { border-color: #3b82f6; color: #60a5fa; }
.os-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.os-spinner {
    display: inline-block; width: 9px; height: 9px;
    border: 1px solid #374151; border-top-color: #3b82f6;
    border-radius: 50%; animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.os-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.os-body::-webkit-scrollbar { width: 6px; }
.os-body::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

.os-empty {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: #374151; font-size: 11px; text-align: center; padding: 2rem;
}

/* ── Section header ── */
.os-section { font-size: 10px; letter-spacing: 0.06em; color: #374151; text-transform: uppercase;
    border-bottom: 1px solid #1e2035; padding-bottom: 5px; margin-bottom: 8px; }

/* ── Summary cards ── */
.os-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.os-card {
    background: #12122a; border: 1px solid #1e2035; border-radius: 6px;
    padding: 10px 12px; display: flex; flex-direction: column; gap: 3px;
}
.os-card-label { font-size: 10px; color: #374151; text-transform: uppercase; letter-spacing: 0.04em; }
.os-card-value { font-size: 18px; font-weight: 700; color: #fbbf24; }
.os-card-sub { font-size: 10px; color: #374151; }
.os-card.today  { border-color: #1e3060; }
.os-card.week   { border-color: #1a2040; }

/* ── SVG charts ── */
.os-chart-wrap { width: 100%; }
.os-chart-label { font-size: 11px; color: #93c5fd; }

/* ── Bar chart ── */
.os-bar-chart { display: flex; flex-direction: column; gap: 5px; }
.os-bar-row { display: flex; align-items: center; gap: 6px; }
.os-bar-name { font-size: 10px; color: #64748b; width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.os-bar-track { flex: 1; height: 10px; background: #1e2035; border-radius: 3px; overflow: hidden; }
.os-bar-fill  { height: 100%; border-radius: 3px; background: #1e3a6e; transition: width 0.4s; }
.os-bar-fill.key  { background: #1a3020; }
.os-bar-val  { font-size: 10px; color: #fbbf24; width: 55px; text-align: right; flex-shrink: 0; }

/* ── Per-key table ── */
.os-key-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.os-key-table th {
    text-align: left; padding: 4px 8px; font-size: 10px; color: #374151;
    text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid #1e2035;
}
.os-key-table td { padding: 5px 8px; border-bottom: 1px solid #0f0f1e; }
.os-key-table tr:hover td { background: #12122a; }
.v-key-name { color: #93c5fd; }
.v-cost     { color: #fbbf24; }
.v-reqs     { color: #64748b; }
.v-today    { color: #4ade80; }
`;

export class SgOpenrouterSpending extends HTMLElement {

    constructor() {
        super();
        this._shadow   = this.attachShadow({ mode: 'open' });
        this._mgmtKey  = null;
        this._rows     = [];     // all fetched rows
        this._keys     = [];     // from or:keys-loaded
        this._loading  = false;
    }

    connectedCallback() {
        this._renderShell();
        this._setupBus();
    }

    disconnectedCallback() {
        document.removeEventListener('or:admin-connected',    this._onAdminConnected);
        document.removeEventListener('or:admin-disconnected', this._onAdminDisconnected);
        document.removeEventListener('or:keys-loaded',        this._onKeysLoaded);
    }

    // ── Bus ───────────────────────────────────────────────────────────────────

    _setupBus() {
        this._onAdminConnected = e => {
            this._mgmtKey = e.detail?.managementKey;
            if (!this._mgmtKey) return;
            const cached = this._loadCache();
            if (cached) { this._rows = cached.rows; this._renderDashboard(); }
            else          { this._fetchAll(); }
        };
        this._onAdminDisconnected = () => {
            this._mgmtKey = null; this._rows = [];
            this._showEmpty('Connect admin key to view spending');
        };
        this._onKeysLoaded = e => {
            this._keys = e.detail?.keys ?? [];
            if (this._rows.length) this._renderDashboard();
        };
        document.addEventListener('or:admin-connected',    this._onAdminConnected);
        document.addEventListener('or:admin-disconnected', this._onAdminDisconnected);
        document.addEventListener('or:keys-loaded',        this._onKeysLoaded);
    }

    // ── Fetch all pages ───────────────────────────────────────────────────────

    async _fetchAll(bypassCache = false) {
        if (!this._mgmtKey || this._loading) return;

        if (!bypassCache) {
            const cached = this._loadCache();
            if (cached) { this._rows = cached.rows; this._renderDashboard(); return; }
        }

        this._loading = true;
        this._setStatus('Fetching…');
        this._setRefreshing(true);

        const allRows = [];
        let offset = 0;
        let total  = Infinity;

        try {
            while (offset < Math.min(total, MAX_ROWS)) {
                const url = `${ACTIVITY_URL}?limit=${FETCH_LIMIT}&offset=${offset}`;
                const res = await fetch(url, { headers: { 'Authorization': `Bearer ${this._mgmtKey}` } });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json  = await res.json();
                const items = Array.isArray(json) ? json : (json.data ?? []);
                total = json.meta?.total ?? json.total ?? items.length;
                allRows.push(...items);
                offset += items.length;
                if (items.length < FETCH_LIMIT) break;
                this._setStatus(`${allRows.length} / ${total} rows…`);
            }

            this._rows = allRows;
            this._saveCache({ rows: allRows });
            this._renderDashboard();
        } catch (err) {
            this._showEmpty(`Error: ${err.message}`);
        } finally {
            this._loading = false;
            this._setRefreshing(false);
            this._setStatus('');
        }
    }

    // ── Cache ─────────────────────────────────────────────────────────────────

    _cacheId() { return `or-cache-spending-${(this._mgmtKey ?? '').slice(-8)}`; }

    _loadCache() {
        try {
            const raw = localStorage.getItem(this._cacheId());
            if (!raw) return null;
            const { ts, rows } = JSON.parse(raw);
            if (Date.now() - ts > CACHE_TTL) return null;
            return { rows };
        } catch { return null; }
    }

    _saveCache(data) {
        try { localStorage.setItem(this._cacheId(), JSON.stringify({ ts: Date.now(), ...data })); } catch {}
    }

    _cacheAge() {
        try {
            const raw = localStorage.getItem(this._cacheId());
            if (!raw) return null;
            const { ts } = JSON.parse(raw);
            const s = Math.round((Date.now() - ts) / 1000);
            return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
        } catch { return null; }
    }

    // ── Analytics ─────────────────────────────────────────────────────────────

    _computeStats() {
        const now       = new Date();
        const todayStr  = now.toISOString().slice(0, 10);
        const weekAgo   = new Date(now - 7  * 86400_000).toISOString().slice(0, 10);
        const monthAgo  = new Date(now - 30 * 86400_000).toISOString().slice(0, 10);

        let today = 0, week = 0, month = 0, allTime = 0;
        let todayReqs = 0, weekReqs = 0;

        // Per-model totals
        const byModel = {};
        // Per-date totals (for line chart)
        const byDate  = {};
        // Per-key-hash totals (if available)
        const byKey   = {};

        for (const r of this._rows) {
            const cost = typeof r.usage === 'number' ? r.usage : 0;
            const reqs = r.requests ?? 1;
            const date = (r.date ?? '').slice(0, 10);
            const model = r.model ?? r.model_permaslug ?? '—';
            const keyHash = r.api_key_hash ?? null;

            allTime += cost;

            if (date === todayStr)    { today += cost; todayReqs += reqs; }
            if (date >= weekAgo)      { week  += cost; weekReqs  += reqs; }
            if (date >= monthAgo)      month  += cost;

            // By model
            if (!byModel[model]) byModel[model] = { cost: 0, reqs: 0 };
            byModel[model].cost += cost;
            byModel[model].reqs += reqs;

            // By date
            if (!byDate[date]) byDate[date] = 0;
            byDate[date] += cost;

            // By key hash
            if (keyHash) {
                if (!byKey[keyHash]) byKey[keyHash] = { cost: 0, reqs: 0, today: 0 };
                byKey[keyHash].cost += cost;
                byKey[keyHash].reqs += reqs;
                if (date === todayStr) byKey[keyHash].today += cost;
            }
        }

        // Sort models by cost
        const topModels = Object.entries(byModel)
            .sort((a, b) => b[1].cost - a[1].cost)
            .slice(0, 12);

        // Build 30-day date series
        const days = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now - i * 86400_000).toISOString().slice(0, 10);
            days.push({ date: d, cost: byDate[d] ?? 0 });
        }

        return { today, week, month, allTime, todayReqs, weekReqs, topModels, days, byKey };
    }

    // ── Render ────────────────────────────────────────────────────────────────

    _renderShell() {
        this._shadow.innerHTML = `<style>${CSS}</style>
<div class="os-toolbar">
  <span class="os-title">Spending Analytics</span>
  <span class="os-progress" id="progress"></span>
  <span class="os-age" id="age"></span>
  <button class="os-btn" id="refresh-btn" title="Bypass cache and re-fetch all data">↻</button>
</div>
<div id="content" class="os-empty">Connect admin key to view spending analytics</div>`;
        this._shadow.getElementById('refresh-btn').addEventListener('click', () => this._fetchAll(true));
    }

    _renderDashboard() {
        const age = this._cacheAge();
        const ageEl = this._shadow.getElementById('age');
        if (ageEl) ageEl.textContent = age ? `cached ${age}` : '';

        if (!this._rows.length) { this._showEmpty('No activity data available'); return; }

        const stats = this._computeStats();
        const el = this._shadow.getElementById('content');
        if (!el) return;
        el.className = 'os-body';
        el.innerHTML = '';

        // ── Summary cards ─────────────────────────────────────────────────────
        const cardsDiv = document.createElement('div');
        cardsDiv.innerHTML = `<div class="os-section">Summary</div>`;
        const grid = document.createElement('div');
        grid.className = 'os-cards';
        grid.innerHTML = `
<div class="os-card today">
  <div class="os-card-label">Today</div>
  <div class="os-card-value">$${stats.today.toFixed(4)}</div>
  <div class="os-card-sub">${stats.todayReqs} request${stats.todayReqs !== 1 ? 's' : ''}</div>
</div>
<div class="os-card week">
  <div class="os-card-label">Last 7 days</div>
  <div class="os-card-value">$${stats.week.toFixed(4)}</div>
  <div class="os-card-sub">${stats.weekReqs} requests</div>
</div>
<div class="os-card">
  <div class="os-card-label">Last 30 days</div>
  <div class="os-card-value">$${stats.month.toFixed(4)}</div>
  <div class="os-card-sub">&nbsp;</div>
</div>
<div class="os-card">
  <div class="os-card-label">All time</div>
  <div class="os-card-value">$${stats.allTime.toFixed(4)}</div>
  <div class="os-card-sub">${this._rows.length} rows loaded</div>
</div>`;
        cardsDiv.appendChild(grid);
        el.appendChild(cardsDiv);

        // ── Daily line chart ──────────────────────────────────────────────────
        el.appendChild(this._buildLineChart(stats.days));

        // ── Top models bar chart ──────────────────────────────────────────────
        el.appendChild(this._buildBarChart(stats.topModels, 'Cost by model'));

        // ── Per-key table ─────────────────────────────────────────────────────
        if (Object.keys(stats.byKey).length) {
            el.appendChild(this._buildKeyTable(stats.byKey));
        }
    }

    _buildLineChart(days) {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div class="os-section">Daily spend — last 30 days</div>`;

        const W = 380, H = 80, PAD = { l: 40, r: 8, t: 8, b: 20 };
        const maxCost = Math.max(...days.map(d => d.cost), 0.0001);
        const iW = W - PAD.l - PAD.r;
        const iH = H - PAD.t - PAD.b;
        const xs = days.map((_, i) => PAD.l + (i / (days.length - 1)) * iW);
        const ys = days.map(d => PAD.t + iH - (d.cost / maxCost) * iH);

        const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');

        // X-axis: show every 7th label
        const xLabels = days.filter((_, i) => i % 7 === 0 || i === days.length - 1).map((d, _, arr) => {
            const idx = days.indexOf(d);
            return `<text x="${xs[idx].toFixed(1)}" y="${H - 4}" font-size="8" fill="#374151" text-anchor="middle">${d.date.slice(5)}</text>`;
        }).join('');

        // Y-axis labels
        const yTop    = `$${maxCost.toFixed(3)}`;
        const yMiddle = `$${(maxCost / 2).toFixed(3)}`;

        // Highlight today's point
        const todayIdx = days.length - 1;
        const todayDot = days[todayIdx].cost > 0
            ? `<circle cx="${xs[todayIdx].toFixed(1)}" cy="${ys[todayIdx].toFixed(1)}" r="3" fill="#4ade80"/>`
            : '';

        const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">
  <!-- Grid lines -->
  <line x1="${PAD.l}" y1="${PAD.t}" x2="${W - PAD.r}" y2="${PAD.t}" stroke="#1e2035" stroke-width="0.5"/>
  <line x1="${PAD.l}" y1="${PAD.t + iH / 2}" x2="${W - PAD.r}" y2="${PAD.t + iH / 2}" stroke="#1e2035" stroke-width="0.5" stroke-dasharray="2,2"/>
  <line x1="${PAD.l}" y1="${PAD.t + iH}" x2="${W - PAD.r}" y2="${PAD.t + iH}" stroke="#1e2035" stroke-width="0.5"/>
  <!-- Y labels -->
  <text x="${PAD.l - 3}" y="${PAD.t + 4}" font-size="8" fill="#374151" text-anchor="end">${yTop}</text>
  <text x="${PAD.l - 3}" y="${PAD.t + iH / 2 + 3}" font-size="8" fill="#374151" text-anchor="end">${yMiddle}</text>
  <!-- Fill area -->
  <polygon points="${xs[0].toFixed(1)},${(PAD.t + iH).toFixed(1)} ${points} ${xs[days.length-1].toFixed(1)},${(PAD.t + iH).toFixed(1)}" fill="#0d1a3d" opacity="0.8"/>
  <!-- Line -->
  <polyline points="${points}" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${todayDot}
  <!-- X labels -->
  ${xLabels}
</svg>`;

        const container = document.createElement('div');
        container.className = 'os-chart-wrap';
        container.innerHTML = svg;
        wrap.appendChild(container);
        return wrap;
    }

    _buildBarChart(topModels, title) {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div class="os-section">${_esc(title)}</div>`;
        if (!topModels.length) {
            wrap.innerHTML += '<div style="color:#374151;font-size:11px">No data</div>';
            return wrap;
        }

        const maxCost = topModels[0][1].cost || 0.0001;
        const bars = topModels.map(([model, stats]) => {
            const name  = model.includes('/') ? model.split('/').pop() : model;
            const pct   = Math.max(2, (stats.cost / maxCost) * 100).toFixed(1);
            const label = name.length > 22 ? name.slice(0, 20) + '..' : name;
            return `<div class="os-bar-row">
  <span class="os-bar-name" title="${_esc(model)}">${_esc(label)}</span>
  <div class="os-bar-track"><div class="os-bar-fill" style="width:${pct}%"></div></div>
  <span class="os-bar-val">$${stats.cost.toFixed(4)}</span>
</div>`;
        }).join('');

        const chart = document.createElement('div');
        chart.className = 'os-bar-chart';
        chart.innerHTML = bars;
        wrap.appendChild(chart);
        return wrap;
    }

    _buildKeyTable(byKey) {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div class="os-section">Per-key breakdown</div>`;

        // Enrich with labels from this._keys
        const keyLabel = {};
        for (const k of this._keys) { if (k.hash) keyLabel[k.hash] = k.label || k.name || k.hash.slice(0, 8); }

        const sorted = Object.entries(byKey).sort((a, b) => b[1].cost - a[1].cost);
        const rows = sorted.map(([hash, s]) => {
            const label = keyLabel[hash] ?? hash.slice(0, 12) + '…';
            return `<tr>
  <td><span class="v-key-name" title="${_esc(hash)}">${_esc(label)}</span></td>
  <td><span class="v-cost">$${s.cost.toFixed(4)}</span></td>
  <td><span class="v-today">$${s.today.toFixed(4)}</span></td>
  <td><span class="v-reqs">${s.reqs}</span></td>
</tr>`;
        }).join('');

        wrap.innerHTML += `<table class="os-key-table">
<thead><tr><th>Key</th><th>Total</th><th>Today</th><th>Reqs</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
        return wrap;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _showEmpty(msg) {
        const el = this._shadow.getElementById('content');
        if (el) { el.className = 'os-empty'; el.textContent = msg; }
    }

    _setRefreshing(on) {
        const btn = this._shadow.getElementById('refresh-btn');
        if (!btn) return;
        btn.disabled = on;
        btn.innerHTML = on ? '<span class="os-spinner"></span>' : '↻';
    }

    _setStatus(msg) {
        const el = this._shadow.getElementById('progress');
        if (el) el.textContent = msg;
    }
}

function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

customElements.define('sg-openrouter-spending', SgOpenrouterSpending);
