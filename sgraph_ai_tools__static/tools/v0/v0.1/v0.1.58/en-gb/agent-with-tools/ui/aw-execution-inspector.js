/**
 * aw-execution-inspector — Shows pending tool calls as cards.
 *
 * Auto mode (default): shows cards briefly, lets llm:tool-calls pass through.
 * Manual mode: captures llm:tool-calls, holds them, re-fires only on approval.
 *
 * @module aw-execution-inspector
 * @version 0.1.58
 */

const CSS = `
:host { display:flex; flex-direction:column; height:100%; overflow:hidden;
        background:#0d0d1a; font-family:system-ui,sans-serif; font-size:12px; }
.toolbar { display:flex; align-items:center; gap:8px; padding:6px 8px;
           border-bottom:1px solid #1a1a3a; flex-shrink:0; }
.toolbar label { color:#94a3b8; display:flex; align-items:center; gap:4px; cursor:pointer; }
.toolbar input[type=checkbox] { accent-color:#7c9ef8; }
.toolbar .clear-btn { margin-left:auto; background:none; border:1px solid #2d3060;
    color:#94a3b8; border-radius:4px; padding:2px 8px; cursor:pointer; font-size:11px; }
.toolbar .clear-btn:hover { border-color:#7c9ef8; color:#e2e8f0; }
.cards { flex:1; overflow-y:auto; padding:6px; display:flex; flex-direction:column; gap:6px; }
.card { background:#111128; border:1px solid #2d3060; border-radius:6px; padding:8px; }
.card.running { border-color:#7c9ef8; }
.card.done    { border-color:#22c55e; opacity:0.7; }
.card.error   { border-color:#ef4444; }
.card.skipped { border-color:#374151; opacity:0.5; }
.card-head { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
.card-name { font-family:monospace; color:#7c9ef8; font-weight:600; flex:1; }
.badge { font-size:10px; padding:1px 6px; border-radius:10px; }
.badge.pending  { background:#2d3060; color:#94a3b8; }
.badge.running  { background:#1e3a8a; color:#7c9ef8; }
.badge.done     { background:#14532d; color:#22c55e; }
.badge.error    { background:#7f1d1d; color:#ef4444; }
.badge.skipped  { background:#1f2937; color:#6b7280; }
.card-args { font-family:monospace; font-size:10px; color:#64748b;
             white-space:pre-wrap; word-break:break-all; max-height:60px;
             overflow-y:auto; margin-bottom:6px; }
.card-actions { display:flex; gap:6px; }
.btn { font-size:11px; padding:2px 10px; border-radius:4px; cursor:pointer;
       border:1px solid #2d3060; background:none; color:#94a3b8; }
.btn.run  { border-color:#7c9ef8; color:#7c9ef8; }
.btn.run:hover  { background:#1e3a8a; }
.btn.skip:hover { background:#1f2937; }
.run-all  { margin-left:auto; border-color:#22c55e; color:#22c55e; }
.run-all:hover  { background:#14532d; }
.empty { color:#374151; text-align:center; padding:20px; }
`;

