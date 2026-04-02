/**
 * sg-llm-token-viz — Token breakdown visualiser for LLM requests.
 *
 * Makes the invisible visible: shows how many tokens each part of a request
 * consumes, tracks context growth across cycles, and estimates cost.
 *
 * This is the component that makes one-shot feedback loops tangible — you can
 * see whether your context is growing (standard chat), shrinking (effective
 * pruning), or holding steady (ideal feedback loop).
 *
 * Displays:
 *   - Stacked bar: token breakdown by section
 *     (system prompt / history / current message / images)
 *   - Actual totals on REQUEST_COMPLETE (estimated from messages on SEND)
 *   - Cost estimate (from built-in pricing table)
 *   - Growth sparkline: input token count across last N requests
 *   - Session totals: cumulative tokens + cost across all requests
 *
 * Consumes (on parentElement):
 *   llm:send             — { messages[], model, provider } → analyse breakdown
 *   llm:request-start    — transition to in-flight state
 *   llm:request-complete — { promptTokens, completionTokens, model } → finalise
 *   llm:request-error    — clear in-flight state
 *   llm:request-cancel   — clear in-flight state
 *
 * Public API:
 *   viz.getStats()  → { history, session } for inspection / testing
 *   viz.clear()     → reset all history and session totals
 *
 * @module sg-llm-token-viz
 * @version 0.1.1
 *
 * Changelog:
 *   v0.1.1: _bus() updated to walk [data-llm-bus] ancestor for sg-layout panel compatibility (backwards compatible).
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

// ── Pricing table (per million tokens: [input, output]) ───────────────────────
// Used for cost estimation when the provider does not return cost directly.
const MODEL_PRICING = {
    'claude-opus-4-6':              [15.0,  75.0],
    'claude-sonnet-4-6':            [ 3.0,  15.0],
    'claude-haiku-4-5-20251001':    [ 0.8,   4.0],
    'claude-3-5-haiku-20241022':    [ 0.8,   4.0],
    'claude-3-5-sonnet-20241022':   [ 3.0,  15.0],
    'claude-3-opus-20240229':       [15.0,  75.0],
    'gpt-4o':                       [ 5.0,  15.0],
    'gpt-4o-mini':                  [ 0.15,  0.6],
    'gpt-4-turbo':                  [10.0,  30.0],
    'o1':                           [15.0,  60.0],
    'o1-mini':                      [ 3.0,  12.0],
    'o3-mini':                      [ 1.1,   4.4],
    'mistral-large-latest':         [ 3.0,   9.0],
    'mistral-small-latest':         [ 1.0,   3.0],
    'deepseek-chat':                [ 0.27,  1.1],
    'deepseek-coder':               [ 0.27,  1.1],
};

// Segment colours (system / history / current / images / output)
const CLR = {
    system:  '#7c3aed',
    history: '#1e40af',
    current: '#0e7490',
    images:  '#d97706',
    output:  '#16a34a',
    unknown: '#374151',
};

const MAX_HISTORY = 20;   // sparkline shows last 20 requests
const IMG_TOKENS  = 800;  // estimated tokens per image attachment

const CSS = `
:host { display: flex; flex-direction: column; overflow: hidden; }
* { box-sizing: border-box; }

.tv-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0a0a18;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px;
    color: #e2e8f0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #222d4d transparent;
}

/* ── Section ──────────────────────────────────────────────── */
.section {
    padding: 10px 12px;
    border-bottom: 1px solid #1a1f35;
}
.section-title {
    font-size: 10px;
    font-weight: 600;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 8px;
}

/* ── Request header ───────────────────────────────────────── */
.req-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 6px;
}
.req-num {
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
}
.req-model {
    font-size: 10px;
    color: #374151;
    font-family: monospace;
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
}

/* ── Stacked bar ──────────────────────────────────────────── */
.bar-wrap {
    height: 16px;
    border-radius: 3px;
    overflow: hidden;
    background: #111827;
    display: flex;
    margin-bottom: 6px;
}
.bar-seg {
    height: 100%;
    transition: width 0.25s ease;
    min-width: 1px;
}
.bar-wrap.pending {
    animation: bar-pulse 1s ease-in-out infinite alternate;
}
@keyframes bar-pulse {
    from { opacity: 0.5; }
    to   { opacity: 1.0; }
}

/* ── Legend ───────────────────────────────────────────────── */
.legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    margin-bottom: 8px;
}
.legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #64748b;
}
.legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
}
.legend-val {
    color: #94a3b8;
    font-family: monospace;
}

