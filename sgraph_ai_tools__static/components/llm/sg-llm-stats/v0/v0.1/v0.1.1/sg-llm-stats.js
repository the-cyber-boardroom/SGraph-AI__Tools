/**
 * sg-llm-stats — Token accounting and cost tracking panel.
 *
 * The accountant's view. Shows per-request metrics and running session totals.
 * Also provides the streaming toggle that controls sg-llm-request behaviour.
 *
 * Displays:
 *   - Pre-send token estimate (from REALITY_CHANGED — before the request fires)
 *   - Last request: prompt tokens in, completion tokens out, cost ($), speed (tok/s), latency (ms)
 *   - Session totals: accumulated across all requests in the page lifetime
 *   - Streaming toggle: checkbox emitting STREAMING_CHANGED
 *
 * Consumes (on parentElement):
 *   llm:reality-changed    — { tokenCount } — updates pre-send estimate
 *   llm:request-start      — { tokenEstimate } — shows "sending…" state
 *   llm:request-complete   — { promptTokens, completionTokens, cost, latencyMs } — updates metrics
 *   llm:request-error      — clears the in-flight state
 *   llm:request-cancel     — clears the in-flight state
 *
 * Emits (on parentElement):
 *   llm:streaming-changed  — { streaming: boolean }
 *
 * @module sg-llm-stats
 * @version 0.1.1
 *
 * Changelog:
 *   v0.1.1: _bus() updated to walk [data-llm-bus] ancestor for sg-layout panel compatibility (backwards compatible).
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.stats-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0a0a18;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #e2e8f0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #222d4d transparent;
}

/* ── Section ──────────────────────────── */
.section {
    padding: 12px 14px;
    border-bottom: 1px solid #1e2a45;
}
.section-title {
    font-size: 11px;
    font-weight: 600;
    color: #4a5568;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 8px;
}

