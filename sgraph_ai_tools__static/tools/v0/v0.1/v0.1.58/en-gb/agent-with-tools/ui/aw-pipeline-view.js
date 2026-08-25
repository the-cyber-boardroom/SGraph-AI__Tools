/**
 * aw-pipeline-view — Pipeline stage indicator: EXTRACT → VALIDATE → QUEUE → EXECUTE → DONE.
 *
 * Lights up each stage when the corresponding bus event fires.
 * Dims again after 3000 ms. Shows last tool name and iteration count below.
 *
 * @module aw-pipeline-view
 * @version 0.1.58
 */

const STAGES = ['EXTRACT', 'VALIDATE', 'QUEUE', 'EXECUTE', 'DONE'];

/** Maps bus event name → stage index. */
const EVT_STAGE = {
    'llm:request-complete':        0,
    'llm:tool-calls-extracted':    1,
    'llm:tool-calls':              2,
    'sg-local-bridge:tool-call':   3,
    'llm:tool-results-complete':   4,
};

const CSS = `
:host { display:flex; flex-direction:column; align-items:center; justify-content:center;
        height:100%; background:#0d0d1a; font-family:system-ui,sans-serif;
        padding:8px 4px; box-sizing:border-box; }
.stages { display:flex; align-items:center; gap:0; }
.stage { display:flex; flex-direction:column; align-items:center; gap:3px; }
.circle { width:28px; height:28px; border-radius:50%; display:flex; align-items:center;
          justify-content:center; font-size:8px; font-weight:700; text-transform:uppercase;
          transition:background 0.2s, color 0.2s;
          background:#12122a; border:1px solid #2d3060; color:#475569; }
.circle.active { background:#7c9ef8; color:#0a0a18; border-color:#7c9ef8; }
.label { font-size:7px; color:#475569; text-transform:uppercase; letter-spacing:0.5px; }
.arrow { color:#2d3060; font-size:14px; margin:0 1px; padding-bottom:12px; }
.status { margin-top:8px; font-size:10px; color:#64748b; text-align:center;
          min-height:14px; max-width:200px; overflow:hidden; text-overflow:ellipsis;
          white-space:nowrap; }
`;

export class AwPipelineView extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._timers = new Array(STAGES.length).fill(null);
        this._lastTool = '';
        this._iter = 0;
    }

    connectedCallback() {
        if (this._init) return;
        this._init = true;
        this._render();
        const bus = this._bus();

        for (const [evtName, idx] of Object.entries(EVT_STAGE)) {
            bus.addEventListener(evtName, (e) => this._activate(idx, evtName, e));
        }

        bus.addEventListener('llm:chat-message', () => {
            this._iter = 0;
            this._lastTool = '';
            this._updateStatus();
        });
    }

    _render() {
        const stagesHtml = STAGES.map((name, i) => {
            const abbr = name.slice(0, 3);
            const arrow = i < STAGES.length - 1 ? '<span class="arrow">›</span>' : '';
            return `<div class="stage">
                        <div class="circle" data-idx="${i}">${abbr}</div>
                        <span class="label">${name}</span>
                    </div>${arrow}`;
        }).join('');

        this.shadowRoot.innerHTML = `<style>${CSS}</style>
        <div class="stages">${stagesHtml}</div>
        <div class="status">idle</div>`;
    }

    _activate(idx, evtName, e) {
        // Track last tool from bridge event
        if (evtName === 'sg-local-bridge:tool-call') {
            this._lastTool = e.detail?.name ?? this._lastTool;
        }
        // Track iterations from tool-results-complete
        if (evtName === 'llm:tool-results-complete') {
            this._iter += 1;
        }

        const circle = this.shadowRoot.querySelector(`.circle[data-idx="${idx}"]`);
        if (!circle) return;
        circle.classList.add('active');

        if (this._timers[idx]) clearTimeout(this._timers[idx]);
        this._timers[idx] = setTimeout(() => {
            circle.classList.remove('active');
            this._timers[idx] = null;
        }, 3000);

        this._updateStatus();
    }

    _updateStatus() {
        const el = this.shadowRoot.querySelector('.status');
        if (!el) return;
        if (!this._lastTool && this._iter === 0) { el.textContent = 'idle'; return; }
        const parts = [];
        if (this._lastTool) parts.push(`last: ${this._lastTool}`);
        if (this._iter > 0)  parts.push(`iter ${this._iter}`);
        el.textContent = parts.join(' · ');
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }
}

customElements.define('aw-pipeline-view', AwPipelineView);
