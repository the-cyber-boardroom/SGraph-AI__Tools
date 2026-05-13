/**
 * aw-llm-log — Persistent log of every LLM request and response.
 *
 * Captures:
 *   llm:send            → records the full messages array + tools sent to the LLM
 *   llm:request-complete → pairs with most recent pending request, stores response
 *   llm:request-error    → pairs with most recent pending request, stores error
 *
 * Each entry shows: seq#, time, model, N messages, status.
 * Click to expand full request (messages array) and response body.
 *
 * @module aw-llm-log
 * @version 0.1.58
 */

const CSS = `
:host { display:flex; flex-direction:column; height:100%; overflow:hidden;
        background:#0d0d1a; font-family:system-ui,sans-serif; font-size:12px; color:#94a3b8; }
.ll-toolbar {
    display:flex; align-items:center; gap:8px; padding:6px 8px;
    border-bottom:1px solid #1a1a3a; flex-shrink:0; background:#0d0d1a;
}
.ll-title { font-size:10px; font-weight:700; text-transform:uppercase;
            letter-spacing:.06em; color:#4a5568; flex:1; }
.ll-count { font-size:10px; color:#475569; font-family:monospace; }
.ll-clear  { background:none; border:1px solid #2d3060; color:#94a3b8;
             border-radius:4px; padding:2px 8px; cursor:pointer; font-size:11px; }
.ll-clear:hover { border-color:#7c9ef8; color:#e2e8f0; }
.ll-body { flex:1; overflow-y:auto; scrollbar-width:thin; scrollbar-color:#1a1a3a transparent; }
.ll-empty { color:#2a2a4a; text-align:center; padding:24px; font-size:11px; }
.ll-row {
    border-bottom:1px solid #11111e;
    cursor:pointer; user-select:none;
}
.ll-row:hover { background:#0f0f22; }
.ll-head {
    display:flex; align-items:center; gap:6px;
    padding:5px 8px; font-family:monospace; font-size:11px;
}
.ll-seq   { color:#2d3060; min-width:26px; text-align:right; }
.ll-time  { color:#374151; min-width:64px; }
.ll-model { color:#7c9ef8; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ll-msgs  { color:#475569; min-width:44px; text-align:right; }
.ll-st-pending { color:#64748b; min-width:44px; text-align:center; font-size:10px; }
.ll-st-done    { color:#22c55e; min-width:44px; text-align:center; }
.ll-st-error   { color:#ef4444; min-width:44px; text-align:center; }
.ll-arrow { color:#374151; margin-left:4px; font-size:10px; transition:transform .15s; }
.ll-detail {
    display:none; padding:4px 8px 8px 36px;
    border-top:1px solid #11111e; background:#080810;
}
.ll-row.open .ll-arrow  { transform:rotate(90deg); }
.ll-row.open .ll-detail { display:block; }
.ll-section { margin-bottom:6px; }
.ll-label {
    font-size:10px; font-weight:600; text-transform:uppercase;
    letter-spacing:.05em; color:#374151; margin-bottom:3px;
    display:flex; align-items:center; gap:6px;
}
.ll-badge {
    font-size:9px; padding:1px 5px; border-radius:8px;
    background:#1e1e3a; color:#475569; font-weight:400; letter-spacing:0;
}
.ll-pre {
    font-family:monospace; font-size:10px; color:#64748b;
    background:#0d0d1a; border:1px solid #1e1e3a; border-radius:3px;
    padding:6px 8px; white-space:pre-wrap; word-break:break-all;
    max-height:200px; overflow-y:auto;
}
.ll-pre.resp { border-color:#1a2a4a; color:#94a3b8; }
.ll-pre.err  { border-color:#7f1d1d; color:#fca5a5; }
`;