/* ── Estimate row ─────────────────────── */
.estimate-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
}
.estimate-tok  { font-size: 22px; font-weight: 700; color: #7c9ef8; line-height: 1; }
.estimate-unit { font-size: 12px; color: #4a5568; }
.estimate-hint { font-size: 11px; color: #4a5568; margin-top: 4px; }
.sending-indicator { font-size: 12px; color: #f59e0b; margin-top: 4px; }
.sending-indicator.hidden { display: none; }

/* ── Metric grid ──────────────────────── */
.metric-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 12px;
}
.metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.metric-label { font-size: 10px; color: #4a5568; text-transform: uppercase; letter-spacing: 0.05em; }
.metric-value { font-size: 15px; font-weight: 600; color: #e2e8f0; }
.metric-value.cost   { color: #4ade80; }
.metric-value.speed  { color: #7c9ef8; }
.metric-value.empty  { color: #2d3f5e; }

/* ── Session totals ───────────────────── */
.totals-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 0;
}
.totals-label { font-size: 12px; color: #64748b; }
.totals-value { font-size: 13px; font-weight: 600; color: #a0aec0; }
.totals-cost  { color: #4ade80; }
.requests-badge {
    display: inline-block;
    background: #0d1a2e;
    border: 1px solid #1e2a45;
    border-radius: 10px;
    font-size: 10px;
    color: #4a5568;
    padding: 1px 7px;
}

/* ── Streaming toggle ─────────────────── */
.toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
}
.toggle-label { font-size: 13px; color: #a0aec0; }
.toggle-hint  { font-size: 11px; color: #4a5568; margin-top: 2px; }

.toggle-switch {
    position: relative;
    width: 36px;
    height: 20px;
    flex-shrink: 0;
}
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
    position: absolute;
    inset: 0;
    background: #1e2a45;
    border-radius: 20px;
    cursor: pointer;
    transition: background 0.2s;
}
.toggle-slider:before {
    content: '';
    position: absolute;
    width: 14px;
    height: 14px;
    left: 3px;
    top: 3px;
    background: #4a5568;
    border-radius: 50%;
    transition: transform 0.2s, background 0.2s;
}
.toggle-switch input:checked + .toggle-slider { background: #1e3a8a; }
.toggle-switch input:checked + .toggle-slider:before { transform: translateX(16px); background: #7c9ef8; }
`;

export class SgLlmStats extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        /** Pre-send token estimate (from REALITY_CHANGED) */
        this._estimatedTokens = 0;

        /** Whether a request is currently in flight */
        this._busy = false;

        /** Metrics for the last completed request */
        this._last = {
            promptTokens:     0,
            completionTokens: 0,
            cost:             0,
            latencyMs:        0,
            tokensPerSec:     0,
        };

        /** Session-wide running totals */
        this._session = {
            requests:         0,
            promptTokens:     0,
            completionTokens: 0,
            cost:             0,
        };

        this._streaming = true;
        this._boundHandlers = {};
    }

    connectedCallback() {
        this._render();
        this._bindLlmEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [event, handler] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(event, handler);
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────

    _render() {
        this.shadowRoot.innerHTML = `
            <style>${STYLES}</style>
            <div class="stats-root">

                <!-- Pre-send estimate -->
                <div class="section">
                    <div class="section-title">Pre-send estimate</div>
                    <div class="estimate-row">
                        <span class="estimate-tok" id="est-tok">0</span>
                        <span class="estimate-unit">tokens</span>
                    </div>
                    <div class="estimate-hint" id="est-hint">Add blocks to see token count</div>
                    <div class="sending-indicator hidden" id="sending-ind">⟳ Sending…</div>
                </div>

                <!-- Last request -->
                <div class="section">
                    <div class="section-title">Last request</div>
                    <div class="metric-grid">
                        <div class="metric">
                            <span class="metric-label">Prompt tokens</span>
                            <span class="metric-value empty" id="last-prompt">—</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Completion</span>
                            <span class="metric-value empty" id="last-completion">—</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Cost</span>
                            <span class="metric-value cost empty" id="last-cost">—</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Latency</span>
                            <span class="metric-value empty" id="last-latency">—</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Speed</span>
                            <span class="metric-value speed empty" id="last-speed">—</span>
                        </div>
                    </div>
                </div>

                <!-- Session totals -->
                <div class="section">
                    <div class="section-title">Session totals <span class="requests-badge" id="req-badge">0 requests</span></div>
                    <div class="totals-row">
                        <span class="totals-label">Prompt tokens</span>
                        <span class="totals-value" id="sess-prompt">0</span>
                    </div>
                    <div class="totals-row">
                        <span class="totals-label">Completion tokens</span>
                        <span class="totals-value" id="sess-completion">0</span>
                    </div>
                    <div class="totals-row">
                        <span class="totals-label">Total cost</span>
                        <span class="totals-value totals-cost" id="sess-cost">$0.0000</span>
                    </div>
                </div>

                <!-- Streaming toggle -->
                <div class="toggle-row">
                    <div>
                        <div class="toggle-label">Streaming</div>
                        <div class="toggle-hint">Show tokens as they arrive</div>
                    </div>
                    <label class="toggle-switch" title="Toggle streaming">
                        <input type="checkbox" id="streaming-toggle" checked>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

            </div>`;

        this.shadowRoot.getElementById('streaming-toggle').addEventListener('change', (e) => {
            this._streaming = e.target.checked;
            this._emitLlm(SGL_LLM.STREAMING_CHANGED, { streaming: this._streaming });
        });
    }

    // ── LLM event handling ─────────────────────────────────────────────────

    _bindLlmEvents() {
        const bus = this._bus();

        const on = (event, handler) => {
            const bound = handler.bind(this);
            this._boundHandlers[event] = bound;
            bus.addEventListener(event, bound);
        };

        on(SGL_LLM.REALITY_CHANGED,  this._onRealityChanged);
        on(SGL_LLM.REQUEST_START,    this._onRequestStart);
        on(SGL_LLM.REQUEST_COMPLETE, this._onRequestComplete);
        on(SGL_LLM.REQUEST_ERROR,    this._onRequestError);
        on(SGL_LLM.REQUEST_CANCEL,   this._onRequestCancel);
    }

    _onRealityChanged(e) {
        this._estimatedTokens = e.detail?.tokenCount ?? 0;
        this._updateEstimate();
    }

    _onRequestStart() {
        this._busy = true;
        this.shadowRoot.getElementById('sending-ind')?.classList.remove('hidden');
        this.shadowRoot.getElementById('est-hint')?.classList.add('hidden');
    }

    _onRequestComplete(e) {
        this._busy = false;
        const d = e.detail || {};

        const prompt     = d.promptTokens     ?? 0;
        const completion = d.completionTokens ?? 0;
        const cost       = d.cost             ?? 0;
        const latency    = d.latencyMs        ?? 0;
        const speed      = latency > 0 ? Math.round((completion / latency) * 1000) : 0;

        this._last = { promptTokens: prompt, completionTokens: completion, cost, latencyMs: latency, tokensPerSec: speed };

        this._session.requests++;
        this._session.promptTokens     += prompt;
        this._session.completionTokens += completion;
        this._session.cost             += cost;

        this._updateLastRequest();
        this._updateSessionTotals();

        this.shadowRoot.getElementById('sending-ind')?.classList.add('hidden');
        this.shadowRoot.getElementById('est-hint')?.classList.remove('hidden');
    }

    _onRequestError() {
        this._busy = false;
        this.shadowRoot.getElementById('sending-ind')?.classList.add('hidden');
        this.shadowRoot.getElementById('est-hint')?.classList.remove('hidden');
    }

    _onRequestCancel() {
        this._onRequestError();
    }

    // ── Display updates ────────────────────────────────────────────────────

    _updateEstimate() {
        const root = this.shadowRoot;
        const tok = this._estimatedTokens;

        const tokEl  = root.getElementById('est-tok');
        const hint   = root.getElementById('est-hint');
        if (tokEl) tokEl.textContent = tok.toLocaleString();
        if (hint)  hint.textContent  = tok > 0 ? 'estimated input tokens' : 'Add blocks to see token count';
    }

    _updateLastRequest() {
        const root = this.shadowRoot;
        const l = this._last;

        _setMetric(root, 'last-prompt',     l.promptTokens.toLocaleString());
        _setMetric(root, 'last-completion',  l.completionTokens.toLocaleString());
        _setMetric(root, 'last-cost',       `$${l.cost.toFixed(4)}`);
        _setMetric(root, 'last-latency',    `${l.latencyMs} ms`);
        _setMetric(root, 'last-speed',      l.tokensPerSec > 0 ? `${l.tokensPerSec} tok/s` : '—');
    }

    _updateSessionTotals() {
        const root = this.shadowRoot;
        const s = this._session;

        _setText(root, 'sess-prompt',     s.promptTokens.toLocaleString());
        _setText(root, 'sess-completion', s.completionTokens.toLocaleString());
        _setText(root, 'sess-cost',      `$${s.cost.toFixed(4)}`);
        _setText(root, 'req-badge',      `${s.requests} request${s.requests === 1 ? '' : 's'}`);
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }

    _emitLlm(eventName, detail) {
        this._bus().dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }

    /**
     * Returns a snapshot of current stats (for bundle capture).
     * @returns {{ last: object, session: object, streaming: boolean }}
     */
    getStats() {
        return {
            last:      { ...this._last },
            session:   { ...this._session },
            streaming: this._streaming,
        };
    }
}

customElements.define('sg-llm-stats', SgLlmStats);
window.SgLlmStats = SgLlmStats;

// ── Utilities ─────────────────────────────────────────────────────────────────

function _setText(root, id, text) {
    const el = root.getElementById(id);
    if (el) el.textContent = text;
}

function _setMetric(root, id, text) {
    const el = root.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('empty');
}
