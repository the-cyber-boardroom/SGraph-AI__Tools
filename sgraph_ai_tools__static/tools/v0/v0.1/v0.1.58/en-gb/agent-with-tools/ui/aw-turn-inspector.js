/**
 * aw-turn-inspector — Captures and displays each agentic turn as structured data.
 *
 * A "turn" = one user message → N iterations of (LLM request → tool calls → result) → final response.
 *
 * Two views:
 *   List  — table of all turns with summary info
 *   Flow  — for the selected turn: horizontal pipeline cards showing each iteration
 *
 * Also exposes a JSON export of all captured turns.
 *
 * @module aw-turn-inspector
 * @version 0.1.58
 */

const CSS = `
:host { display:flex; flex-direction:column; height:100%; overflow:hidden;
        background:#0d0d1a; font-family:system-ui,sans-serif; font-size:12px; color:#94a3b8; }
.ti-toolbar {
    display:flex; align-items:center; gap:6px; padding:6px 8px;
    border-bottom:1px solid #1a1a3a; flex-shrink:0; background:#0d0d1a;
}
.ti-title { font-size:10px; font-weight:700; text-transform:uppercase;
            letter-spacing:.06em; color:#4a5568; flex:1; }
.ti-btn { background:none; border:1px solid #2d3060; color:#94a3b8;
          border-radius:4px; padding:2px 8px; cursor:pointer; font-size:10px; }
.ti-btn:hover { border-color:#7c9ef8; color:#e2e8f0; }
.ti-tabs { display:flex; gap:2px; }
.ti-tab { font-size:10px; padding:2px 8px; border-radius:3px; cursor:pointer;
          background:none; border:1px solid transparent; color:#475569; }
.ti-tab.active { background:#1e2860; border-color:#7c9ef8; color:#e2e8f0; }
/* List view */
.ti-list { flex:1; overflow-y:auto; scrollbar-width:thin; scrollbar-color:#1a1a3a transparent; }
.ti-empty { color:#2a2a4a; text-align:center; padding:24px; font-size:11px; }
.ti-row { display:flex; align-items:center; gap:6px; padding:5px 8px;
          border-bottom:1px solid #11111e; cursor:pointer; user-select:none;
          font-family:monospace; font-size:11px; }
.ti-row:hover { background:#0f0f22; }
.ti-row.selected { background:#0f1830; }
.ti-rseq { color:#2d3060; min-width:24px; text-align:right; }
.ti-rtime { color:#374151; min-width:60px; }
.ti-rmsg { color:#e2e8f0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ti-riters { color:#7c9ef8; min-width:28px; text-align:center; }
.ti-rtools { color:#f59e0b; min-width:32px; text-align:center; }
.ti-rok { color:#22c55e; min-width:20px; text-align:center; }
.ti-rerr { color:#ef4444; min-width:20px; text-align:center; }
/* Flow view */
.ti-flow { flex:1; overflow:auto; padding:10px; display:none; }
.ti-flow.visible { display:block; }
.ti-list.hidden { display:none; }
.ti-iter-label { font-size:10px; font-weight:700; text-transform:uppercase;
                 letter-spacing:.05em; color:#374151; margin-bottom:6px; margin-top:10px; }
.ti-pipeline { display:flex; gap:0; align-items:stretch; min-width:0; }
.ti-pipe-card {
    flex:1; min-width:120px; max-width:260px;
    background:#111128; border:1px solid #1e1e3a; border-radius:6px;
    padding:8px; font-size:11px; position:relative;
}
.ti-pipe-card + .ti-pipe-card { margin-left:0; }
.ti-pipe-arrow {
    display:flex; align-items:center; padding:0 4px;
    color:#2d3060; font-size:16px; flex-shrink:0;
}
.ti-card-type { font-size:9px; font-weight:700; text-transform:uppercase;
                letter-spacing:.06em; color:#374151; margin-bottom:4px; }
.ti-card-name { font-family:monospace; color:#7c9ef8; font-weight:600;
                font-size:11px; margin-bottom:3px; }
.ti-card-body { font-family:monospace; font-size:10px; color:#64748b;
                white-space:pre-wrap; word-break:break-all; max-height:80px;
                overflow-y:auto; }
.ti-card-body.ok  { color:#86efac; }
.ti-card-body.err { color:#fca5a5; }
.ti-card-body.resp { color:#a78bfa; }
/* JSON export area */
.ti-json-wrap { display:none; flex:1; overflow:auto; padding:8px; }
.ti-json-wrap.visible { display:block; }
.ti-json-pre { font-family:monospace; font-size:10px; color:#64748b;
               white-space:pre-wrap; word-break:break-all; }
`;

