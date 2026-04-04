/**
 * sg-vfs-event-viewer — Real-time viewer for VFS bus events.
 *
 * Subscribes to every vfs:* event on the nearest [data-vfs-bus] ancestor
 * and displays them in a scrolling timeline. Phase 1 ships with the
 * Timeline tab only; additional tabs (Operations, Providers, Latency)
 * are planned for Phase 2.
 *
 * Features:
 *   - Colour-coded event rows (request / response / error / lifecycle)
 *   - Auto-scroll with pause-on-hover
 *   - Max 500 events retained (circular buffer)
 *   - Clear button
 *   - Event count badge
 *   - Click a row to expand full detail as JSON
 *
 * Bus events consumed: all vfs:* events
 *
 * @module sg-vfs-event-viewer
 * @version 0.1.0
 */

import { SGL_VFS } from '/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-events.js';

const MAX_EVENTS = 500;

// ── Colour categories ────────────────────────────────────────────────────

const EVENT_COLORS = {
    request:   { bg: 'rgba(78,205,196,0.08)',  border: '#4ecdc4', text: '#4ecdc4'  },
    response:  { bg: 'rgba(110,231,183,0.08)', border: '#6ee7b7', text: '#6ee7b7'  },
    error:     { bg: 'rgba(233,69,96,0.12)',   border: '#e94560', text: '#e94560'  },
    lifecycle: { bg: 'rgba(167,139,250,0.08)', border: '#a78bfa', text: '#a78bfa'  },
    batch:     { bg: 'rgba(251,191,36,0.08)',  border: '#fbbf24', text: '#fbbf24'  },
    queue:     { bg: 'rgba(59,130,246,0.08)',  border: '#3b82f6', text: '#3b82f6'  },
};

function categoryFor(eventName) {
    if (eventName.includes('-request'))   return 'request';
    if (eventName.includes('-response'))  return 'response';
    if (eventName === SGL_VFS.ERROR)      return 'error';
    if (eventName.startsWith('vfs:batch')) return 'batch';
    if (eventName.includes('drain') || eventName.includes('queue') || eventName.includes('commit')) return 'queue';
    return 'lifecycle';
}

// ── Icons (simple SVG) ───────────────────────────────────────────────────

const ICONS = {
    request:   '→',
    response:  '←',
    error:     '✕',
    lifecycle: '●',
    batch:     '⚡',
    queue:     '⏳',
};

// ── All vfs:* event names to subscribe to ────────────────────────────────

const ALL_VFS_EVENTS = Object.values(SGL_VFS);

