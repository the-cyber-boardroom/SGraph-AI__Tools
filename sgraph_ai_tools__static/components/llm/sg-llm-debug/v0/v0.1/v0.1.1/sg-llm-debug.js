/**
 * sg-llm-debug — Full request inspector for the sg-llm component family.
 *
 * Pure observer — emits nothing. Captures every SEND event and records the
 * complete messages array plus the response. Each entry is expandable to show
 * the full constructed reality colour-coded by block type.
 *
 * Block type colours:
 *   system   — blue   (#3b82f6)
 *   context  — green  (#22c55e)
 *   memory   — cyan   (#06b6d4)
 *   history  — amber  (#f59e0b)  (user/assistant pairs)
 *   question — purple (#a855f7)
 *   response — slate  (#94a3b8)
 *
 * Consumes (on parentElement):
 *   llm:send             — captures the full messages array
 *   llm:request-start    — marks entry as in-flight
 *   llm:request-complete — attaches response + metrics to the active entry
 *   llm:request-error    — marks active entry as errored
 *   llm:request-cancel   — marks active entry as cancelled
 *
 * Emits: nothing.
 *
 * @module sg-llm-debug
 * @version 0.1.1
 *
 * Changelog:
 *   v0.1.1: _bus() updated to walk [data-llm-bus] ancestor for sg-layout panel compatibility (backwards compatible).
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

/** Colour scheme per detected block type (derived from message content/role). */
const TYPE_COLORS = Object.freeze({
    system:   { bg: '#0d1e3a', border: '#1e3a8a', badge: '#3b82f6', label: 'System'   },
    context:  { bg: '#0d2a1a', border: '#166534', badge: '#22c55e', label: 'Context'  },
    memory:   { bg: '#0d2a2a', border: '#155e75', badge: '#06b6d4', label: 'Memory'   },
    history:  { bg: '#2a1e0d', border: '#78350f', badge: '#f59e0b', label: 'History'  },
    question: { bg: '#1e0d2a', border: '#581c87', badge: '#a855f7', label: 'Question' },
    response: { bg: '#111122', border: '#222d4d', badge: '#94a3b8', label: 'Response' },
    error:    { bg: '#2a0d0d', border: '#991b1b', badge: '#f87171', label: 'Error'    },
});

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.debug-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0a0a18;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #e2e8f0;
    overflow: hidden;
}

