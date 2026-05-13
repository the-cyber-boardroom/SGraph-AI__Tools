/**
 * aw-execution-log — Persistent log of every tool call with full input/output.
 *
 * Captures sg-local-bridge:tool-call and sg-local-bridge:error events.
 * Each row shows: seq#, time, tool name, duration, status (ok/err).
 * Click any row to expand full args JSON and result JSON.
 * Persists until the Clear button is pressed.
 *
 * @module aw-execution-log
 * @version 0.1.58
 */

const CSS = `
:host { display:flex; flex-direction:column; height:100%; overflow:hidden;
        background:#0d0d1a; font-family:system-ui,sans-serif; font-size:12px; color:#94a3b8; }
.el-toolbar {
    display:flex; align-items:center; gap:8px; padding:6px 8px;
    border-bottom:1px solid #1a1a3a; flex-shrink:0; background:#0d0d1a;
}
.el-title { font-size:10px; font-weight:700; text-transform:uppercase;
            letter-spacing:.06em; color:#4a5568; flex:1; }
.el-count { font-size:10px; color:#475569; font-family:monospace; }
.el-clear  { background:none; border:1px solid #2d3060; color:#94a3b8;
             border-radius:4px; padding:2px 8px; cursor:pointer; font-size:11px; }
.el-clear:hover { border-color:#7c9ef8; color:#e2e8f0; }
.el-body { flex:1; overflow-y:auto; scrollbar-width:thin; scrollbar-color:#1a1a3a transparent; }
.el-empty { color:#2a2a4a; text-align:center; padding:24px; font-size:11px; }
.el-row {
    border-bottom:1px solid #11111e;
    cursor:pointer; user-select:none;
}
.el-row:hover { background:#0f0f22; }
.el-head {
    display:flex; align-items:center; gap:6px;
    padding:5px 8px; font-family:monospace; font-size:11px;
}
.el-seq  { color:#2d3060; min-width:26px; text-align:right; }
.el-time { color:#374151; min-width:64px; }
.el-name { color:#7c9ef8; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.el-dur  { color:#475569; min-width:48px; text-align:right; }
.el-ok   { color:#22c55e; min-width:30px; text-align:center; }
.el-err  { color:#ef4444; min-width:30px; text-align:center; }
.el-arrow{ color:#374151; margin-left:4px; font-size:10px; transition:transform .15s; }
.el-body-detail {
    display:none; padding:4px 8px 8px 38px;
    border-top:1px solid #11111e; background:#080810;
}
.el-row.open .el-arrow  { transform:rotate(90deg); }
.el-row.open .el-body-detail { display:block; }
.el-section { margin-bottom:6px; }
.el-label { font-size:10px; font-weight:600; text-transform:uppercase;
            letter-spacing:.05em; color:#374151; margin-bottom:3px; }
.el-pre {
    font-family:monospace; font-size:10px; color:#64748b;
    background:#0d0d1a; border:1px solid #1e1e3a; border-radius:3px;
    padding:6px 8px; white-space:pre-wrap; word-break:break-all;
    max-height:160px; overflow-y:auto;
}
.el-pre.ok  { border-color:#14532d; color:#86efac; }
.el-pre.err { border-color:#7f1d1d; color:#fca5a5; }
`;