export class SgVfsEventViewer extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        /** @type {Array<{eventName:string, detail:object, time:number}>} */
        this._events  = [];
        this._paused  = false;
        this._expanded = null; // index of expanded row
    }

    connectedCallback() {
        this._render();
        this._bindBus();
    }

    disconnectedCallback() {
        this._unbindBus();
    }

    // ── Render ───────────────────────────────────────────────────────────

    _render() {
        this.shadowRoot.innerHTML = `
<style>
  :host { display: flex; flex-direction: column; height: 100%; font-family: inherit; min-height: 0; }
  .ev-header {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid var(--sg-border, #2a3a5c);
      background: var(--sg-bg-secondary, #16213e);
      flex-shrink: 0;
  }
  .ev-title {
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--sg-text-muted, #8892b0);
      flex: 1;
  }
  .ev-badge {
      font-size: 0.65rem; font-weight: 700;
      background: var(--sg-accent, #4ecdc4); color: #0d1b2a;
      border-radius: 9999px; padding: 0.1rem 0.45rem;
      min-width: 1.4rem; text-align: center;
  }
  .ev-pause-btn, .ev-clear-btn {
      font-size: 0.65rem; padding: 0.18rem 0.5rem;
      border-radius: 4px; border: 1px solid var(--sg-border, #2a3a5c);
      background: transparent; color: var(--sg-text-muted, #8892b0);
      cursor: pointer; line-height: 1.4;
  }
  .ev-pause-btn:hover, .ev-clear-btn:hover {
      border-color: var(--sg-accent, #4ecdc4);
      color: var(--sg-accent, #4ecdc4);
  }
  .ev-pause-btn.active {
      border-color: #fbbf24; color: #fbbf24;
      background: rgba(251,191,36,0.08);
  }
  .ev-list {
      flex: 1; overflow-y: auto; min-height: 0;
      font-size: 0.72rem; font-family: 'Fira Mono', 'Cascadia Code', monospace;
  }
  .ev-row {
      display: flex; align-items: flex-start; gap: 0.4rem;
      padding: 0.25rem 0.6rem;
      border-bottom: 1px solid rgba(42,58,92,0.4);
      cursor: pointer; transition: background 0.1s;
      line-height: 1.5;
  }
  .ev-row:hover { filter: brightness(1.15); }
  .ev-icon { flex-shrink: 0; width: 1rem; text-align: center; font-size: 0.7rem; margin-top: 0.15rem; }
  .ev-time { flex-shrink: 0; color: var(--sg-text-muted, #8892b0); font-size: 0.65rem; margin-top: 0.15rem; min-width: 3.5rem; }
  .ev-name { flex: 1; word-break: break-all; }
  .ev-rid  { flex-shrink: 0; color: var(--sg-text-muted, #8892b0); font-size: 0.62rem; margin-top: 0.15rem; }
  .ev-wall { flex-shrink: 0; font-size: 0.62rem; margin-top: 0.15rem; min-width: 3rem; text-align: right; }
  .ev-detail {
      padding: 0.4rem 0.6rem 0.4rem 2.4rem;
      background: rgba(13,27,42,0.6);
      font-size: 0.68rem; color: var(--sg-text-muted, #8892b0);
      white-space: pre-wrap; word-break: break-all;
      border-bottom: 1px solid rgba(42,58,92,0.6);
  }
  .ev-empty {
      padding: 1.5rem; text-align: center;
      color: var(--sg-text-muted, #8892b0); font-size: 0.75rem;
  }
</style>
<div class="ev-header">
  <span class="ev-title">VFS Event Timeline</span>
  <span class="ev-badge" id="badge">0</span>
  <button class="ev-pause-btn" id="btn-pause">Pause</button>
  <button class="ev-clear-btn" id="btn-clear">Clear</button>
</div>
<div class="ev-list" id="list">
  <div class="ev-empty" id="empty">Waiting for VFS events…</div>
</div>
`;
        const list = this.shadowRoot.getElementById('list');
        list.addEventListener('mouseenter', () => { this._paused = true;  this._updatePauseBtn(); });
        list.addEventListener('mouseleave', () => { this._paused = false; this._updatePauseBtn(); });

        this.shadowRoot.getElementById('btn-pause').addEventListener('click', () => {
            this._paused = !this._paused;
            this._updatePauseBtn();
        });

        this.shadowRoot.getElementById('btn-clear').addEventListener('click', () => {
            this._events = [];
            this._expanded = null;
            this._refreshList();
        });
    }

    _updatePauseBtn() {
        const btn = this.shadowRoot.getElementById('btn-pause');
        if (!btn) return;
        btn.textContent = this._paused ? 'Resume' : 'Pause';
        btn.classList.toggle('active', this._paused);
    }

    // ── Bus ──────────────────────────────────────────────────────────────

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
        const bus = this._busEl();
        this._bus = bus;
        for (const name of ALL_VFS_EVENTS) {
            bus.addEventListener(name, this._handler);
        }
    }

    _unbindBus() {
        if (!this._bus) return;
        for (const name of ALL_VFS_EVENTS) {
            this._bus.removeEventListener(name, this._handler);
        }
    }

    // ── Event ingestion ──────────────────────────────────────────────────

    _onEvent(e) {
        if (this._events.length >= MAX_EVENTS) {
            this._events.shift();
            if (this._expanded !== null) this._expanded = Math.max(0, this._expanded - 1);
        }
        this._events.push({ eventName: e.type, detail: e.detail || {}, time: Date.now() });
        this._appendRow(this._events.length - 1);
        this.shadowRoot.getElementById('badge').textContent = this._events.length;
    }

    // ── Rendering ────────────────────────────────────────────────────────

    _refreshList() {
        const list = this.shadowRoot.getElementById('list');
        list.innerHTML = '';
        if (this._events.length === 0) {
            list.innerHTML = '<div class="ev-empty" id="empty">Waiting for VFS events…</div>';
        } else {
            for (let i = 0; i < this._events.length; i++) {
                this._appendRow(i);
            }
        }
        this.shadowRoot.getElementById('badge').textContent = this._events.length;
    }

    _appendRow(idx) {
        const { eventName, detail, time } = this._events[idx];
        const cat   = categoryFor(eventName);
        const color = EVENT_COLORS[cat] || EVENT_COLORS.lifecycle;
        const list  = this.shadowRoot.getElementById('list');

        // Remove empty placeholder
        const empty = list.querySelector('#empty');
        if (empty) empty.remove();

        const row = document.createElement('div');
        row.className  = 'ev-row';
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
<span class="ev-name" style="color:${color.text}">${shortName}${path ? `<br><span style="color:var(--sg-text-muted,#8892b0);font-size:0.65rem">${path}</span>` : ''}</span>
<span class="ev-rid">${rid}</span>
<span class="ev-wall" style="color:${color.text}">${wallMs}</span>
`;
        row.addEventListener('click', () => this._toggleDetail(idx));

        list.appendChild(row);

        if (!this._paused) {
            row.scrollIntoView({ block: 'nearest' });
        }
    }

    _toggleDetail(idx) {
        const list = this.shadowRoot.getElementById('list');
        // Remove any existing detail panel
        const existing = list.querySelector('.ev-detail');
        if (existing) existing.remove();

        if (this._expanded === idx) {
            this._expanded = null;
            return;
        }
        this._expanded = idx;

        const { detail } = this._events[idx];
        const panel = document.createElement('div');
        panel.className = 'ev-detail';
        // Sanitise: show everything except _handled internals
        const display = { ...detail };
        delete display._handled;
        panel.textContent = JSON.stringify(display, null, 2);

        // Insert after the row
        const rows = list.querySelectorAll('.ev-row');
        const targetRow = [...rows].find(r => Number(r.dataset.idx) === idx);
        if (targetRow && targetRow.nextSibling) {
            list.insertBefore(panel, targetRow.nextSibling);
        } else {
            list.appendChild(panel);
        }
        panel.scrollIntoView({ block: 'nearest' });
    }
}

customElements.define('sg-vfs-event-viewer', SgVfsEventViewer);