/* ── Totals row ───────────────────────────────────────────── */
.totals-row {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 11px;
}
.totals-in  { color: #7c9ef8; }
.totals-out { color: #4ade80; }
.totals-cost { color: #fbbf24; }
.totals-dot  { color: #374151; }

/* ── Sparkline ────────────────────────────────────────────── */
.sparkline-wrap {
    margin-bottom: 4px;
}
svg.sparkline {
    display: block;
    width: 100%;
    overflow: visible;
}
.spark-label {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #374151;
    font-family: monospace;
    margin-top: 2px;
}
.spark-empty {
    font-size: 10px;
    color: #1e2035;
    text-align: center;
    padding: 10px 0;
}

/* ── Session ──────────────────────────────────────────────── */
.sess-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 8px;
}
.sess-item { display: flex; flex-direction: column; gap: 1px; }
.sess-label { font-size: 9px; color: #374151; text-transform: uppercase; letter-spacing: 0.06em; }
.sess-val   { font-size: 12px; font-family: monospace; color: #94a3b8; }
.sess-val.accent-in   { color: #7c9ef8; }
.sess-val.accent-out  { color: #4ade80; }
.sess-val.accent-cost { color: #fbbf24; }
.sess-val.accent-req  { color: #a78bfa; }

/* ── Clear button ─────────────────────────────────────────── */
.tv-actions {
    padding: 6px 12px;
    display: flex;
    justify-content: flex-end;
}
.tv-btn {
    font-family: monospace;
    font-size: 10px;
    background: none;
    color: #374151;
    border: 1px solid #1e2035;
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
}
.tv-btn:hover { color: #94a3b8; border-color: #374151; }
`;

export class SgLlmTokenViz extends HTMLElement {

    constructor() {
        super();
        this._history       = [];   // [{model, breakdown, promptTokens, completionTokens, cost}]
        this._session       = { promptTokens: 0, completionTokens: 0, cost: 0, requests: 0 };
        this._pending       = null; // breakdown from current SEND, before COMPLETE
        this._pendingModel  = '';
        this._boundHandlers = {};
        this._shadow        = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._render();
        this._bindEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [ev, fn] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(ev, fn);
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Returns current stats for external inspection.
     * @returns {{ history: Array, session: Object }}
     */
    getStats() {
        return { history: [...this._history], session: { ...this._session } };
    }

    /** Reset all history and session totals. */
    clear() {
        this._history      = [];
        this._session      = { promptTokens: 0, completionTokens: 0, cost: 0, requests: 0 };
        this._pending      = null;
        this._pendingModel = '';
        this._update();
    }

    // ── Event binding ──────────────────────────────────────────────────────

    _bindEvents() {
        const bus = this._bus();
        const on  = (ev, fn) => {
            const bound = fn.bind(this);
            this._boundHandlers[ev] = bound;
            bus.addEventListener(ev, bound);
        };
        on(SGL_LLM.SEND,             this._onSend);
        on(SGL_LLM.REQUEST_START,    this._onRequestStart);
        on(SGL_LLM.REQUEST_COMPLETE, this._onRequestComplete);
        on(SGL_LLM.REQUEST_ERROR,    this._onRequestDone);
        on(SGL_LLM.REQUEST_CANCEL,   this._onRequestDone);
    }

    _onSend(e) {
        const { messages = [], model = '' } = e.detail ?? {};
        this._pending      = _analyseMessages(messages);
        this._pendingModel = model;
        this._update();
    }

    _onRequestStart() {
        this._setBarPending(true);
    }

    _onRequestComplete(e) {
        const { promptTokens = 0, completionTokens = 0, model } = e.detail ?? {};
        const m = model || this._pendingModel;
        const cost = _estimateCost(m, promptTokens, completionTokens) ?? 0;

        const record = {
            model:            m,
            breakdown:        this._pending ?? { systemToks: 0, historyToks: 0, currentToks: 0, imageCount: 0, estimatedTotal: promptTokens },
            promptTokens,
            completionTokens,
            cost,
        };

        this._history.push(record);
        if (this._history.length > MAX_HISTORY) this._history.shift();

        this._session.promptTokens     += promptTokens;
        this._session.completionTokens += completionTokens;
        this._session.cost             += cost;
        this._session.requests         += 1;

        this._pending      = null;
        this._pendingModel = '';
        this._setBarPending(false);
        this._update();
    }

    _onRequestDone() {
        this._pending      = null;
        this._pendingModel = '';
        this._setBarPending(false);
        this._update();
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    _render() {
        this._shadow.innerHTML = `<style>${CSS}</style>
        <div class="tv-root" part="root">
            <div class="section" id="tv-current">
                <div class="section-title">Current Request</div>
                <div id="tv-req-content"><div style="color:#1e2035;font-size:10px;">Waiting for first request…</div></div>
            </div>
            <div class="section" id="tv-spark-section">
                <div class="section-title">Context Growth</div>
                <div class="sparkline-wrap" id="tv-sparkline-wrap">
                    <div class="spark-empty">No requests yet</div>
                </div>
            </div>
            <div class="section" id="tv-session-section">
                <div class="section-title">Session</div>
                <div class="sess-grid" id="tv-session-grid">
                    <div class="sess-item"><span class="sess-label">Requests</span><span class="sess-val accent-req" id="sess-req">0</span></div>
                    <div class="sess-item"><span class="sess-label">Total cost</span><span class="sess-val accent-cost" id="sess-cost">—</span></div>
                    <div class="sess-item"><span class="sess-label">Input tokens</span><span class="sess-val accent-in" id="sess-in">0</span></div>
                    <div class="sess-item"><span class="sess-label">Output tokens</span><span class="sess-val accent-out" id="sess-out">0</span></div>
                </div>
            </div>
            <div class="tv-actions">
                <button class="tv-btn" id="tv-clear">Clear</button>
            </div>
        </div>`;

        this._shadow.querySelector('#tv-clear').addEventListener('click', () => this.clear());
    }

    _update() {
        this._updateCurrentRequest();
        this._updateSparkline();
        this._updateSession();
    }

    _updateCurrentRequest() {
        const el = this._shadow.querySelector('#tv-req-content');
        if (!el) return;

        // Show last completed or current pending
        const last     = this._history[this._history.length - 1];
        const pending  = this._pending;
        const source   = last || (pending ? { breakdown: pending, model: this._pendingModel, promptTokens: null, completionTokens: null, cost: null } : null);

        if (!source) {
            el.innerHTML = '<div style="color:#1e2035;font-size:10px;">Waiting for first request…</div>';
            return;
        }

        const reqNum   = this._history.length + (pending ? 1 : 0);
        const model    = source.model || '—';
        const bd       = source.breakdown;
        const inToks   = source.promptTokens ?? bd.estimatedTotal;
        const outToks  = source.completionTokens ?? 0;
        const cost     = source.cost;
        const isEst    = source.promptTokens == null;

        // Stacked bar proportions
        const total = Math.max(bd.systemToks + bd.historyToks + bd.currentToks + bd.imageCount * IMG_TOKENS, 1);
        const segs   = [
            { key: 'system',  label: 'System',  val: bd.systemToks,  color: CLR.system },
            { key: 'history', label: 'History', val: bd.historyToks, color: CLR.history },
            { key: 'current', label: 'Current', val: bd.currentToks - bd.imageCount * IMG_TOKENS, color: CLR.current },
            { key: 'images',  label: 'Images',  val: bd.imageCount * IMG_TOKENS, color: CLR.images },
        ].filter(s => s.val > 0);

        const barSegs = segs.map(s =>
            `<div class="bar-seg" style="width:${(s.val/total*100).toFixed(1)}%;background:${s.color}" title="${s.label}: ${_fmt(s.val)} tokens"></div>`
        ).join('');

        const legend = segs.map(s =>
            `<div class="legend-item"><div class="legend-dot" style="background:${s.color}"></div>${s.label} <span class="legend-val">${_fmt(s.val)}</span></div>`
        ).join('');

        const inLabel  = isEst ? `~${_fmt(inToks)}` : _fmt(inToks);
        const costStr  = cost != null ? `$${cost.toFixed(4)}` : '—';
        const modelShort = model.split('/').pop();

        el.innerHTML = `
            <div class="req-header">
                <span class="req-num">Request #${reqNum}${isEst ? ' (estimating…)' : ''}</span>
                <span class="req-model" title="${model}">${modelShort}</span>
            </div>
            <div class="bar-wrap${isEst ? ' pending' : ''}">${barSegs || `<div class="bar-seg" style="width:100%;background:${CLR.unknown}"></div>`}</div>
            <div class="legend">${legend}</div>
            <div class="totals-row">
                <span class="totals-in">↑ ${inLabel}</span>
                <span class="totals-dot">·</span>
                <span class="totals-out">↓ ${_fmt(outToks)}</span>
                ${cost != null ? `<span class="totals-dot">·</span><span class="totals-cost">${costStr}</span>` : ''}
            </div>`;
    }

    _updateSparkline() {
        const wrap = this._shadow.querySelector('#tv-sparkline-wrap');
        if (!wrap) return;

        if (this._history.length < 2) {
            wrap.innerHTML = `<div class="spark-empty">${this._history.length === 1 ? 'One request — need more to show trend' : 'No requests yet'}</div>`;
            return;
        }

        const vals    = this._history.map(h => h.promptTokens);
        const max     = Math.max(...vals);
        const min     = Math.min(...vals, 0);
        const range   = max - min || 1;
        const W       = 200;
        const H       = 36;
        const n       = vals.length;

        const pts = vals.map((v, i) => {
            const x = n === 1 ? W / 2 : (i / (n - 1)) * W;
            const y = H - ((v - min) / range) * (H - 4) - 2;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');

        // Dot at last point
        const lastX = W;
        const lastY = H - ((vals[n-1] - min) / range) * (H - 4) - 2;

        const trend  = vals[n-1] > vals[0] ? '↑' : vals[n-1] < vals[0] ? '↓' : '→';
        const tcolor = vals[n-1] > vals[0] ? '#f87171' : vals[n-1] < vals[0] ? '#4ade80' : '#94a3b8';

        wrap.innerHTML = `
            <svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" height="${H}">
                <polyline points="${pts}" fill="none" stroke="#7c9ef8" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
                <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.5" fill="#7c9ef8"/>
            </svg>
            <div class="spark-label">
                <span>#${this._history.length - n + 1}: ${_fmt(vals[0])}</span>
                <span style="color:${tcolor}">${trend} ${_fmt(vals[n-1])}</span>
            </div>`;
    }

    _updateSession() {
        const s = this._session;
        _setText(this._shadow, '#sess-req',  String(s.requests));
        _setText(this._shadow, '#sess-in',   _fmt(s.promptTokens));
        _setText(this._shadow, '#sess-out',  _fmt(s.completionTokens));
        _setText(this._shadow, '#sess-cost', s.cost > 0 ? `$${s.cost.toFixed(4)}` : '—');
    }

    _setBarPending(on) {
        const bar = this._shadow.querySelector('.bar-wrap');
        if (bar) bar.classList.toggle('pending', on);
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

customElements.define('sg-llm-token-viz', SgLlmTokenViz);
window.SgLlmTokenViz = SgLlmTokenViz;

// ── Module helpers ──────────────────────────────────────────────────────────────

/**
 * Analyse a messages array and return a token breakdown estimate.
 * Separates system prompt, conversation history, current user message,
 * and image attachments.
 *
 * @param {Array<{role:string, content:string|Array}>} messages
 * @returns {{ systemToks:number, historyToks:number, currentToks:number, imageCount:number, estimatedTotal:number }}
 */
function _analyseMessages(messages) {
    let systemToks  = 0;
    let historyToks = 0;
    let currentToks = 0;
    let imageCount  = 0;

    // Index of the last user message — treated as "current"
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }

    for (let i = 0; i < messages.length; i++) {
        const msg     = messages[i];
        const content = msg.content;
        const isLast  = i === lastUserIdx;

        if (msg.role === 'system') {
            systemToks += _estimateTokens(content);
            continue;
        }

        if (msg.role === 'assistant') {
            historyToks += _estimateTokens(content);
            continue;
        }

        if (msg.role === 'user') {
            let msgToks = 0;
            let imgs    = 0;
            if (Array.isArray(content)) {
                for (const part of content) {
                    if (part.type === 'text') {
                        msgToks += _estimateTokens(part.text);
                    } else if (part.type === 'image_url') {
                        imgs++;
                        msgToks += IMG_TOKENS;
                    }
                }
            } else {
                msgToks += _estimateTokens(content);
            }
            imageCount += imgs;
            if (isLast) {
                currentToks += msgToks;
            } else {
                historyToks += msgToks;
            }
        }
    }

    return {
        systemToks,
        historyToks,
        currentToks,
        imageCount,
        estimatedTotal: systemToks + historyToks + currentToks,
    };
}

/**
 * Rough token estimate: ~4 characters per token.
 * @param {string|Array|null} content
 * @returns {number}
 */
function _estimateTokens(content) {
    if (!content) return 0;
    if (Array.isArray(content)) {
        return content.reduce((sum, p) => sum + _estimateTokens(p.text ?? p.content ?? ''), 0);
    }
    return Math.ceil(String(content).length / 4);
}

/**
 * Estimate cost from model name + token counts.
 * Strips provider prefix (e.g. "openai/gpt-4o" → "gpt-4o").
 * Returns null if model is not in the pricing table.
 *
 * @param {string} model
 * @param {number} promptTokens
 * @param {number} completionTokens
 * @returns {number|null}
 */
function _estimateCost(model, promptTokens, completionTokens) {
    const key = (model || '').split('/').pop().toLowerCase();
    const p   = MODEL_PRICING[key];
    if (!p) return null;
    return (promptTokens / 1_000_000) * p[0] + (completionTokens / 1_000_000) * p[1];
}

/**
 * Format a token count with thousands separators.
 * @param {number} n
 * @returns {string}
 */
function _fmt(n) {
    if (!n && n !== 0) return '—';
    return Number(n).toLocaleString();
}

/**
 * Set text content of a shadow DOM element by selector.
 * @param {ShadowRoot} shadow
 * @param {string} sel
 * @param {string} text
 */
function _setText(shadow, sel, text) {
    const el = shadow.querySelector(sel);
    if (el) el.textContent = text;
}