export class AwExecutionLog extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._entries = [];
        this._pending = new Map(); // toolCallId → entry
        this._seq = 0;
    }

    connectedCallback() {
        if (this._init) return;
        this._init = true;
        this._render();
        const bus = this._bus();

        // Create pending entries when LLM dispatches tool calls (args available here)
        bus.addEventListener('llm:tool-calls', (e) => {
            if (e._fromInspector) return; // don't double-log inspector re-dispatches
            const { toolCalls } = e.detail ?? {};
            if (!toolCalls?.length) return;
            for (const tc of toolCalls) {
                const args = (() => { try { return JSON.parse(tc.function?.arguments ?? '{}'); } catch { return { _raw: tc.function?.arguments }; } })();
                const entry = {
                    seq:    ++this._seq,
                    ts:     new Date(),
                    name:   tc.function?.name ?? '?',
                    id:     tc.id,
                    ms:     null,
                    args,
                    result: null,
                    error:  null,
                    status: 'running',
                    rowEl:  null,
                };
                this._pending.set(tc.id, entry);
                this._append(entry);
            }
        });

        // Success path with timing: sg-local-bridge:tool-call (bubbles:false, dispatched on bus)
        bus.addEventListener('sg-local-bridge:tool-call', (e) => {
            const { name, result, ms } = e.detail ?? {};
            for (const [id, entry] of this._pending) {
                if (entry.name === name && entry.status === 'running') {
                    entry.ms = ms ?? null;
                    entry.result = result;
                    entry.status = 'done';
                    this._pending.delete(id);
                    this._updateRow(entry);
                    break;
                }
            }
        });

        // Reliable fallback: sg-tool-runner fires llm:tool-result for every call (success AND error)
        bus.addEventListener('llm:tool-result', (e) => {
            const { toolCallId, result, error } = e.detail ?? {};
            const entry = this._pending.get(toolCallId);
            if (!entry || entry.status !== 'running') return;
            entry.result = result ?? null;
            entry.error  = error ?? null;
            entry.status = error ? 'error' : 'done';
            this._pending.delete(toolCallId);
            this._updateRow(entry);
        });
    }

    _render() {
        this.shadowRoot.innerHTML = `<style>${CSS}</style>
        <div class="el-toolbar">
            <span class="el-title">Exec Log</span>
            <span class="el-count" id="el-count">0 calls</span>
            <button class="el-clear">Clear</button>
        </div>
        <div class="el-body" id="el-body">
            <div class="el-empty">No tool calls yet</div>
        </div>`;

        this.shadowRoot.querySelector('.el-clear').addEventListener('click', () => {
            this._entries = [];
            this._pending.clear();
            this._seq = 0;
            this._refreshCount();
            const body = this.shadowRoot.getElementById('el-body');
            body.innerHTML = '<div class="el-empty">No tool calls yet</div>';
        });
    }

    _append(entry) {
        this._entries.push(entry);
        const body = this.shadowRoot.getElementById('el-body');
        const empty = body.querySelector('.el-empty');
        if (empty) empty.remove();
        body.appendChild(this._makeRow(entry));
        body.scrollTop = body.scrollHeight;
        this._refreshCount();
    }

    _updateRow(entry) {
        const row = entry.rowEl;
        if (!row) return;
        const statusEl = row.querySelector('[data-status]');
        const durEl    = row.querySelector('[data-dur]');
        const resEl    = row.querySelector('[data-result]');
        if (statusEl) {
            statusEl.className = entry.error ? 'el-err' : 'el-ok';
            statusEl.textContent = entry.error ? '✗' : '✓';
        }
        if (durEl && entry.ms != null) durEl.textContent = `${entry.ms}ms`;
        if (resEl) {
            resEl.className = `el-pre ${entry.error ? 'err' : 'ok'}`;
            resEl.textContent = entry.error ? `Error: ${entry.error}` : _jsonStr(entry.result);
        }
    }

    _makeRow(entry) {
        const row = document.createElement('div');
        row.className = 'el-row';
        entry.rowEl = row;

        const hh = String(entry.ts.getHours()).padStart(2, '0');
        const mm = String(entry.ts.getMinutes()).padStart(2, '0');
        const ss = String(entry.ts.getSeconds()).padStart(2, '0');
        const ms3 = String(entry.ts.getMilliseconds()).padStart(3, '0');
        const timeStr = `${hh}:${mm}:${ss}.${ms3}`;

        row.innerHTML = `
            <div class="el-head">
                <span class="el-seq">#${entry.seq}</span>
                <span class="el-time">${timeStr}</span>
                <span class="el-name">${_esc(entry.name)}</span>
                <span class="el-dur" data-dur>${entry.ms != null ? entry.ms + 'ms' : '…'}</span>
                <span class="el-ok" data-status>${entry.status === 'running' ? '…' : (entry.error ? '✗' : '✓')}</span>
                <span class="el-arrow">▶</span>
            </div>
            <div class="el-body-detail">
                <div class="el-section">
                    <div class="el-label">Args</div>
                    <pre class="el-pre">${_esc(_jsonStr(entry.args))}</pre>
                </div>
                <div class="el-section">
                    <div class="el-label">Result</div>
                    <pre class="el-pre" data-result>${entry.status === 'running' ? 'waiting…' : _esc(entry.error ? `Error: ${entry.error}` : _jsonStr(entry.result))}</pre>
                </div>
            </div>`;

        row.querySelector('.el-head').addEventListener('click', () => {
            row.classList.toggle('open');
        });
        return row;
    }

    _refreshCount() {
        const el = this.shadowRoot.getElementById('el-count');
        if (el) el.textContent = `${this._entries.length} call${this._entries.length !== 1 ? 's' : ''}`;
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }
}

customElements.define('aw-execution-log', AwExecutionLog);

// ── helpers ────────────────────────────────────────────────────────────────────

function _jsonStr(v) {
    try { return JSON.stringify(v, null, 2); } catch { return String(v ?? ''); }
}

function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
