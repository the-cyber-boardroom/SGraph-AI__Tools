/**
 * sg-openrouter-key-stats — Full OpenRouter key details panel.
 *
 * Replaces the bare credit badge with a comprehensive panel showing everything
 * returned by GET /api/v1/key: label, rate limit, usage amounts, limit, rolling
 * period bars (day/week/month), free-tier status, key metadata.
 *
 * Adds localStorage caching (5 min TTL) to avoid fetching on every panel switch.
 *
 * API endpoint:
 *   GET https://openrouter.ai/api/v1/key
 *   Authorization: Bearer <api-key>
 *
 * Consumes (on [data-llm-bus] ancestor):
 *   llm:connected        — { apiKey, provider } → fetch if provider='openrouter'
 *   llm:disconnected     — clear
 *   llm:request-complete — refresh (bypasses cache)
 *
 * Public API:
 *   refresh()  — force re-fetch
 *   clear()    — reset to idle
 *
 * @module sg-openrouter-key-stats
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const API_URL    = 'https://openrouter.ai/api/v1/key';
const CACHE_KEY  = 'or-cache-key-stats';
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

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
    overflow-y: auto;
}
:host::-webkit-scrollbar { width: 6px; }
:host::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

.ks-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
}
.ks-title { flex: 1; font-size: 10px; letter-spacing: 0.06em; color: #374151; text-transform: uppercase; }
.ks-age { font-size: 10px; color: #1e2035; }
.ks-btn {
    background: #12122a; border: 1px solid #1e2035; border-radius: 4px;
    color: #64748b; cursor: pointer; font-family: monospace; font-size: 11px;
    padding: 3px 10px;
}
.ks-btn:hover { border-color: #3b82f6; color: #60a5fa; }
.ks-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.ks-spinner {
    display: inline-block; width: 9px; height: 9px;
    border: 1px solid #374151; border-top-color: #3b82f6;
    border-radius: 50%; animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.ks-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 14px; }

.ks-empty {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: #374151; font-size: 11px; text-align: center; padding: 2rem;
}

/* ── Status row ── */
.ks-status { display: flex; align-items: center; gap: 8px; }
.ks-dot { font-size: 11px; }
.ks-dot.ok   { color: #4ade80; }
.ks-dot.warn { color: #fbbf24; }
.ks-dot.crit { color: #f87171; }
.ks-label-name { font-size: 13px; font-weight: 600; color: #e2e8f0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ks-free-badge {
    font-size: 10px; padding: 1px 6px; border-radius: 10px;
    border: 1px solid #166534; background: #0a1a0d; color: #4ade80;
}

/* ── Credit bar ── */
.ks-credit-row { display: flex; flex-direction: column; gap: 5px; }
.ks-credit-amounts { display: flex; justify-content: space-between; font-size: 11px; }
.ks-credit-remaining { font-size: 17px; font-weight: 700; }
.ks-credit-remaining.ok   { color: #4ade80; }
.ks-credit-remaining.warn { color: #fbbf24; }
.ks-credit-remaining.crit { color: #f87171; }
.ks-credit-used { color: #64748b; font-size: 11px; }
.ks-credit-limit { color: #374151; font-size: 11px; }
.ks-bar-track {
    height: 6px; background: #1e2035; border-radius: 3px; overflow: hidden;
}
.ks-bar-fill {
    height: 100%; border-radius: 3px; transition: width 0.4s ease;
}
.ks-bar-fill.ok   { background: #166534; }
.ks-bar-fill.warn { background: #78350f; }
.ks-bar-fill.crit { background: #7f1d1d; }

/* ── Section headers ── */
.ks-section-hdr {
    font-size: 10px; letter-spacing: 0.06em; color: #374151;
    text-transform: uppercase; border-bottom: 1px solid #1e2035;
    padding-bottom: 5px; margin-bottom: 4px;
}

/* ── Period rows ── */
.ks-periods { display: flex; flex-direction: column; gap: 7px; }
.ks-period { display: flex; flex-direction: column; gap: 3px; }
.ks-period-header { display: flex; justify-content: space-between; font-size: 10px; }
.ks-period-label { color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
.ks-period-val { color: #c8d0e0; font-weight: 600; }
.ks-period-bar-track { height: 3px; background: #1e2035; border-radius: 2px; overflow: hidden; }
.ks-period-bar-fill { height: 100%; background: #1e3a6e; border-radius: 2px; transition: width 0.4s; }

/* ── Info grid ── */
.ks-info { display: flex; flex-direction: column; gap: 5px; }
.ks-info-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ks-info-key { font-size: 10px; color: #374151; white-space: nowrap; }
.ks-info-val { font-size: 11px; color: #64748b; text-align: right; overflow: hidden; text-overflow: ellipsis; max-width: 200px; white-space: nowrap; }
.ks-info-val.highlight { color: #93c5fd; }

/* ── Rate limit ── */
.ks-rate { display: inline-flex; align-items: center; gap: 6px; }
.ks-rate-badge {
    padding: 2px 8px; border-radius: 4px;
    border: 1px solid #1e3060; background: #0d1a3d;
    color: #93c5fd; font-size: 11px;
}
`;

export class SgOpenrouterKeyStats extends HTMLElement {

    constructor() {
        super();
        this._shadow   = this.attachShadow({ mode: 'open' });
        this._apiKey   = null;
        this._data     = null;
        this._loading  = false;
        this._handlers = {};
    }

    connectedCallback() {
        this._renderShell();
        this._bindBus();
        // Auto-restore from cache if available
        const cached = this._loadCache();
        if (cached) this._renderData(cached);
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [ev, fn] of Object.entries(this._handlers)) bus.removeEventListener(ev, fn);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    refresh() { if (this._apiKey) this._fetch(true); }
    clear()   { this._apiKey = null; this._data = null; this._renderShell(); }

    // ── Bus ───────────────────────────────────────────────────────────────────

    _bindBus() {
        const bus = this._bus();
        const on  = (ev, fn) => { const b = fn.bind(this); this._handlers[ev] = b; bus.addEventListener(ev, b); };
        on(SGL_LLM.CONNECTED,        this._onConnected);
        on(SGL_LLM.DISCONNECTED,     this._onDisconnected);
        on(SGL_LLM.REQUEST_COMPLETE, this._onRequestComplete);
    }

    _onConnected(e) {
        if (e.detail?.provider !== 'openrouter') return;
        this._apiKey = e.detail?.apiKey;
        if (!this._apiKey) return;
        const cached = this._loadCache();
        if (cached) { this._renderData(cached); }
        else         { this._fetch(); }
    }

    _onDisconnected() { this.clear(); }

    _onRequestComplete() {
        // After a generation, bypass cache and refresh
        if (this._apiKey) this._fetch(true);
    }

    // ── Fetch ─────────────────────────────────────────────────────────────────

    async _fetch(bypassCache = false) {
        if (!this._apiKey || this._loading) return;

        if (!bypassCache) {
            const cached = this._loadCache();
            if (cached) { this._renderData(cached); return; }
        }

        this._loading = true;
        this._setSpinner(true);

        try {
            const res = await fetch(API_URL, { headers: { 'Authorization': `Bearer ${this._apiKey}` } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const data = json.data ?? json;
            this._saveCache(data);
            this._renderData(data);
        } catch (err) {
            this._showError(err.message);
        } finally {
            this._loading = false;
            this._setSpinner(false);
        }
    }

    // ── Cache ─────────────────────────────────────────────────────────────────

    _cacheId() { return `${CACHE_KEY}-${(this._apiKey ?? '').slice(-8)}`; }

    _loadCache() {
        try {
            const raw = localStorage.getItem(this._cacheId());
            if (!raw) return null;
            const { ts, data } = JSON.parse(raw);
            if (Date.now() - ts > CACHE_TTL) return null;
            return data;
        } catch { return null; }
    }

    _saveCache(data) {
        try { localStorage.setItem(this._cacheId(), JSON.stringify({ ts: Date.now(), data })); } catch {}
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

    // ── Render ────────────────────────────────────────────────────────────────

    _renderShell() {
        this._shadow.innerHTML = `<style>${CSS}</style>
<div class="ks-toolbar">
  <span class="ks-title">Key Stats</span>
  <span class="ks-age" id="age"></span>
  <button class="ks-btn" id="refresh-btn">↻</button>
</div>
<div id="content" class="ks-empty">Connect to view key details</div>`;
        this._shadow.getElementById('refresh-btn').addEventListener('click', () => this.refresh());
    }

    _setSpinner(on) {
        const btn = this._shadow.getElementById('refresh-btn');
        if (btn) btn.innerHTML = on ? '<span class="ks-spinner"></span>' : '↻';
        if (btn) btn.disabled = on;
    }

    _showError(msg) {
        const el = this._shadow.getElementById('content');
        if (el) el.innerHTML = `<div class="ks-empty">Error: ${_esc(msg)}</div>`;
    }

    _renderData(data) {
        this._data = data;
        const age = this._cacheAge();
        const ageEl = this._shadow.getElementById('age');
        if (ageEl) ageEl.textContent = age ? `cached ${age}` : '';

        const {
            label           = null,
            usage           = 0,
            limit           = null,
            limit_remaining = null,
            is_free_tier    = false,
            rate_limit      = null,
            created_at      = null,
            expires_at      = null,
            usage_today     = null,
            usage_this_week = null,
            usage_this_month= null,
        } = data;

        const remaining = limit_remaining !== null ? limit_remaining
                        : limit !== null            ? limit - usage
                        :                            null;
        const pct       = (limit && remaining !== null) ? Math.max(0, Math.min(1, remaining / limit)) : null;
        const state     = is_free_tier     ? 'ok'
                        : pct === null     ? 'ok'
                        : pct > 0.2       ? 'ok'
                        : pct > 0.05      ? 'warn'
                        :                   'crit';

        const dotChar  = '⬤';
        const rStr     = remaining !== null ? `$${remaining.toFixed(3)}` : '∞';
        const usedStr  = `$${usage.toFixed(4)} spent`;
        const limitStr = limit !== null ? `/ $${limit.toFixed(2)} limit` : '(no limit)';
        const pctStr   = pct !== null ? `${(pct * 100).toFixed(1)}%` : '';
        const pctW     = pct !== null ? `${Math.max(2, pct * 100).toFixed(1)}%` : '100%';

        // Usage periods — use API fields or derive if possible
        const periods = [
            { label: 'Today',     val: usage_today      ?? null, key: 'today'  },
            { label: 'This week', val: usage_this_week  ?? null, key: 'week'   },
            { label: 'This month',val: usage_this_month ?? null, key: 'month'  },
        ].filter(p => p.val !== null);

        // Rate limit
        const rl = rate_limit;
        const rlHtml = rl
            ? `<span class="ks-rate"><span class="ks-rate-badge">${rl.requests ?? '?'} req / ${rl.interval ?? '?'}</span></span>`
            : '<span style="color:#374151">unlimited</span>';

        const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—';

        const periodRows = periods.length ? `
<div class="ks-section-hdr">Rolling usage</div>
<div class="ks-periods">
  ${periods.map(p => {
      const maxVal = usage || 0.001;
      const barW   = Math.min(100, (p.val / maxVal) * 100).toFixed(1);
      return `<div class="ks-period">
        <div class="ks-period-header">
          <span class="ks-period-label">${p.label}</span>
          <span class="ks-period-val">$${p.val.toFixed(4)}</span>
        </div>
        <div class="ks-period-bar-track"><div class="ks-period-bar-fill" style="width:${barW}%"></div></div>
      </div>`;
  }).join('')}
</div>` : '';

        const el = this._shadow.getElementById('content');
        if (!el) return;
        el.className = 'ks-body';
        el.innerHTML = `
<div class="ks-status">
  <span class="ks-dot ${state}">${dotChar}</span>
  <span class="ks-label-name">${_esc(label ?? 'OpenRouter Key')}</span>
  ${is_free_tier ? '<span class="ks-free-badge">FREE TIER</span>' : ''}
</div>

<div class="ks-credit-row">
  <div class="ks-section-hdr">Credit balance</div>
  <div class="ks-credit-amounts">
    <div>
      <div class="ks-credit-remaining ${state}">${rStr}</div>
      <div class="ks-credit-used">${usedStr}</div>
    </div>
    <div style="text-align:right">
      <div class="ks-credit-limit">${limitStr}</div>
      ${pctStr ? `<div style="font-size:11px;color:#64748b">${pctStr} remaining</div>` : ''}
    </div>
  </div>
  <div class="ks-bar-track">
    <div class="ks-bar-fill ${state}" style="width:${pctW}"></div>
  </div>
</div>

${periodRows}

<div class="ks-section-hdr">Key details</div>
<div class="ks-info">
  <div class="ks-info-row">
    <span class="ks-info-key">rate limit</span>
    <span class="ks-info-val">${rlHtml}</span>
  </div>
  <div class="ks-info-row">
    <span class="ks-info-key">free tier</span>
    <span class="ks-info-val ${is_free_tier ? 'highlight' : ''}">${is_free_tier ? 'yes' : 'no'}</span>
  </div>
  <div class="ks-info-row">
    <span class="ks-info-key">created</span>
    <span class="ks-info-val">${fmtDate(created_at)}</span>
  </div>
  <div class="ks-info-row">
    <span class="ks-info-key">expires</span>
    <span class="ks-info-val">${fmtDate(expires_at)}</span>
  </div>
</div>`;
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }
}

function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

customElements.define('sg-openrouter-key-stats', SgOpenrouterKeyStats);
