/**
 * sg-vfs-event-viewer — Real-time viewer for VFS bus events.
 *
 * Four tabs:
 *   Timeline  — chronological event log (all vfs:* events)
 *   Operations — grouped by requestId: latency, status, path
 *   Providers  — per-provider hit/miss counts, write counts
 *   Latency   — min/avg/max/p95 per operation type
 *
 * Bus events consumed: all vfs:* events on [data-vfs-bus] ancestor.
 *
 * @module sg-vfs-event-viewer
 * @version 0.1.0
 */

import { SGL_VFS } from '/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-events.js';

const MAX_EVENTS = 500;

// ── Helpers ──────────────────────────────────────────────────────────────────

const ALL_VFS_EVENTS = Object.values(SGL_VFS);

const EVENT_COLORS = {
    request:   { bg: 'rgba(78,205,196,0.08)',  border: '#4ecdc4', text: '#4ecdc4'  },
    response:  { bg: 'rgba(110,231,183,0.08)', border: '#6ee7b7', text: '#6ee7b7'  },
    error:     { bg: 'rgba(233,69,96,0.12)',   border: '#e94560', text: '#e94560'  },
    lifecycle: { bg: 'rgba(167,139,250,0.08)', border: '#a78bfa', text: '#a78bfa'  },
    batch:     { bg: 'rgba(251,191,36,0.08)',  border: '#fbbf24', text: '#fbbf24'  },
    queue:     { bg: 'rgba(59,130,246,0.08)',  border: '#3b82f6', text: '#3b82f6'  },
};

const ICONS = { request: '→', response: '←', error: '✕', lifecycle: '●', batch: '⚡', queue: '⏳' };

function categoryFor(name) {
    if (name.includes('-request'))    return 'request';
    if (name.includes('-response'))   return 'response';
    if (name === SGL_VFS.ERROR)       return 'error';
    if (name.startsWith('vfs:batch')) return 'batch';
    if (name.includes('drain') || name.includes('queue') || name.includes('commit')) return 'queue';
    return 'lifecycle';
}

// Extract the "operation" from a request/response event name
// e.g. 'vfs:read-request' → 'read', 'vfs:write-response' → 'write'
function opType(name) {
    return name.replace('vfs:', '').replace('-request', '').replace('-response', '');
}

// ── Component ─────────────────────────────────────────────────────────────────