export class AwExecutionInspector extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._autoExec = true;
        this._cards = new Map(); // id → { call, el, state }
    }

    connectedCallback() {
        if (this._init) return;
        this._init = true;
        this._render();
        const bus = this._bus();

        // Capture phase — intercept llm:tool-calls in manual mode
        bus.addEventListener('llm:tool-calls', (e) => {
            if (e._fromInspector) return;
            const { toolCalls } = e.detail ?? {};
            if (!toolCalls?.length) return;
            this._showCards(toolCalls);
            if (!this._autoExec) {
                e.stopImmediatePropagation();
                this._pendingEvent = e;
            }
        }, true);

        // Mark cards done when bridge fires (success path only — no event on HTTP errors)
        bus.addEventListener('sg-local-bridge:tool-call', (e) => {
            const { name, result } = e.detail ?? {};
            this._resolveCard(name, result?.error ? 'error' : 'done');
        });

        // Fallback: sg-tool-runner fires llm:tool-result for EVERY result including errors
        bus.addEventListener('llm:tool-result', (e) => {
            const { name, error } = e.detail ?? {};
            this._resolveCard(name, error ? 'error' : 'done');
        });
    }

    _render() {
        this.shadowRoot.innerHTML = `<style>${CSS}</style>
        <div class="toolbar">
            <label><input type="checkbox" id="auto" checked> Auto-execute</label>
            <button class="clear-btn">Clear</button>
        </div>
        <div class="cards"><p class="empty">No pending tool calls</p></div>`;

        this.shadowRoot.querySelector('#auto').addEventListener('change', (e) => {
            this._autoExec = e.target.checked;
        });
        this.shadowRoot.querySelector('.clear-btn').addEventListener('click', () => {
            this._cards.clear();
            this._refreshEmpty();
        });
    }

    _showCards(toolCalls) {
        const container = this.shadowRoot.querySelector('.cards');
        const empty = container.querySelector('.empty');
        if (empty) empty.remove();

        for (const call of toolCalls) {
            const id = call.id ?? `call_${Date.now()}_${Math.random()}`;
            if (this._cards.has(id)) continue;
            const el = document.createElement('div');
            el.className = 'card';
            const args = (() => { try { return JSON.stringify(JSON.parse(call.function?.arguments ?? '{}'), null, 2); } catch { return call.function?.arguments ?? ''; } })();
            el.innerHTML = `
                <div class="card-head">
                    <span class="card-name">${call.function?.name ?? '?'}</span>
                    <span class="badge pending">pending</span>
                </div>
                <div class="card-args">${args}</div>
                <div class="card-actions">
                    <button class="btn run">Run</button>
                    <button class="btn skip">Skip</button>
                    <button class="btn run-all run">Run All</button>
                </div>`;
            const card = { call, el, state: 'pending' };
            this._cards.set(id, card);
            container.appendChild(el);

            if (!this._autoExec) {
                el.querySelector('.btn.run:not(.run-all)').addEventListener('click', () => this._runOne(id, card));
                el.querySelector('.btn.skip').addEventListener('click', () => this._skipOne(id, card));
                el.querySelector('.run-all').addEventListener('click', () => this._runAll());
            } else {
                // hide buttons in auto mode
                el.querySelector('.card-actions').style.display = 'none';
                this._setCardState(card, 'running');
                // cards auto-clear after 4s
                setTimeout(() => { el.remove(); this._cards.delete(id); this._refreshEmpty(); }, 4000);
            }
        }
    }

    _runOne(id, card) {
        this._setCardState(card, 'running');
        const bus = this._bus();
        const ev = new CustomEvent('llm:tool-calls', {
            detail: { toolCalls: [card.call], messages: [] },
            bubbles: true, composed: true,
        });
        ev._fromInspector = true;
        bus.dispatchEvent(ev);
    }

    _skipOne(id, card) {
        this._setCardState(card, 'skipped');
    }

    _runAll() {
        for (const [id, card] of this._cards) {
            if (card.state === 'pending') this._runOne(id, card);
        }
    }

    _setCardState(card, state) {
        card.state = state;
        card.el.className = `card ${state}`;
        const badge = card.el.querySelector('.badge');
        badge.className = `badge ${state}`;
        badge.textContent = state;
    }

    _resolveCard(name, state) {
        for (const [, card] of this._cards) {
            if (card.call.function?.name === name && card.state === 'running') {
                this._setCardState(card, state);
                break;
            }
        }
    }

    _refreshEmpty() {
        const container = this.shadowRoot.querySelector('.cards');
        if (container.children.length === 0) {
            const p = document.createElement('p');
            p.className = 'empty';
            p.textContent = 'No pending tool calls';
            container.appendChild(p);
        }
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }
}

customElements.define('aw-execution-inspector', AwExecutionInspector);