/* ── Toolbar ──────────────────────────── */
.debug-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid #1e2a45;
    background: #0d0d1a;
    flex-shrink: 0;
}
.debug-title { font-size: 12px; font-weight: 600; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.05em; flex: 1; }
.debug-count { font-size: 11px; color: #4a5568; }
.clear-btn   { background: none; border: 1px solid #2d3f5e; border-radius: 4px; color: #64748b; font-size: 11px; padding: 3px 8px; cursor: pointer; }
.clear-btn:hover { color: #f87171; border-color: #991b1b; }

/* ── Entry list ───────────────────────── */
.debug-list {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #222d4d transparent;
}
.debug-empty { text-align: center; color: #4a5568; padding: 32px 16px; font-size: 12px; }

/* ── Entry ────────────────────────────── */
.entry {
    border-bottom: 1px solid #111122;
    cursor: pointer;
}
.entry:hover .entry-header { background: #0d0d2a; }

.entry-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #0a0a18;
    transition: background 0.1s;
}
.entry-time    { font-size: 11px; color: #4a5568; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.entry-mode    { font-size: 10px; padding: 1px 6px; border-radius: 8px; flex-shrink: 0; font-weight: 600; }
.entry-mode.build          { background: #0d1a2e; color: #7c9ef8; }
.entry-mode.memory-update  { background: #0d2a1a; color: #4ade80; }
.entry-summary { font-size: 12px; color: #a0aec0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.entry-status  { font-size: 11px; flex-shrink: 0; }
.entry-status.pending  { color: #f59e0b; }
.entry-status.complete { color: #4ade80; }
.entry-status.error    { color: #f87171; }
.entry-status.cancel   { color: #64748b; }
.entry-chevron { font-size: 10px; color: #4a5568; flex-shrink: 0; transition: transform 0.15s; }
.entry-chevron.open { transform: rotate(90deg); }

/* ── Entry detail ─────────────────────── */
.entry-detail { display: none; }
.entry-detail.open { display: block; }

/* ── Message block ────────────────────── */
.msg-block {
    margin: 6px 12px;
    border-radius: 6px;
    border: 1px solid;
    overflow: hidden;
}
.msg-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
}
.msg-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 8px;
    color: #0a0a18;
}
.msg-role  { font-size: 11px; color: #4a5568; }
.msg-tok   { font-size: 10px; color: #4a5568; margin-left: auto; }
.msg-body  { padding: 8px 10px; font-size: 12px; white-space: pre-wrap; word-break: break-word; line-height: 1.5; color: #cbd5e1; }
.msg-body.collapsed { max-height: 60px; overflow: hidden; }

/* ── Response block ───────────────────── */
.response-block {
    margin: 6px 12px 10px;
    border-radius: 6px;
    border: 1px solid #222d4d;
    background: #111122;
    overflow: hidden;
}
.response-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-bottom: 1px solid #1e2a45;
    background: #0d0d1a;
}
.response-badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 8px; background: #94a3b8; color: #0a0a18; }
.response-meta  { font-size: 11px; color: #4a5568; }
.response-body  { padding: 8px 10px; font-size: 12px; white-space: pre-wrap; word-break: break-word; line-height: 1.5; color: #cbd5e1; max-height: 200px; overflow-y: auto; }
.error-block    { margin: 6px 12px 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid #991b1b; background: #2a0d0d; font-size: 12px; color: #f87171; }
`;

export class SgLlmDebug extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        /** @type {Array<object>} log entries */
        this._entries = [];
        /** id of the currently in-flight entry */
        this._activeId = null;
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
            <div class="debug-root">
                <div class="debug-toolbar">
                    <span class="debug-title">🔍 Debug Inspector</span>
                    <span class="debug-count" id="count">0 requests</span>
                    <button class="clear-btn" id="clear-btn">Clear</button>
                </div>
                <div class="debug-list" id="list">
                    <div class="debug-empty" id="empty-msg">No requests yet. Send a message to capture it here.</div>
                </div>
            </div>`;

        this.shadowRoot.getElementById('clear-btn').addEventListener('click', () => {
            this._entries = [];
            this._activeId = null;
            this._refreshList();
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
        on(SGL_LLM.SEND,             this._onSend);
        on(SGL_LLM.REQUEST_START,    this._onRequestStart);
        on(SGL_LLM.REQUEST_COMPLETE, this._onRequestComplete);
        on(SGL_LLM.REQUEST_ERROR,    this._onRequestError);
        on(SGL_LLM.REQUEST_CANCEL,   this._onRequestCancel);
    }

    _onSend(e) {
        const entry = {
            id:       `dbg-${Date.now()}-${Math.random().toString(16).slice(2,5)}`,
            time:     new Date(),
            mode:     e.detail?.mode || 'build',
            messages: e.detail?.messages || [],
            status:   'pending',
            response: null,
            error:    null,
        };
        this._entries.unshift(entry);
        this._activeId = entry.id;
        this._refreshList();
    }

    _onRequestStart() {
        // status already 'pending' from SEND
    }

    _onRequestComplete(e) {
        const entry = this._entries.find(en => en.id === this._activeId);
        if (entry) {
            entry.status   = 'complete';
            entry.response = {
                content:          e.detail?.content          ?? '',
                promptTokens:     e.detail?.promptTokens     ?? 0,
                completionTokens: e.detail?.completionTokens ?? 0,
                cost:             e.detail?.cost             ?? 0,
                latencyMs:        e.detail?.latencyMs        ?? 0,
            };
        }
        this._activeId = null;
        this._refreshList();
    }

    _onRequestError(e) {
        const entry = this._entries.find(en => en.id === this._activeId);
        if (entry) { entry.status = 'error'; entry.error = e.detail?.error || 'Unknown error'; }
        this._activeId = null;
        this._refreshList();
    }

    _onRequestCancel() {
        const entry = this._entries.find(en => en.id === this._activeId);
        if (entry) entry.status = 'cancel';
        this._activeId = null;
        this._refreshList();
    }

    // ── List rendering ─────────────────────────────────────────────────────

    _refreshList() {
        const list    = this.shadowRoot.getElementById('list');
        const empty   = this.shadowRoot.getElementById('empty-msg');
        const counter = this.shadowRoot.getElementById('count');

        list.querySelectorAll('.entry').forEach(el => el.remove());

        if (this._entries.length === 0) {
            empty.style.display = '';
            counter.textContent = '0 requests';
            return;
        }

        empty.style.display = 'none';
        counter.textContent = `${this._entries.length} request${this._entries.length === 1 ? '' : 's'}`;

        for (const entry of this._entries) {
            list.appendChild(this._buildEntryEl(entry));
        }
    }

    _buildEntryEl(entry) {
        const el = document.createElement('div');
        el.className = 'entry';
        el.dataset.id = entry.id;

        const timeStr    = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const statusIcon = { pending: '⟳', complete: '✓', error: '✗', cancel: '⊘' }[entry.status] || '?';
        const summary    = this._summarise(entry.messages);

        el.innerHTML = `
            <div class="entry-header">
                <span class="entry-time">${timeStr}</span>
                <span class="entry-mode ${entry.mode}">${entry.mode === 'memory-update' ? '↻ memory' : '▶ build'}</span>
                <span class="entry-summary">${_esc(summary)}</span>
                <span class="entry-status ${entry.status}">${statusIcon}</span>
                <span class="entry-chevron" id="chev-${entry.id}">▶</span>
            </div>
            <div class="entry-detail" id="det-${entry.id}">
                ${this._buildDetail(entry)}
            </div>`;

        el.querySelector('.entry-header').addEventListener('click', () => {
            const det  = el.querySelector('.entry-detail');
            const chev = el.querySelector('.entry-chevron');
            const open = det.classList.toggle('open');
            chev.classList.toggle('open', open);
        });

        return el;
    }

    _buildDetail(entry) {
        const blocks = [];
        for (const msg of entry.messages) {
            blocks.push(this._buildMessageBlock(msg));
        }
        if (entry.status === 'complete' && entry.response) {
            blocks.push(this._buildResponseBlock(entry.response));
        }
        if (entry.status === 'error') {
            blocks.push(`<div class="error-block">✗ ${_esc(String(entry.error))}</div>`);
        }
        if (entry.status === 'cancel') {
            blocks.push(`<div class="error-block" style="border-color:#4a5568;background:#111122;color:#64748b;">⊘ Request cancelled</div>`);
        }
        return blocks.join('');
    }

    _buildMessageBlock(msg) {
        const type   = _detectType(msg);
        const colors = TYPE_COLORS[type] || TYPE_COLORS.question;
        const body   = Array.isArray(msg.content)
            ? msg.content.map(p => p.type === 'text' ? p.text : `[${p.type}]`).join('\n')
            : String(msg.content ?? '');
        const tok  = Math.ceil(body.length / 4);
        const role = msg.role || '';

        return `
            <div class="msg-block" style="background:${colors.bg};border-color:${colors.border};">
                <div class="msg-header">
                    <span class="msg-badge" style="background:${colors.badge};">${colors.label}</span>
                    <span class="msg-role">${role}</span>
                    <span class="msg-tok">~${tok} tok</span>
                </div>
                <div class="msg-body">${_esc(body)}</div>
            </div>`;
    }

    _buildResponseBlock(response) {
        const preview = response.content.slice(0, 2000) + (response.content.length > 2000 ? '…' : '');
        const meta = [
            response.promptTokens     ? `↑${response.promptTokens}`     : '',
            response.completionTokens ? `↓${response.completionTokens}` : '',
            response.cost             ? `$${response.cost.toFixed(4)}`  : '',
            response.latencyMs        ? `${response.latencyMs}ms`       : '',
        ].filter(Boolean).join('  ');

        return `
            <div class="response-block">
                <div class="response-header">
                    <span class="response-badge">Response</span>
                    <span class="response-meta">${_esc(meta)}</span>
                </div>
                <div class="response-body">${_esc(preview)}</div>
            </div>`;
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    _summarise(messages) {
        const last = messages[messages.length - 1];
        if (!last) return '(empty)';
        const body = Array.isArray(last.content)
            ? last.content.find(p => p.type === 'text')?.text ?? ''
            : String(last.content ?? '');
        return body.slice(0, 80) || `${messages.length} messages`;
    }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }

    /**
     * Returns all logged entries (for testing / external inspection).
     * @returns {Array<object>}
     */
    getEntries() {
        return this._entries.map(e => ({ ...e }));
    }
}

customElements.define('sg-llm-debug', SgLlmDebug);
window.SgLlmDebug = SgLlmDebug;

// ── Utilities ─────────────────────────────────────────────────────────────────

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Heuristically detect which block type generated a message, for colour coding.
 * @param {{ role: string, content: string|Array }} msg
 * @returns {string} one of: system | context | memory | history | question
 */
function _detectType(msg) {
    if (msg.role === 'system') return 'system';
    if (msg.role === 'assistant') return 'history';
    const body = Array.isArray(msg.content)
        ? msg.content.find(p => p.type === 'text')?.text ?? ''
        : String(msg.content ?? '');
    if (body.startsWith('--- CONTEXT:'))        return 'context';
    if (body.startsWith('--- SESSION MEMORY')) return 'memory';
    if (body.startsWith('CURRENT MEMORY:'))    return 'memory';
    // A user message that follows an assistant message is history
    // (we can't reliably detect this without the full array — default to question)
    return 'question';
}