export class AwTurnInspector extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._turns  = [];
        this._seq    = 0;
        this._cur    = null; // current in-progress turn
        this._selIdx = null; // selected turn index (for flow view)
        this._view   = 'list'; // 'list' | 'flow' | 'json'
    }

    connectedCallback() {
        if (this._init) return;
        this._init = true;
        this._render();
        const bus = this._bus();

        bus.addEventListener('llm:chat-message', (e) => {
            this._cur = {
                id:      ++this._seq,
                ts:      new Date(),
                userMsg: e.detail?.text ?? '',
                iters:   [],
            };
            this._turns.push(this._cur);
            this._addRow(this._cur);
        });

        // New iteration starts when LLM send fires with tools injected
        bus.addEventListener('llm:send', (e) => {
            if (!e._toolsInjected || !this._cur) return;
            this._cur.iters.push({
                n:         this._cur.iters.length + 1,
                model:     e.detail?.model || e.detail?.provider || '',
                msgCount:  (e.detail?.messages ?? []).length,
                toolCalls: [],
                response:  null,
                error:     null,
            });
        });

        bus.addEventListener('llm:tool-results-complete', (e) => {
            if (!this._cur) return;
            const { results, messages } = e.detail ?? {};
            const iter = this._cur.iters[this._cur.iters.length - 1];
            if (!iter) return;
            const toolCallMsg = [...(messages ?? [])].reverse().find(m => m.role === 'assistant' && m.tool_calls);
            iter.toolCalls = (results ?? []).map(r => {
                const tc = toolCallMsg?.tool_calls?.find(t => t.id === r.toolCallId);
                return {
                    name:   r.name,
                    args:   (() => { try { return JSON.parse(tc?.function?.arguments ?? '{}'); } catch { return {}; } })(),
                    result: r.result ?? null,
                    error:  r.error ?? null,
                };
            });
            this._refreshRow(this._cur);
        });

        bus.addEventListener('llm:request-complete', (e) => {
            if (!this._cur) return;
            const iter = this._cur.iters[this._cur.iters.length - 1];
            if (iter) { iter.response = e.detail?.content ?? ''; }
            this._refreshRow(this._cur);
        });

        bus.addEventListener('llm:request-error', (e) => {
            if (!this._cur) return;
            const iter = this._cur.iters[this._cur.iters.length - 1];
            if (iter) { iter.error = e.detail?.error ?? 'request failed'; }
            this._refreshRow(this._cur);
        });
    }

    _render() {
        this.shadowRoot.innerHTML = `<style>${CSS}</style>
        <div class="ti-toolbar">
            <span class="ti-title">Turns</span>
            <div class="ti-tabs">
                <button class="ti-tab active" data-view="list">List</button>
                <button class="ti-tab" data-view="flow">Flow</button>
                <button class="ti-tab" data-view="json">JSON</button>
            </div>
            <button class="ti-btn" id="ti-export">↓ Export</button>
            <button class="ti-btn" id="ti-clear">Clear</button>
        </div>
        <div class="ti-list" id="ti-list"><div class="ti-empty">No turns yet</div></div>
        <div class="ti-flow" id="ti-flow"><div class="ti-empty">Select a turn in List view</div></div>
        <div class="ti-json-wrap" id="ti-json"><pre class="ti-json-pre">[]</pre></div>`;

        this.shadowRoot.querySelectorAll('.ti-tab').forEach(btn => {
            btn.addEventListener('click', () => this._switchView(btn.dataset.view));
        });
        this.shadowRoot.getElementById('ti-clear').addEventListener('click', () => {
            this._turns = []; this._seq = 0; this._cur = null; this._selIdx = null;
            this.shadowRoot.getElementById('ti-list').innerHTML = '<div class="ti-empty">No turns yet</div>';
            this.shadowRoot.getElementById('ti-flow').innerHTML = '<div class="ti-empty">Select a turn in List view</div>';
            this._updateJson();
        });
        this.shadowRoot.getElementById('ti-export').addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(this._turns, null, 2)], { type: 'application/json' });
            const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `turns-${Date.now()}.json` });
            a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        });
    }

    _switchView(view) {
        this._view = view;
        this.shadowRoot.querySelectorAll('.ti-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
        this.shadowRoot.getElementById('ti-list').classList.toggle('hidden', view !== 'list');
        this.shadowRoot.getElementById('ti-flow').classList.toggle('visible', view === 'flow');
        this.shadowRoot.getElementById('ti-json').classList.toggle('visible', view === 'json');
        if (view === 'json') this._updateJson();
        if (view === 'flow' && this._selIdx != null) this._renderFlow(this._turns[this._selIdx]);
    }

    _addRow(turn) {
        const list = this.shadowRoot.getElementById('ti-list');
        const empty = list.querySelector('.ti-empty'); if (empty) empty.remove();
        const row = document.createElement('div');
        row.className = 'ti-row';
        row.dataset.id = turn.id;
        row.innerHTML = this._rowHtml(turn);
        row.addEventListener('click', () => {
            this._selIdx = this._turns.indexOf(turn);
            this.shadowRoot.querySelectorAll('.ti-row').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
            this._switchView('flow');
        });
        list.appendChild(row);
        list.scrollTop = list.scrollHeight;
    }

    _refreshRow(turn) {
        const row = this.shadowRoot.querySelector(`.ti-row[data-id="${turn.id}"]`);
        if (row) row.innerHTML = this._rowHtml(turn);
        if (this._view === 'flow' && this._turns[this._selIdx] === turn) this._renderFlow(turn);
        if (this._view === 'json') this._updateJson();
    }

    _rowHtml(turn) {
        const t = turn.ts;
        const time = `${_p(t.getHours())}:${_p(t.getMinutes())}:${_p(t.getSeconds())}`;
        const totalTools = turn.iters.reduce((s, i) => s + i.toolCalls.length, 0);
        const hasErr = turn.iters.some(i => i.error || i.toolCalls.some(tc => tc.error));
        const msgShort = (turn.userMsg || '(no message)').slice(0, 60);
        return `<span class="ti-rseq">#${turn.id}</span>
                <span class="ti-rtime">${time}</span>
                <span class="ti-rmsg">${_esc(msgShort)}</span>
                <span class="ti-riters">${turn.iters.length}i</span>
                <span class="ti-rtools">${totalTools}🔧</span>
                ${hasErr ? '<span class="ti-rerr">✗</span>' : '<span class="ti-rok">✓</span>'}`;
    }

    _renderFlow(turn) {
        const flow = this.shadowRoot.getElementById('ti-flow');
        flow.innerHTML = '';

        if (!turn.iters.length) {
            flow.innerHTML = '<div class="ti-empty">No iterations recorded yet</div>';
            return;
        }

        // User message card (shown once at the top)
        const userLbl = document.createElement('div');
        userLbl.className = 'ti-iter-label';
        userLbl.textContent = 'User Message';
        flow.appendChild(userLbl);
        flow.appendChild(_card('YOU', null, turn.userMsg || '(empty)', ''));
        flow.appendChild(document.createElement('br'));

        for (const iter of turn.iters) {
            const lbl = document.createElement('div');
            lbl.className = 'ti-iter-label';
            lbl.textContent = `Iteration ${iter.n}${iter.model ? '  ·  ' + iter.model : ''}`;
            flow.appendChild(lbl);

            const pipe = document.createElement('div');
            pipe.className = 'ti-pipeline';

            if (iter.toolCalls.length) {
                iter.toolCalls.forEach((tc, i) => {
                    if (i > 0) pipe.appendChild(_arrow());
                    const argsStr = (() => { try { return JSON.stringify(tc.args, null, 1); } catch { return '{}'; } })();
                    const resStr  = tc.error
                        ? `Error: ${tc.error}`
                        : (() => { try { const s = JSON.stringify(tc.result); return s?.length > 120 ? s.slice(0, 120) + '…' : s; } catch { return String(tc.result); } })();
                    pipe.appendChild(_card('TOOL CALL', tc.name, argsStr, ''));
                    pipe.appendChild(_arrow());
                    pipe.appendChild(_card('RESULT', null, resStr, tc.error ? 'err' : 'ok'));
                    pipe.appendChild(_arrow());
                });
            }

            const resp = iter.error
                ? _card('ERROR', null, iter.error, 'err')
                : _card('RESPONSE', null, iter.response || '(pending…)', 'resp');
            pipe.appendChild(resp);
            flow.appendChild(pipe);
        }
    }

    _updateJson() {
        const pre = this.shadowRoot.querySelector('.ti-json-pre');
        if (pre) pre.textContent = JSON.stringify(this._turns, null, 2);
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }
}

customElements.define('aw-turn-inspector', AwTurnInspector);

// ── helpers ────────────────────────────────────────────────────────────────────

function _card(type, name, body, cls) {
    const el = document.createElement('div');
    el.className = 'ti-pipe-card';
    el.innerHTML = `<div class="ti-card-type">${_esc(type)}</div>
                    ${name ? `<div class="ti-card-name">${_esc(name)}</div>` : ''}
                    <div class="ti-card-body ${cls}">${_esc(body)}</div>`;
    return el;
}

function _arrow() {
    const el = document.createElement('div');
    el.className = 'ti-pipe-arrow';
    el.textContent = '→';
    return el;
}

function _p(n) { return String(n).padStart(2, '0'); }
function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