export class AwLlmLog extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._entries = [];
        this._seq = 0;
        this._pending = null; // most recent entry awaiting response
    }

    connectedCallback() {
        if (this._init) return;
        this._init = true;
        this._render();
        const bus = this._bus();

        // Capture the FINAL llm:send (after tool-injection middleware adds tools:[])
        // Listening in bubble phase means we see the _toolsInjected = true re-fired event.
        bus.addEventListener('llm:send', (e) => {
            if (!e._toolsInjected) return; // only log the enriched version
            const { messages = [], model = '', provider = '', tools = [] } = e.detail ?? {};
            const entry = {
                seq:      ++this._seq,
                ts:       new Date(),
                model:    model || provider || 'unknown',
                msgs:     messages,
                toolDefs: tools,
                response: null,
                error:    null,
                status:   'pending',
                rowEl:    null,
            };
            this._entries.push(entry);
            this._pending = entry;
            entry.rowEl = this._makeRow(entry);
            const body = this.shadowRoot.getElementById('ll-body');
            const empty = body.querySelector('.ll-empty');
            if (empty) empty.remove();
            body.appendChild(entry.rowEl);
            body.scrollTop = body.scrollHeight;
            this._refreshCount();
        });

        bus.addEventListener('llm:request-complete', (e) => {
            const entry = this._pending;
            if (!entry || entry.status !== 'pending') return;
            entry.response = e.detail?.content ?? '';
            entry.status   = 'done';
            this._pending  = null;
            this._updateRowStatus(entry);
        });

        bus.addEventListener('llm:request-error', (e) => {
            const entry = this._pending;
            if (!entry || entry.status !== 'pending') return;
            entry.error  = e.detail?.error ?? 'request failed';
            entry.status = 'error';
            this._pending = null;
            this._updateRowStatus(entry);
        });
    }

    _render() {
        this.shadowRoot.innerHTML = `<style>${CSS}</style>
        <div class="ll-toolbar">
            <span class="ll-title">LLM Log</span>
            <span class="ll-count" id="ll-count">0 requests</span>
            <button class="ll-clear">Clear</button>
        </div>
        <div class="ll-body" id="ll-body">
            <div class="ll-empty">No LLM requests yet</div>
        </div>`;

        this.shadowRoot.querySelector('.ll-clear').addEventListener('click', () => {
            this._entries = [];
            this._pending = null;
            this._seq = 0;
            this._refreshCount();
            const body = this.shadowRoot.getElementById('ll-body');
            body.innerHTML = '<div class="ll-empty">No LLM requests yet</div>';
        });
    }

    _makeRow(entry) {
        const row = document.createElement('div');
        row.className = 'll-row';

        const timeStr = _fmtTime(entry.ts);
        const msgCount = entry.msgs.length;
        const toolCount = entry.toolDefs.length;
        const modelShort = entry.model.length > 24 ? entry.model.slice(0, 24) + '…' : entry.model;

        row.dataset.seq = entry.seq;
        row.innerHTML = `
            <div class="ll-head">
                <span class="ll-seq">#${entry.seq}</span>
                <span class="ll-time">${timeStr}</span>
                <span class="ll-model">${_esc(modelShort)}</span>
                <span class="ll-msgs">${msgCount} msg${msgCount !== 1 ? 's' : ''}</span>
                <span class="ll-st-pending" data-status>…</span>
                <span class="ll-arrow">▶</span>
            </div>
            <div class="ll-detail">
                <div class="ll-section">
                    <div class="ll-label">
                        Request
                        <span class="ll-badge">${msgCount} messages${toolCount ? ` · ${toolCount} tools` : ''}</span>
                    </div>
                    <pre class="ll-pre">${_esc(_jsonStr(entry.msgs))}</pre>
                </div>
                <div class="ll-section" data-resp-section>
                    <div class="ll-label">Response</div>
                    <pre class="ll-pre resp" data-resp>waiting…</pre>
                </div>
            </div>`;

        row.querySelector('.ll-head').addEventListener('click', () => {
            row.classList.toggle('open');
        });
        return row;
    }

    _updateRowStatus(entry) {
        const row = entry.rowEl;
        if (!row) return;
        const stEl   = row.querySelector('[data-status]');
        const respEl = row.querySelector('[data-resp]');
        if (entry.status === 'done') {
            if (stEl) { stEl.className = 'll-st-done'; stEl.textContent = '✓'; }
            if (respEl) respEl.textContent = entry.response;
        } else if (entry.status === 'error') {
            if (stEl) { stEl.className = 'll-st-error'; stEl.textContent = '✗'; }
            if (respEl) { respEl.classList.add('err'); respEl.textContent = entry.error; }
        }
    }

    _refreshCount() {
        const el = this.shadowRoot.getElementById('ll-count');
        if (el) el.textContent = `${this._entries.length} request${this._entries.length !== 1 ? 's' : ''}`;
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }
}

customElements.define('aw-llm-log', AwLlmLog);

// ── helpers ────────────────────────────────────────────────────────────────────

function _fmtTime(d) {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
}

function _jsonStr(v) {
    try { return JSON.stringify(v, null, 2); } catch { return String(v ?? ''); }
}

function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
