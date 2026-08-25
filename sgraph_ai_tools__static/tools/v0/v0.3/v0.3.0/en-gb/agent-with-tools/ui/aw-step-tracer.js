/**
 * aw-step-tracer — Event audit log with expand/filter/clear.
 *
 * Subscribes to key bus events and shows each as a timestamped row.
 * Click a row to expand the full detail JSON.
 * Filter chips per category: LLM / Bridge / Tool.
 *
 * @module aw-step-tracer
 * @version 0.1.58
 */

const TRACED = [
    'llm:chat-message', 'llm:send', 'llm:request-start',
    'llm:request-complete', 'llm:tool-calls', 'llm:tool-calls-extracted',
    'llm:tool-results-complete', 'llm:response-complete',
    'sg-local-bridge:status', 'sg-local-bridge:tool-call', 'sg-local-bridge:error',
    'llm:connected',
];

// Category membership for filter chips
const CAT = {
    LLM:    new Set(['llm:chat-message','llm:send','llm:request-start','llm:request-complete',
                     'llm:response-complete','llm:connected']),
    Bridge: new Set(['sg-local-bridge:status','sg-local-bridge:tool-call','sg-local-bridge:error']),
    Tool:   new Set(['llm:tool-calls','llm:tool-calls-extracted','llm:tool-results-complete']),
};

const CSS = `
:host { display:flex; flex-direction:column; height:100%; overflow:hidden;
        background:#0d0d1a; font-family:system-ui,sans-serif; font-size:11px; }
.toolbar { display:flex; align-items:center; gap:6px; padding:5px 8px;
           border-bottom:1px solid #1a1a3a; flex-shrink:0; flex-wrap:wrap; }
.chip { padding:2px 8px; border-radius:10px; border:1px solid #2d3060;
        color:#94a3b8; cursor:pointer; background:none; font-size:10px; }
.chip.active { border-color:#7c9ef8; color:#7c9ef8; background:#0f1733; }
.clear-btn { margin-left:auto; background:none; border:1px solid #2d3060;
    color:#94a3b8; border-radius:4px; padding:2px 8px; cursor:pointer; font-size:10px; }
.clear-btn:hover { border-color:#7c9ef8; color:#e2e8f0; }
.log { flex:1; overflow-y:auto; padding:4px 6px; }
.row { padding:3px 4px; border-radius:3px; cursor:pointer; line-height:1.4;
       border-left:2px solid transparent; margin-bottom:1px; }
.row:hover { background:#111128; }
.row.expanded { background:#111128; border-left-color:#7c9ef8; }
.row.cat-LLM    { border-left-color:#2d3060; }
.row.cat-Bridge { border-left-color:#064e3b; }
.row.cat-Tool   { border-left-color:#3b1f6e; }
.row.cat-LLM.expanded    { border-left-color:#7c9ef8; }
.row.cat-Bridge.expanded { border-left-color:#22c55e; }
.row.cat-Tool.expanded   { border-left-color:#a78bfa; }
.ts   { color:#475569; margin-right:4px; }
.evt  { color:#94a3b8; }
.evt.cat-LLM    { color:#7c9ef8; }
.evt.cat-Bridge { color:#22c55e; }
.evt.cat-Tool   { color:#a78bfa; }
.detail { font-family:monospace; font-size:10px; color:#64748b; white-space:pre-wrap;
          word-break:break-all; margin-top:4px; padding:4px;
          background:#0a0a18; border-radius:3px; max-height:160px; overflow-y:auto; }
.hidden { display:none; }
`;

export class AwStepTracer extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._active = new Set(['LLM', 'Bridge', 'Tool']);
        this._chunkCounts = {};
        this._rows = [];
    }

    connectedCallback() {
        if (this._init) return;
        this._init = true;
        this._render();
        const bus = this._bus();
        for (const evtName of TRACED) {
            bus.addEventListener(evtName, (e) => this._onEvent(evtName, e));
        }
        // Throttle chunk events
        bus.addEventListener('llm:request-chunk', () => {
            this._chunkCounts['llm:request-chunk'] = (this._chunkCounts['llm:request-chunk'] ?? 0) + 1;
            if (this._chunkCounts['llm:request-chunk'] % 10 === 0) {
                this._addRow('llm:request-chunk', `chunk #${this._chunkCounts['llm:request-chunk']}`, null);
            }
        });
    }

    _render() {
        this.shadowRoot.innerHTML = `<style>${CSS}</style>
        <div class="toolbar">
            <button class="chip active" data-cat="LLM">LLM</button>
            <button class="chip active" data-cat="Bridge">Bridge</button>
            <button class="chip active" data-cat="Tool">Tool</button>
            <button class="clear-btn">Clear</button>
        </div>
        <div class="log"></div>`;

        this.shadowRoot.querySelectorAll('.chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const cat = btn.dataset.cat;
                if (this._active.has(cat)) { this._active.delete(cat); btn.classList.remove('active'); }
                else { this._active.add(cat); btn.classList.add('active'); }
                this._applyFilter();
            });
        });
        this.shadowRoot.querySelector('.clear-btn').addEventListener('click', () => {
            this._rows = [];
            this.shadowRoot.querySelector('.log').innerHTML = '';
        });
    }

    _onEvent(evtName, e) {
        const cat = _catOf(evtName);
        const detail = e.detail ?? null;
        this._addRow(evtName, null, detail, cat);
    }

    _addRow(evtName, label, detail, cat) {
        cat = cat ?? _catOf(evtName);
        const log = this.shadowRoot.querySelector('.log');
        const now = new Date();
        const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
        const row = document.createElement('div');
        row.className = `row cat-${cat}${this._active.has(cat) ? '' : ' hidden'}`;
        const detailStr = label ?? (detail !== null ? JSON.stringify(detail, null, 2) : '—');
        const catCls = `evt cat-${cat}`;
        row.innerHTML = `<span class="ts">[${ts}]</span><span class="${catCls}">${evtName}</span>
            <div class="detail hidden">${_esc(detailStr)}</div>`;
        row.addEventListener('click', () => {
            row.classList.toggle('expanded');
            row.querySelector('.detail').classList.toggle('hidden');
        });
        log.appendChild(row);
        this._rows.push({ el: row, cat });
        // Auto-scroll
        log.scrollTop = log.scrollHeight;
    }

    _applyFilter() {
        for (const { el, cat } of this._rows) {
            el.classList.toggle('hidden', !this._active.has(cat));
        }
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }
}

function _catOf(evtName) {
    for (const [cat, set] of Object.entries(CAT)) { if (set.has(evtName)) return cat; }
    return 'LLM';
}

function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

customElements.define('aw-step-tracer', AwStepTracer);
