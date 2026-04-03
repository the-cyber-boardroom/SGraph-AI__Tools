/**
 * sg-openrouter-balance — OpenRouter credit balance badge.
 *
 * Fetches the remaining credit balance for an OpenRouter API key and displays
 * it as a compact badge. Refreshes automatically after each completed request
 * so the user always sees an up-to-date spend figure.
 *
 * The badge changes colour based on remaining balance:
 *   green  — healthy (> 20% of limit remaining, or unlimited)
 *   amber  — low     (5–20% remaining)
 *   red    — critical (< 5% remaining or $0)
 *
 * API endpoint used:
 *   GET https://openrouter.ai/api/v1/key
 *   Authorization: Bearer <api-key>
 *   Response: { data: { label, usage, limit, limit_remaining, is_free_tier, rate_limit } }
 *   usage, limit and limit_remaining are in USD (dollars). limit=null means unlimited.
 *
 * Consumes (on [data-llm-bus] ancestor):
 *   llm:connected       — { apiKey, provider } → fetches balance if provider === 'openrouter'
 *   llm:disconnected    — clears badge
 *   llm:request-complete — refreshes balance after each generation
 *
 * Attributes:
 *   compact  — shows only the dollar amount (no label text)
 *
 * Public API:
 *   balance.refresh()   → manually trigger a balance fetch
 *   balance.clear()     → reset to idle state
 *
 * @module sg-openrouter-balance
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const API_URL = 'https://openrouter.ai/api/v1/key';

const CSS = `
:host { display: inline-block; }

.orb-wrap {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: monospace;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid transparent;
    transition: background 0.2s, border-color 0.2s, color 0.2s;
    user-select: none;
    white-space: nowrap;
}

/* States */
.orb-wrap.idle {
    background: #0d0d1a;
    border-color: #1e2035;
    color: #374151;
}
.orb-wrap.loading {
    background: #0d1a2a;
    border-color: #1e3060;
    color: #64748b;
}
.orb-wrap.healthy {
    background: #0a1a0d;
    border-color: #166534;
    color: #4ade80;
}
.orb-wrap.low {
    background: #1a1200;
    border-color: #78350f;
    color: #fbbf24;
}
.orb-wrap.critical {
    background: #1a0a0a;
    border-color: #7f1d1d;
    color: #f87171;
}
.orb-wrap.error {
    background: #12122a;
    border-color: #374151;
    color: #64748b;
}

.orb-icon { font-size: 10px; line-height: 1; }
.orb-label { color: inherit; opacity: 0.7; }
.orb-amount { font-weight: 600; }
.orb-limit { opacity: 0.5; }
.orb-spinner {
    display: inline-block;
    width: 8px;
    height: 8px;
    border: 1px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
`;

export class SgOpenrouterBalance extends HTMLElement {

    constructor() {
        super();
        this._apiKey        = '';
        this._abortCtrl     = null;
        this._boundHandlers = {};
        this._shadow        = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._render();
        this._bindBusEvents();
    }

    disconnectedCallback() {
        this._abort();
        const bus = this._bus();
        for (const [ev, fn] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(ev, fn);
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /** Manually trigger a balance fetch (uses the last known API key). */
    refresh() {
        if (this._apiKey) this._fetch();
    }

    /** Reset to idle state. */
    clear() {
        this._apiKey = '';
        this._setState('idle');
    }

    // ── Event binding ──────────────────────────────────────────────────────

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
        if (e.detail?.provider !== 'openrouter') return;
        const key = e.detail?.apiKey;
        if (!key) return;
        this._apiKey = key;
        this._fetch();
    }

    _onDisconnected() {
        this.clear();
    }

    _onRequestComplete() {
        // Refresh after each generation so usage stays current.
        if (this._apiKey) this._fetch();
    }

    // ── Fetch ──────────────────────────────────────────────────────────────

    async _fetch() {
        this._abort();
        this._setState('loading');

        this._abortCtrl = new AbortController();
        try {
            const res = await fetch(API_URL, {
                headers: { 'Authorization': `Bearer ${this._apiKey}` },
                signal:  this._abortCtrl.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            this._render(json.data);
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.warn('[sg-openrouter-balance] fetch error:', err.message);
            this._setState('error', { message: 'unavailable' });
        } finally {
            this._abortCtrl = null;
        }
    }

    _abort() {
        if (this._abortCtrl) {
            this._abortCtrl.abort();
            this._abortCtrl = null;
        }
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    _render(data = null) {
        if (!this._shadow.querySelector('.orb-wrap')) {
            // First render — build skeleton
            this._shadow.innerHTML = `<style>${CSS}</style><div class="orb-wrap idle" part="wrap"></div>`;
        }
        if (!data) {
            this._setState('idle');
            return;
        }

        const { usage = 0, limit = null, limit_remaining = null, is_free_tier = false } = data;
        const remaining = limit_remaining !== null ? limit_remaining : (limit !== null ? limit - usage : null);
        const pct       = limit ? (remaining / limit) : null;

        let state;
        if (is_free_tier)           state = 'healthy';
        else if (pct === null)      state = 'healthy';   // unlimited
        else if (pct > 0.2)        state = 'healthy';
        else if (pct > 0.05)       state = 'low';
        else                        state = 'critical';

        const compact  = this.hasAttribute('compact');
        const icon     = state === 'healthy' ? '💳' : state === 'low' ? '⚠️' : '🔴';
        const amtStr   = remaining !== null ? `$${remaining.toFixed(2)}` : '∞';
        const limitStr = limit !== null ? ` / $${limit.toFixed(2)}` : '';
        const usedStr  = `$${usage.toFixed(3)} used`;

        const wrap = this._shadow.querySelector('.orb-wrap');
        wrap.className = `orb-wrap ${state}`;
        wrap.title     = `OpenRouter: ${amtStr} remaining${limitStr !== '' ? limitStr : ''} (${usedStr})`;

        if (compact) {
            wrap.innerHTML = `<span class="orb-amount">${amtStr}</span>`;
        } else {
            wrap.innerHTML = `
                <span class="orb-icon">${icon}</span>
                <span class="orb-label">Credits</span>
                <span class="orb-amount">${amtStr}</span>
                ${limit !== null ? `<span class="orb-limit">${limitStr}</span>` : ''}
            `;
        }
    }

    _setState(state, opts = {}) {
        if (!this._shadow.querySelector('.orb-wrap')) {
            this._shadow.innerHTML = `<style>${CSS}</style><div class="orb-wrap idle" part="wrap"></div>`;
        }
        const wrap = this._shadow.querySelector('.orb-wrap');
        wrap.className = `orb-wrap ${state}`;
        if (state === 'loading') {
            wrap.innerHTML = `<span class="orb-spinner"></span><span class="orb-label">Credits…</span>`;
            wrap.title = 'Fetching OpenRouter balance…';
        } else if (state === 'idle') {
            wrap.innerHTML = `<span class="orb-icon">💳</span><span class="orb-label">Not connected</span>`;
            wrap.title = '';
        } else if (state === 'error') {
            wrap.innerHTML = `<span class="orb-icon">💳</span><span class="orb-label">${opts.message ?? 'error'}</span>`;
            wrap.title = 'Could not fetch OpenRouter balance';
        }
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

customElements.define('sg-openrouter-balance', SgOpenrouterBalance);
window.SgOpenrouterBalance = SgOpenrouterBalance;