export class SgVfsEventViewer extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // Timeline
        this._events   = [];
        this._paused   = false;
        this._expanded = null;

        // Operations: Map<requestId, { op, path, requestTime, responseTime?, wallTime?, status }>
        this._ops = new Map();

        // Providers: Map<providerName, { hits, misses, writes, errors }>
        this._providers = new Map();

        // Latency: Map<opName, number[]> (wallTime values)
        this._latencies = new Map();

        // Active tab
        this._tab = 'timeline';
    }

    connectedCallback() {
        this._render();
        this._bindBus();
    }

    disconnectedCallback() {
        this._unbindBus();
    }

    // ── Render shell ──────────────────────────────────────────────────────

    _render() {
        this.shadowRoot.innerHTML = `
<style>
  :host { display: flex; flex-direction: column; height: 100%; font-family: inherit; min-height: 0; }

  /* ── Tab bar ──────────────────────────────────────────────────────────── */
  .tab-bar {
      display: flex; align-items: stretch; gap: 0;
      border-bottom: 1px solid var(--sg-border, #2a3a5c);
      background: var(--sg-bg-secondary, #16213e);
      flex-shrink: 0;
      padding: 0 0.4rem;
  }
  .tab {
      font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--sg-text-muted, #8892b0);
      padding: 0.45rem 0.65rem; cursor: pointer; border: none;
      background: transparent; border-bottom: 2px solid transparent;
      line-height: 1; transition: color 0.15s, border-color 0.15s;
      margin-bottom: -1px;
  }
  .tab:hover  { color: var(--sg-text, #ccd6f6); }
  .tab.active { color: var(--sg-accent, #4ecdc4); border-bottom-color: var(--sg-accent, #4ecdc4); }
  .tab-spacer { flex: 1; }
  .tab-badge {
      font-size: 0.6rem; font-weight: 700;
      background: var(--sg-accent, #4ecdc4); color: #0d1b2a;
      border-radius: 9999px; padding: 0.08rem 0.38rem; margin-left: 0.3rem;
      vertical-align: middle;
  }
  .tab-actions { display: flex; align-items: center; gap: 0.3rem; padding: 0.3rem 0; }
  .tab-btn {
      font-size: 0.62rem; padding: 0.18rem 0.45rem;
      border-radius: 4px; border: 1px solid var(--sg-border, #2a3a5c);
      background: transparent; color: var(--sg-text-muted, #8892b0);
      cursor: pointer; line-height: 1.4;
  }
  .tab-btn:hover { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }
  .tab-btn.active { border-color: #fbbf24; color: #fbbf24; background: rgba(251,191,36,0.08); }

  /* ── Panel container ──────────────────────────────────────────────────── */
  .panel { flex: 1; min-height: 0; display: none; overflow-y: auto; }
  .panel.active { display: flex; flex-direction: column; }

  /* ── Timeline ─────────────────────────────────────────────────────────── */
  .ev-row {
      display: flex; align-items: flex-start; gap: 0.4rem;
      padding: 0.22rem 0.6rem;
      border-bottom: 1px solid rgba(42,58,92,0.4);
      cursor: pointer; line-height: 1.5;
      font-size: 0.71rem; font-family: 'Fira Mono', monospace;
  }
  .ev-row:hover { filter: brightness(1.15); }
  .ev-icon { flex-shrink: 0; width: 1rem; text-align: center; font-size: 0.68rem; margin-top: 0.15rem; }
  .ev-time { flex-shrink: 0; color: var(--sg-text-muted, #8892b0); font-size: 0.63rem; margin-top: 0.16rem; min-width: 3.5rem; }
  .ev-name { flex: 1; word-break: break-all; }
  .ev-sub  { color: var(--sg-text-muted, #8892b0); font-size: 0.63rem; }
  .ev-rid  { flex-shrink: 0; color: var(--sg-text-muted, #8892b0); font-size: 0.61rem; margin-top: 0.16rem; }
  .ev-wall { flex-shrink: 0; font-size: 0.61rem; margin-top: 0.16rem; min-width: 3rem; text-align: right; }
  .ev-detail {
      padding: 0.4rem 0.6rem 0.4rem 2.4rem;
      background: rgba(13,27,42,0.6);
      font-size: 0.67rem; color: var(--sg-text-muted, #8892b0);
      white-space: pre-wrap; word-break: break-all;
      border-bottom: 1px solid rgba(42,58,92,0.6);
      font-family: monospace;
  }
  .ev-empty { padding: 1.5rem; text-align: center; color: var(--sg-text-muted, #8892b0); font-size: 0.75rem; }

  /* ── Operations tab ───────────────────────────────────────────────────── */
  .ops-table { width: 100%; border-collapse: collapse; font-size: 0.71rem; font-family: monospace; }
  .ops-table th {
      font-size: 0.62rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--sg-text-muted, #8892b0);
      padding: 0.35rem 0.7rem; text-align: left;
      border-bottom: 1px solid var(--sg-border, #2a3a5c);
      background: var(--sg-bg-secondary, #16213e); position: sticky; top: 0;
  }
  .ops-table td {
      padding: 0.3rem 0.7rem;
      border-bottom: 1px solid rgba(42,58,92,0.35);
      color: var(--sg-text, #ccd6f6);
      vertical-align: middle;
  }
  .ops-table tr:hover td { background: rgba(78,205,196,0.04); }
  .status-ok    { color: #6ee7b7; }
  .status-err   { color: #e94560; }
  .status-pend  { color: #fbbf24; }

  /* ── Providers tab ────────────────────────────────────────────────────── */
  .prov-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
      gap: 0.75rem; padding: 0.75rem;
  }
  .prov-card {
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: 8px;
      padding: 0.65rem 0.8rem;
      background: var(--sg-bg-secondary, #16213e);
  }
  .prov-name {
      font-size: 0.72rem; font-weight: 700; color: var(--sg-accent, #4ecdc4);
      text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.5rem;
  }
  .prov-stat { display: flex; justify-content: space-between; font-size: 0.7rem; margin-bottom: 0.22rem; }
  .prov-stat-label { color: var(--sg-text-muted, #8892b0); }
  .prov-stat-val   { font-family: monospace; font-weight: 600; color: var(--sg-text, #ccd6f6); }
  .prov-bar { height: 4px; border-radius: 2px; background: rgba(42,58,92,0.8); margin-top: 0.45rem; overflow: hidden; }
  .prov-bar-fill { height: 100%; background: var(--sg-accent, #4ecdc4); transition: width 0.3s; }
  .no-data { padding: 1.5rem; text-align: center; color: var(--sg-text-muted, #8892b0); font-size: 0.75rem; }

  /* ── Latency tab ──────────────────────────────────────────────────────── */
  .lat-table { width: 100%; border-collapse: collapse; font-size: 0.71rem; font-family: monospace; }
  .lat-table th {
      font-size: 0.62rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--sg-text-muted, #8892b0);
      padding: 0.35rem 0.7rem; text-align: left;
      border-bottom: 1px solid var(--sg-border, #2a3a5c);
      background: var(--sg-bg-secondary, #16213e); position: sticky; top: 0;
  }
  .lat-table td { padding: 0.3rem 0.7rem; border-bottom: 1px solid rgba(42,58,92,0.35); color: var(--sg-text, #ccd6f6); }
  .lat-table tr:hover td { background: rgba(78,205,196,0.04); }
  .lat-bar-cell { width: 8rem; }
  .lat-bar { height: 6px; border-radius: 3px; background: rgba(42,58,92,0.8); overflow: hidden; }
  .lat-bar-fill { height: 100%; background: linear-gradient(90deg, #4ecdc4, #a78bfa); transition: width 0.3s; }
</style>

<!-- Tab bar -->
<div class="tab-bar">
  <button class="tab active" data-tab="timeline">Timeline<span class="tab-badge" id="badge">0</span></button>
  <button class="tab" data-tab="ops">Operations</button>
  <button class="tab" data-tab="providers">Providers</button>
  <button class="tab" data-tab="latency">Latency</button>
  <span class="tab-spacer"></span>
  <div class="tab-actions">
    <button class="tab-btn" id="btn-pause">Pause</button>
    <button class="tab-btn" id="btn-clear">Clear</button>
  </div>
</div>

<!-- Timeline panel -->
<div class="panel active" id="panel-timeline" data-panel="timeline">
  <div class="ev-empty" id="empty">Waiting for VFS events…</div>
</div>

<!-- Operations panel -->
<div class="panel" id="panel-ops" data-panel="ops">
  <div class="no-data" id="ops-empty">No operations yet.</div>
  <table class="ops-table" id="ops-table" style="display:none">
    <thead><tr>
      <th>Op</th><th>Path</th><th>Status</th><th>Wall</th><th>Request ID</th>
    </tr></thead>
    <tbody id="ops-tbody"></tbody>
  </table>
</div>

<!-- Providers panel -->
<div class="panel" id="panel-providers" data-panel="providers">
  <div class="prov-grid" id="prov-grid">
    <div class="no-data">No provider events yet.</div>
  </div>
</div>

<!-- Latency panel -->
<div class="panel" id="panel-latency" data-panel="latency">
  <div class="no-data" id="lat-empty">No completed operations yet.</div>
  <table class="lat-table" id="lat-table" style="display:none">
    <thead><tr>
      <th>Operation</th><th>Count</th><th>Min</th><th>Avg</th><th>P95</th><th>Max</th><th style="width:8rem"></th>
    </tr></thead>
    <tbody id="lat-tbody"></tbody>
  </table>
</div>
`;
        // Tab switching
        this.shadowRoot.querySelectorAll('.tab[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => this._switchTab(btn.dataset.tab));
        });

        // Timeline list hover-pause
        const tl = this.shadowRoot.getElementById('panel-timeline');
        tl.addEventListener('mouseenter', () => { this._paused = true;  this._updatePauseBtn(); });
        tl.addEventListener('mouseleave', () => { this._paused = false; this._updatePauseBtn(); });

        this.shadowRoot.getElementById('btn-pause').addEventListener('click', () => {
            this._paused = !this._paused;
            this._updatePauseBtn();
        });

        this.shadowRoot.getElementById('btn-clear').addEventListener('click', () => {
            this._events = [];
            this._ops.clear();
            this._providers.clear();
            this._latencies.clear();
            this._expanded = null;
            this._refreshAll();
        });
    }

    _switchTab(tab) {
        this._tab = tab;
        this.shadowRoot.querySelectorAll('.tab[data-tab]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        this.shadowRoot.querySelectorAll('.panel').forEach(p => {
            p.classList.toggle('active', p.dataset.panel === tab);
        });
        if (tab === 'ops')       this._refreshOps();
        if (tab === 'providers') this._refreshProviders();
        if (tab === 'latency')   this._refreshLatency();
    }

    _updatePauseBtn() {
        const btn = this.shadowRoot.getElementById('btn-pause');
        if (!btn) return;
        btn.textContent = this._paused ? 'Resume' : 'Pause';
        btn.classList.toggle('active', this._paused);
    }

    // ── Bus ───────────────────────────────────────────────────────────────

    _busEl() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-vfs-bus')) return el;
            el = el.parentElement;
        }
        return document;
    }

    _bindBus() {
        this._handler = (e) => this._onEvent(e);
        this._bus = this._busEl();
        for (const name of ALL_VFS_EVENTS) {
            this._bus.addEventListener(name, this._handler);
        }
    }

    _unbindBus() {
        if (!this._bus) return;
        for (const name of ALL_VFS_EVENTS) {
            this._bus.removeEventListener(name, this._handler);
        }
    }

    // ── Event ingestion ───────────────────────────────────────────────────

    _onEvent(e) {
        const ev = { eventName: e.type, detail: e.detail || {}, time: Date.now() };

        // ── Timeline ──
        if (this._events.length >= MAX_EVENTS) {
            this._events.shift();
            if (this._expanded !== null) this._expanded = Math.max(0, this._expanded - 1);
        }
        this._events.push(ev);

        // ── Operations tracking ──
        this._trackOp(e.type, e.detail || {});

        // ── Provider tracking ──
        this._trackProvider(e.type, e.detail || {});

        // ── Latency tracking ──
        this._trackLatency(e.type, e.detail || {});

        // ── Render into active panel ──
        if (this._tab === 'timeline') this._appendTimelineRow(this._events.length - 1);
        if (this._tab === 'ops')       this._refreshOps();
        if (this._tab === 'providers') this._refreshProviders();
        if (this._tab === 'latency')   this._refreshLatency();

        this.shadowRoot.getElementById('badge').textContent = this._events.length;
    }

    _trackOp(eventName, detail) {
        const rid = detail.requestId;
        if (!rid) return;
        if (eventName.includes('-request')) {
            this._ops.set(rid, {
                op:          opType(eventName),
                path:        detail.path || detail.src || '',
                requestTime: detail.timestamp || Date.now(),
                status:      'pending',
                wallTime:    null,
            });
        } else if (eventName.includes('-response')) {
            const op = this._ops.get(rid);
            if (op) { op.status = 'ok'; op.wallTime = detail.wallTime ?? null; }
        } else if (eventName === SGL_VFS.ERROR) {
            const op = this._ops.get(rid);
            if (op) { op.status = 'error'; op.wallTime = detail.wallTime ?? null; op.error = detail.error; }
        }
    }

    _trackProvider(eventName, detail) {
        const pname = detail.provider;
        if (!pname) return;
        if (!this._providers.has(pname)) {
            this._providers.set(pname, { hits: 0, misses: 0, writes: 0, errors: 0, ready: false });
        }
        const p = this._providers.get(pname);
        if (eventName === SGL_VFS.PROVIDER_HIT)   p.hits++;
        if (eventName === SGL_VFS.PROVIDER_MISS)  p.misses++;
        if (eventName === SGL_VFS.WRITE_RESPONSE) p.writes++;
        if (eventName === SGL_VFS.PROVIDER_ERROR) p.errors++;
        if (eventName === SGL_VFS.PROVIDER_READY) p.ready = true;
        if (eventName === SGL_VFS.PROVIDER_REGISTERED && !this._providers.has(pname)) {
            this._providers.set(pname, { hits: 0, misses: 0, writes: 0, errors: 0, ready: false });
        }
    }

    _trackLatency(eventName, detail) {
        if (!eventName.includes('-response') && eventName !== SGL_VFS.ERROR) return;
        if (detail.wallTime == null) return;
        const op = opType(eventName);
        if (!this._latencies.has(op)) this._latencies.set(op, []);
        this._latencies.get(op).push(detail.wallTime);
    }

    // ── Timeline rendering ────────────────────────────────────────────────

    _refreshAll() {
        // Clear timeline
        const tl = this.shadowRoot.getElementById('panel-timeline');
        tl.innerHTML = '<div class="ev-empty" id="empty">Waiting for VFS events…</div>';
        for (let i = 0; i < this._events.length; i++) this._appendTimelineRow(i);
        this.shadowRoot.getElementById('badge').textContent = this._events.length;
        if (this._tab === 'ops')       this._refreshOps();
        if (this._tab === 'providers') this._refreshProviders();
        if (this._tab === 'latency')   this._refreshLatency();
    }

    _appendTimelineRow(idx) {
        const { eventName, detail, time } = this._events[idx];
        const cat   = categoryFor(eventName);
        const color = EVENT_COLORS[cat] || EVENT_COLORS.lifecycle;
        const tl    = this.shadowRoot.getElementById('panel-timeline');

        const empty = tl.querySelector('#empty');
        if (empty) empty.remove();

        const row = document.createElement('div');
        row.className = 'ev-row';
        row.dataset.idx = String(idx);
        row.style.cssText = `background:${color.bg}; border-left: 3px solid ${color.border};`;

        const shortName = eventName.replace('vfs:', '');
        const wallMs    = detail.wallTime != null ? `${detail.wallTime}ms` : '';
        const rid       = detail.requestId ? detail.requestId.replace('vfs-', '') : '';
        const path      = detail.path || detail.src || '';
        const timeStr   = new Date(time).toISOString().slice(11, 23);

        row.innerHTML = `
<span class="ev-icon" style="color:${color.text}">${ICONS[cat]}</span>
<span class="ev-time">${timeStr}</span>
<span class="ev-name" style="color:${color.text}">${shortName}${path ? `<br><span class="ev-sub">${path}</span>` : ''}</span>
<span class="ev-rid">${rid}</span>
<span class="ev-wall" style="color:${color.text}">${wallMs}</span>`;

        row.addEventListener('click', () => this._toggleDetail(idx));
        tl.appendChild(row);

        if (!this._paused) row.scrollIntoView({ block: 'nearest' });
    }

    _toggleDetail(idx) {
        const tl = this.shadowRoot.getElementById('panel-timeline');
        const existing = tl.querySelector('.ev-detail');
        if (existing) existing.remove();
        if (this._expanded === idx) { this._expanded = null; return; }
        this._expanded = idx;

        const { detail } = this._events[idx];
        const panel = document.createElement('div');
        panel.className = 'ev-detail';
        const d = { ...detail }; delete d._handled;
        panel.textContent = JSON.stringify(d, null, 2);

        const rows = tl.querySelectorAll('.ev-row');
        const target = [...rows].find(r => Number(r.dataset.idx) === idx);
        if (target && target.nextSibling) tl.insertBefore(panel, target.nextSibling);
        else tl.appendChild(panel);
        panel.scrollIntoView({ block: 'nearest' });
    }

    // ── Operations tab rendering ──────────────────────────────────────────

    _refreshOps() {
        const tbody = this.shadowRoot.getElementById('ops-tbody');
        const table = this.shadowRoot.getElementById('ops-table');
        const empty = this.shadowRoot.getElementById('ops-empty');
        if (this._ops.size === 0) {
            if (empty)  empty.style.display = '';
            if (table) table.style.display  = 'none';
            return;
        }
        if (empty)  empty.style.display = 'none';
        if (table) table.style.display  = '';

        // Most recent first
        const rows = [...this._ops.entries()].reverse();
        tbody.innerHTML = rows.slice(0, 200).map(([rid, op]) => {
            const cls  = op.status === 'ok' ? 'status-ok' : op.status === 'error' ? 'status-err' : 'status-pend';
            const wall = op.wallTime != null ? `${op.wallTime}ms` : '…';
            const path = (op.path || '').slice(0, 40);
            return `<tr>
  <td>${op.op}</td>
  <td title="${op.path}">${path}</td>
  <td class="${cls}">${op.status}</td>
  <td>${wall}</td>
  <td style="font-size:0.62rem;color:var(--sg-text-muted,#8892b0)">${rid.replace('vfs-','')}</td>
</tr>`;
        }).join('');
    }

    // ── Providers tab rendering ───────────────────────────────────────────

    _refreshProviders() {
        const grid = this.shadowRoot.getElementById('prov-grid');
        if (this._providers.size === 0) {
            grid.innerHTML = '<div class="no-data">No provider events yet.</div>';
            return;
        }
        grid.innerHTML = [...this._providers.entries()].map(([name, p]) => {
            const total    = p.hits + p.misses;
            const hitPct   = total ? Math.round((p.hits / total) * 100) : 0;
            const statusDot = p.ready ? '#6ee7b7' : '#fbbf24';
            return `<div class="prov-card">
  <div class="prov-name">
    <span style="color:${statusDot};margin-right:0.35rem">●</span>${name}
  </div>
  <div class="prov-stat"><span class="prov-stat-label">Hits</span><span class="prov-stat-val" style="color:#6ee7b7">${p.hits}</span></div>
  <div class="prov-stat"><span class="prov-stat-label">Misses</span><span class="prov-stat-val" style="color:#fbbf24">${p.misses}</span></div>
  <div class="prov-stat"><span class="prov-stat-label">Writes</span><span class="prov-stat-val">${p.writes}</span></div>
  <div class="prov-stat"><span class="prov-stat-label">Errors</span><span class="prov-stat-val" style="color:${p.errors ? '#e94560' : 'inherit'}">${p.errors}</span></div>
  <div class="prov-stat"><span class="prov-stat-label">Hit rate</span><span class="prov-stat-val">${total ? hitPct + '%' : '—'}</span></div>
  <div class="prov-bar"><div class="prov-bar-fill" style="width:${hitPct}%"></div></div>
</div>`;
        }).join('');
    }

    // ── Latency tab rendering ─────────────────────────────────────────────

    _refreshLatency() {
        const tbody = this.shadowRoot.getElementById('lat-tbody');
        const table = this.shadowRoot.getElementById('lat-table');
        const empty = this.shadowRoot.getElementById('lat-empty');
        if (this._latencies.size === 0) {
            if (empty) empty.style.display = '';
            if (table) table.style.display = 'none';
            return;
        }
        if (empty) empty.style.display = 'none';
        if (table) table.style.display = '';

        // Find global max for bar scaling
        let globalMax = 1;
        for (const vals of this._latencies.values()) {
            const m = Math.max(...vals);
            if (m > globalMax) globalMax = m;
        }

        const rows = [...this._latencies.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        tbody.innerHTML = rows.map(([op, vals]) => {
            const sorted = [...vals].sort((a, b) => a - b);
            const min    = sorted[0];
            const max    = sorted[sorted.length - 1];
            const avg    = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
            const p95idx = Math.floor(sorted.length * 0.95);
            const p95    = sorted[Math.min(p95idx, sorted.length - 1)];
            const barPct = Math.round((avg / globalMax) * 100);
            return `<tr>
  <td>${op}</td>
  <td>${vals.length}</td>
  <td>${min}ms</td>
  <td>${avg}ms</td>
  <td>${p95}ms</td>
  <td>${max}ms</td>
  <td class="lat-bar-cell"><div class="lat-bar"><div class="lat-bar-fill" style="width:${barPct}%"></div></div></td>
</tr>`;
        }).join('');
    }
}

customElements.define('sg-vfs-event-viewer', SgVfsEventViewer);
