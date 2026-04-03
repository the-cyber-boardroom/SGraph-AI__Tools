/**
 * sg-openrouter-usage — OpenRouter spending dashboard panel.
 *
 * Shows rolling-period usage (daily / weekly / monthly) and all-time total
 * drawn from the same `GET /api/v1/key` endpoint as sg-openrouter-balance.
 * Each period renders as a labelled progress bar whose fill reflects percent
 * of the credit limit consumed. When there is no limit the bar shows absolute
 * spend with no percentage.
 *
 * Also surfaces key metadata: label, rate-limit, free-tier status, and
 * expiry (if set).
 *
 * API endpoint:
 *   GET https://openrouter.ai/api/v1/key
 *   Authorization: Bearer <api-key>
 *   Response fields used:
 *     label, is_free_tier, expires_at, rate_limit
 *     usage, limit, limit_remaining, limit_reset
 *     usage_daily, usage_weekly, usage_monthly
 *
 * Consumes (on [data-llm-bus] ancestor):
 *   llm:connected       — { provider, apiKey } → starts polling (openrouter only)
 *   llm:disconnected    — clears display
 *   llm:request-complete → auto-refresh after each generation
 *
 * Attributes:
 *   (none — purely driven by bus events)
 *
 * Public API:
 *   usage.refresh()    → re-fetch immediately
 *   usage.clear()      → reset to idle state
 *
 * @module sg-openrouter-usage
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const API_URL = 'https://openrouter.ai/api/v1/key';

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
:host::-webkit-scrollbar-track { background: #0d0d1a; }
:host::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

/* ── Header ──────────────────────────────────────────── */
.oru-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px 6px;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
}
.oru-title { color: #64748b; font-size: 11px; letter-spacing: 0.04em; }
.oru-refresh {
    background: none;
    border: 1px solid #1e2035;
    border-radius: 3px;
    color: #374151;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 6px;
}
.oru-refresh:hover { border-color: #3b82f6; color: #60a5fa; }

/* ── Key info ────────────────────────────────────────── */
.oru-meta {
    padding: 8px 10px;
    border-bottom: 1px solid #1e2035;
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex-shrink: 0;
}
.oru-key-label { color: #c8d0e0; font-size: 12px; font-weight: 500; }
.oru-key-detail { color: #374151; font-size: 10px; }
.oru-key-detail span { color: #64748b; }
.badge-free  { color: #4ade80; }
.badge-paid  { color: #60a5fa; }
.badge-exp   { color: #f87171; }

/* ── Periods ─────────────────────────────────────────── */
.oru-periods {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    flex: 1;
}

.oru-period {}
.oru-period-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 5px;
}
.oru-period-label { color: #64748b; font-size: 10px; letter-spacing: 0.03em; }
.oru-period-right { display: flex; gap: 10px; align-items: baseline; }
.oru-period-amount { color: #c8d0e0; font-size: 12px; }
.oru-period-pct { color: #374151; font-size: 10px; }
.oru-period-pct.warn  { color: #fbbf24; }
.oru-period-pct.crit  { color: #f87171; }

.oru-bar-track {
    height: 6px;
    background: #1e2035;
    border-radius: 3px;
    overflow: hidden;
}
.oru-bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.4s ease;
    background: #3b82f6;
}
.oru-bar-fill.warn  { background: #f59e0b; }
.oru-bar-fill.crit  { background: #ef4444; }
.oru-bar-fill.free  { background: #22c55e; }
.oru-bar-fill.nolim { background: #1e3a6e; width: 100%; }

/* ── All-time row ────────────────────────────────────── */
.oru-alltime {
    padding: 8px 10px;
    border-top: 1px solid #1e2035;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-shrink: 0;
}
.oru-alltime-label { color: #374151; font-size: 10px; }
.oru-alltime-val { color: #64748b; font-size: 12px; }

/* ── States ──────────────────────────────────────────── */
.oru-idle {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #1e2035;
    font-size: 11px;
    padding: 20px;
    text-align: center;
}
.oru-spinner {
    display: inline-block;
    width: 10px; height: 10px;
    border: 1px solid #1e2035;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin-right: 6px;
    vertical-align: middle;
}
@keyframes spin { to { transform: rotate(360deg); } }
.oru-error { color: #f87171; font-size: 10px; padding: 10px; }
`;

export class SgOpenrouterUsage extends HTMLElement {

    constructor() {
        super();
        this._apiKey = '';
        this._data   = null;
        this._boundHandlers = {};
        this._shadow = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._renderIdle();
        this._bindBusEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [ev, fn] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(ev, fn);
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /** Re-fetch key data from OpenRouter. */
    refresh() {
        if (this._apiKey) this._fetch();
    }

    /** Reset to idle / disconnected state. */
    clear() {
        this._apiKey = '';
        this._data   = null;
        this._renderIdle();
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
    }

    _onConnected(e) {
        if (e.detail?.provider !== 'openrouter') { this._apiKey = ''; return; }
        this._apiKey = e.detail?.apiKey ?? '';
        if (this._apiKey) this._fetch();
    }

    _onDisconnected() {
        this.clear();
    }

    _onRequestComplete() {
        if (this._apiKey) this._fetch();
    }

    // ── Fetch ──────────────────────────────────────────────────────────────

    async _fetch() {
        this._setLoading();
        try {
            const res = await fetch(API_URL, {
                headers: { Authorization: `Bearer ${this._apiKey}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            this._data = json.data ?? {};
            this._renderData();
        } catch (err) {
            console.warn('[sg-openrouter-usage] fetch error:', err.message);
            this._renderError(err.message);
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────

    _renderIdle() {
        this._shadow.innerHTML = `<style>${CSS}</style>
<div class="oru-idle">Connect to OpenRouter<br>to see usage</div>`;
    }

    _setLoading() {
        if (this._data) return; // already showing data — don't flash
        this._shadow.innerHTML = `<style>${CSS}</style>
<div class="oru-idle"><span class="oru-spinner"></span> Loading…</div>`;
    }

    _renderError(msg) {
        this._shadow.innerHTML = `<style>${CSS}</style>
<div class="oru-header">
    <span class="oru-title">USAGE</span>
    <button class="oru-refresh" title="Retry">↺</button>
</div>
<div class="oru-error">Error: ${_escape(msg)}</div>`;
        this._shadow.querySelector('.oru-refresh')
            .addEventListener('click', () => this._fetch());
    }

    _renderData() {
        const d = this._data;
        const {
            label        = '',
            is_free_tier = false,
            expires_at   = null,
            rate_limit   = null,
            usage        = 0,
            limit        = null,
            limit_remaining = null,
            limit_reset  = null,
            usage_daily  = 0,
            usage_weekly = 0,
            usage_monthly= 0,
        } = d;

        const remaining = limit_remaining !== null ? limit_remaining
            : (limit !== null ? limit - usage : null);

        this._shadow.innerHTML = `<style>${CSS}</style>
<div class="oru-header">
    <span class="oru-title">USAGE</span>
    <button class="oru-refresh" title="Refresh">↺</button>
</div>
<div class="oru-meta">
    <div class="oru-key-label">${_escape(label || 'Unnamed key')}
        <span class="${is_free_tier ? 'badge-free' : 'badge-paid'}">
            ${is_free_tier ? ' free tier' : ' paid'}
        </span>
    </div>
    ${rate_limit ? `<div class="oru-key-detail"><span>rate limit</span>  ${_escape(String(rate_limit.requests))} / ${_escape(rate_limit.interval)}</div>` : ''}
    ${expires_at ? `<div class="oru-key-detail badge-exp"><span>expires</span>  ${_escape(_fmtDate(expires_at))}</div>` : ''}
    ${limit !== null ? `<div class="oru-key-detail"><span>limit</span>  $${_fmtUsd(limit)} / ${limit_reset ?? 'total'}</div>` : ''}
    ${remaining !== null ? `<div class="oru-key-detail"><span>remaining</span>  $${_fmtUsd(remaining)}</div>` : ''}
</div>
<div class="oru-periods">
    ${_periodRow('TODAY',     usage_daily,   limit, 'daily',   is_free_tier)}
    ${_periodRow('THIS WEEK', usage_weekly,  limit, 'weekly',  is_free_tier)}
    ${_periodRow('THIS MONTH',usage_monthly, limit, 'monthly', is_free_tier)}
</div>
<div class="oru-alltime">
    <span class="oru-alltime-label">ALL TIME</span>
    <span class="oru-alltime-val">$${_fmtUsd(usage)}</span>
</div>`;

        this._shadow.querySelector('.oru-refresh')
            .addEventListener('click', () => this._fetch());
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }
}

// ── Module-level helpers ───────────────────────────────────────────────────

/**
 * Build the HTML for a single period row.
 * @param {string} label
 * @param {number} spent
 * @param {number|null} totalLimit
 * @param {string} period  — "daily"|"weekly"|"monthly"
 * @param {boolean} isFree
 * @returns {string}
 */
function _periodRow(label, spent, totalLimit, period, isFree) {
    // Only show a percentage bar if limit applies to this period
    const hasPctBar = totalLimit !== null && totalLimit > 0;
    const pct       = hasPctBar ? Math.min(1, spent / totalLimit) : null;
    const pctNum    = pct !== null ? Math.round(pct * 100) : null;

    const state = pct === null ? (isFree ? 'free' : 'nolim')
        : pct >= 0.95 ? 'crit'
        : pct >= 0.80 ? 'warn'
        : '';

    const fillWidth = pct !== null ? `${(pct * 100).toFixed(1)}%` : '100%';

    return `
<div class="oru-period">
    <div class="oru-period-header">
        <span class="oru-period-label">${label}</span>
        <span class="oru-period-right">
            <span class="oru-period-amount">$${_fmtUsd(spent)}</span>
            ${pctNum !== null
                ? `<span class="oru-period-pct ${state}">${pctNum}%</span>`
                : `<span class="oru-period-pct">${isFree ? 'free' : 'no limit'}</span>`
            }
        </span>
    </div>
    <div class="oru-bar-track">
        <div class="oru-bar-fill ${state}" style="width:${fillWidth}"></div>
    </div>
</div>`;
}

/** Format USD to 4 decimal places, trim trailing zeros but keep at least 2. */
function _fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    const s = n.toFixed(4);
    // Remove trailing zeros after the decimal point, keep min 2dp
    return s.replace(/(\.\d{2})\d*0+$/, '$1').replace(/(\.\d{2,})0+$/, '$1');
}

/** Format an ISO 8601 date as YYYY-MM-DD. */
function _fmtDate(iso) {
    try { return new Date(iso).toISOString().slice(0, 10); }
    catch { return iso; }
}

function _escape(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

customElements.define('sg-openrouter-usage', SgOpenrouterUsage);
window.SgOpenrouterUsage = SgOpenrouterUsage;
