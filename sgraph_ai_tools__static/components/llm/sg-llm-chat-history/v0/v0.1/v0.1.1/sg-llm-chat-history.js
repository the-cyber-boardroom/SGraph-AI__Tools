/**
 * sg-llm-chat-history — Multi-turn conversation display and state manager.
 *
 * Owns the conversation turn array. Displays alternating user/assistant
 * bubbles with live streaming. Assembles the full messages array (including
 * history and optional system prompt) and emits SEND on each new user turn.
 *
 * Changes from v0.1.0:
 *   - Scroll lock: auto-scroll pauses when user scrolls up manually.
 *     A ↓ jump button appears; clicking it or scrolling to the bottom
 *     resumes auto-scroll.
 *   - Streaming markdown: raw text is shown during streaming to avoid
 *     broken/partial markdown artefacts. Full markdown render happens on
 *     REQUEST_COMPLETE (and for all non-streaming assistant turns).
 *
 * Listens for `llm:chat-message` from sg-llm-chat-input, adds the user
 * bubble, then fires SGL_LLM.SEND with the complete messages array.
 *
 * Consumes (on parentElement):
 *   llm:chat-message      — { text, attachments } → adds user turn, emits SEND
 *   llm:connected         — { provider, model } → stores for SEND
 *   llm:model-changed     — { model } → updates stored model
 *   llm:request-start     — shows streaming cursor
 *   llm:request-chunk     — { accumulated } → updates streaming bubble (raw text)
 *   llm:request-complete  — { content } → finalises assistant bubble (markdown)
 *   llm:request-error     — { error } → shows error in bubble
 *   llm:request-cancel    — marks bubble cancelled
 *
 * Emits (on parentElement):
 *   llm:send  — { messages[], model, provider, mode: 'build' }
 *
 * Public API:
 *   history.getMessages()         → [{role,content}] for external inspection
 *   history.setSystemPrompt(text) → set/update system prompt
 *   history.clear()               → wipe all turns
 *   history.exportMarkdown()      → conversation as markdown string
 *
 * @module sg-llm-chat-history
 * @version 0.1.1
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

/** Custom event name for new chat messages from sg-llm-chat-input. */
const CHAT_MESSAGE = 'llm:chat-message';

const CSS = `
:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.ch-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: system-ui, sans-serif;
    background: #0d0d1a;
    color: #e2e8f0;
    overflow: hidden;
    position: relative;
}
.ch-system {
    flex-shrink: 0;
    background: #0f1020;
    border-bottom: 1px solid #1e2035;
}
.ch-system-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 11px;
    color: #64748b;
    cursor: pointer;
    user-select: none;
}
.ch-system-bar:hover { color: #94a3b8; }
.ch-system-icon { font-size: 13px; }
.ch-system-chevron { margin-left: auto; transition: transform 0.15s; }
.ch-system-chevron.open { transform: rotate(180deg); }
.ch-system-body { display: none; padding: 0 12px 10px; }
.ch-system-body.open { display: block; }
.ch-system-body textarea {
    width: 100%;
    box-sizing: border-box;
    background: #12122a;
    color: #e2e8f0;
    border: 1px solid #2d3060;
    border-radius: 4px;
    padding: 8px;
    font-size: 12px;
    font-family: monospace;
    resize: vertical;
    min-height: 60px;
    max-height: 160px;
}
.ch-system-body textarea:focus { outline: 1px solid #7c9ef8; }
.ch-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.ch-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #2a2a4a;
    font-size: 13px;
    text-align: center;
    pointer-events: none;
}
.ch-bubble-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 85%;
}
.ch-bubble-row.user {
    align-self: flex-end;
    align-items: flex-end;
}
.ch-bubble-row.assistant {
    align-self: flex-start;
    align-items: flex-start;
}
.ch-role-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0 4px;
}
.ch-bubble-row.user .ch-role-label   { color: #7c9ef8; }
.ch-bubble-row.assistant .ch-role-label { color: #4ade80; }
.ch-bubble {
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 13px;
    line-height: 1.55;
    word-break: break-word;
}
.ch-bubble-row.user .ch-bubble {
    background: #1e2860;
    border-bottom-right-radius: 3px;
    color: #e2e8f0;
}
.ch-bubble-row.assistant .ch-bubble {
    background: #12121f;
    border: 1px solid #1e2035;
    border-bottom-left-radius: 3px;
    color: #e2e8f0;
}
.ch-bubble.error  { background: #2a0d0d; border-color: #7f1d1d; color: #f87171; }
.ch-bubble.cancel { opacity: 0.5; font-style: italic; }
.ch-cursor {
    display: inline-block;
    width: 8px;
    height: 14px;
    background: #4ade80;
    margin-left: 2px;
    animation: blink 0.9s steps(1) infinite;
    vertical-align: text-bottom;
}
@keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
.ch-thumb { max-width: 120px; max-height: 80px; border-radius: 4px; margin-top: 4px; }
/* Markdown-rendered content */
.ch-bubble h1,.ch-bubble h2,.ch-bubble h3 { margin:.4em 0 .2em; }
.ch-bubble p  { margin:.25em 0; }
.ch-bubble pre { background:#0d0d1a; border:1px solid #2d3060; border-radius:4px; padding:8px; overflow-x:auto; font-size:11px; margin:.4em 0; }
.ch-bubble code { font-family:monospace; background:#0d0d1a; padding:1px 4px; border-radius:3px; font-size:0.9em; }
.ch-bubble pre code { background:none; padding:0; }
.ch-bubble ul,.ch-bubble ol { padding-left:1.4em; margin:.25em 0; }
.ch-bubble a { color:#7c9ef8; }
/* Jump-to-bottom button */
.ch-jump-btn {
    position: absolute;
    bottom: 52px;
    right: 16px;
    background: #1e2860;
    color: #7c9ef8;
    border: 1px solid #3d5a99;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    font-size: 15px;
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 10;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    transition: background 0.12s;
}
.ch-jump-btn:hover { background: #2d3880; }
.ch-jump-btn.visible { display: flex; }
.ch-actions {
    flex-shrink: 0;
    display: flex;
    gap: 8px;
    padding: 6px 12px;
    border-top: 1px solid #1e2035;
    justify-content: flex-end;
}
.ch-btn {
    font-family: monospace;
    font-size: 11px;
    background: none;
    color: #64748b;
    border: 1px solid #2d3060;
    border-radius: 4px;
    padding: 3px 10px;
    cursor: pointer;
    transition: color 0.12s, background 0.12s;
}
.ch-btn:hover { color: #e2e8f0; background: #1a1a3a; }
`;

export class SgLlmChatHistory extends HTMLElement {

    constructor() {
        super();
        this._turns         = [];    // completed turns [{role, content, attachments?}]
        this._systemPrompt  = '';
        this._model         = '';
        this._provider      = '';
        this._streamingEl   = null;  // current streaming bubble <div>
        this._streamingText = '';
        this._userScrolled  = false; // true when user has manually scrolled up
        this._boundHandlers = {};
        this._shadow        = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._systemPrompt = this.getAttribute('system-prompt') || '';
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
     * Returns the current messages array (for external inspection / bundle save).
     * @returns {Array<{role:string, content:string|Array}>}
     */
    getMessages() { return _assembleMsgs(this._turns, this._systemPrompt); }

    /**
     * Set the system prompt programmatically.
     * @param {string} text
     */
    setSystemPrompt(text) {
        this._systemPrompt = text;
        const ta = this._shadow.querySelector('.ch-system-body textarea');
        if (ta) ta.value = text;
    }

    /** Wipe all conversation turns and re-render empty state. */
    clear() {
        this._turns         = [];
        this._streamingEl   = null;
        this._streamingText = '';
        this._userScrolled  = false;
        this._shadow.querySelector('.ch-jump-btn')?.classList.remove('visible');
        this._renderMessages();
    }

    /**
     * Export conversation as a markdown string.
     * @returns {string}
     */
    exportMarkdown() {
        const lines = [];
        if (this._systemPrompt) {
            lines.push(`**System:** ${this._systemPrompt}\n`);
            lines.push('---\n');
        }
        for (const t of this._turns) {
            const role = t.role === 'user' ? '**You**' : '**Assistant**';
            const text = typeof t.content === 'string' ? t.content
                : (t.content.find(c => c.type === 'text')?.text ?? '');
            lines.push(`${role}\n\n${text}\n`);
        }
        return lines.join('\n');
    }

    // ── Event binding ──────────────────────────────────────────────────────

    _bindEvents() {
        const bus = this._bus();
        const on  = (ev, fn) => {
            const bound = fn.bind(this);
            this._boundHandlers[ev] = bound;
            bus.addEventListener(ev, bound);
        };
        on(CHAT_MESSAGE,             this._onChatMessage);
        on(SGL_LLM.CONNECTED,        this._onConnected);
        on(SGL_LLM.MODEL_CHANGED,    this._onModelChanged);
        on(SGL_LLM.REQUEST_START,    this._onRequestStart);
        on(SGL_LLM.REQUEST_CHUNK,    this._onRequestChunk);
        on(SGL_LLM.REQUEST_COMPLETE, this._onRequestComplete);
        on(SGL_LLM.REQUEST_ERROR,    this._onRequestError);
        on(SGL_LLM.REQUEST_CANCEL,   this._onRequestCancel);
    }

    _onChatMessage(e) {
        const { text = '', attachments = [] } = e.detail ?? {};
        if (!text.trim() && attachments.length === 0) return;

        // Add user bubble
        const turn = { role: 'user', content: text, attachments };
        this._turns.push(turn);
        this._addBubble('user', text, attachments);

        // Emit SEND with full history
        const messages = _assembleMsgs(this._turns, this._systemPrompt);
        this._bus().dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
            detail: { messages, model: this._model, provider: this._provider, mode: 'build' },
            bubbles: true, composed: true,
        }));
    }

    _onConnected(e) {
        this._model    = e.detail?.model    ?? this._model;
        this._provider = e.detail?.provider ?? this._provider;
    }

    _onModelChanged(e) {
        this._model = e.detail?.model ?? this._model;
    }

    _onRequestStart() {
        // Reset scroll lock so the incoming response auto-scrolls
        this._userScrolled = false;
        this._shadow.querySelector('.ch-jump-btn')?.classList.remove('visible');

        // Add empty assistant bubble with streaming cursor
        const row    = this._makeBubbleRow('assistant');
        const bubble = row.querySelector('.ch-bubble');
        bubble.innerHTML = '<span class="ch-cursor"></span>';
        this._streamingEl   = bubble;
        this._streamingText = '';
        this._msgsEl().appendChild(row);
        this._scrollToBottom();
    }

    /**
     * Show raw (unrendered) text during streaming to avoid broken partial
     * markdown artefacts (e.g. unclosed code fences, split bold markers).
     * Full markdown render happens in _onRequestComplete.
     */
    _onRequestChunk(e) {
        this._streamingText = e.detail?.accumulated ?? this._streamingText;
        if (this._streamingEl) {
            this._streamingEl.innerHTML = _rawToHtml(this._streamingText)
                + '<span class="ch-cursor"></span>';
            this._scrollToBottom();
        }
    }

    /** Response complete — replace raw text with fully-rendered markdown. */
    _onRequestComplete(e) {
        const content = e.detail?.content ?? this._streamingText;
        if (this._streamingEl) {
            this._streamingEl.innerHTML = _mdToHtml(content);
            this._streamingEl = null;
        }
        this._turns.push({ role: 'assistant', content });
        this._streamingText = '';
        this._scrollToBottom();
    }

    _onRequestError(e) {
        const msg = e.detail?.error ?? 'Request failed';
        if (this._streamingEl) {
            this._streamingEl.textContent = `⚠ ${msg}`;
            this._streamingEl.classList.add('error');
            this._streamingEl = null;
        }
        this._streamingText = '';
    }

    _onRequestCancel() {
        if (this._streamingEl) {
            const partial = this._streamingText || '(cancelled)';
            this._streamingEl.innerHTML = _mdToHtml(partial);
            this._streamingEl.classList.add('cancel');
            this._turns.push({ role: 'assistant', content: partial });
            this._streamingEl   = null;
            this._streamingText = '';
        }
    }

    // ── DOM ────────────────────────────────────────────────────────────────

    _render() {
        this._shadow.innerHTML = `
            <style>${CSS}</style>
            <div class="ch-wrap" part="wrap">
                <div class="ch-system">
                    <div class="ch-system-bar" part="system-bar">
                        <span class="ch-system-icon">⚙</span>
                        <span>System Prompt</span>
                        <span class="ch-system-chevron">▾</span>
                    </div>
                    <div class="ch-system-body">
                        <textarea rows="3" placeholder="Optional system prompt…">${this._escape(this._systemPrompt)}</textarea>
                    </div>
                </div>
                <div class="ch-messages" part="messages">
                    <div class="ch-empty">Start a conversation below</div>
                </div>
                <button class="ch-jump-btn" title="Jump to bottom">↓</button>
                <div class="ch-actions">
                    <button class="ch-btn" id="ch-clear">Clear</button>
                    <button class="ch-btn" id="ch-export">Export ↓</button>
                </div>
            </div>`;

        this._shadow.querySelector('.ch-system-bar').addEventListener('click', () => {
            const body    = this._shadow.querySelector('.ch-system-body');
            const chevron = this._shadow.querySelector('.ch-system-chevron');
            body.classList.toggle('open');
            chevron.classList.toggle('open');
        });

        this._shadow.querySelector('.ch-system-body textarea').addEventListener('input', (e) => {
            this._systemPrompt = e.target.value;
        });

        this._shadow.querySelector('#ch-clear').addEventListener('click', () => this.clear());

        this._shadow.querySelector('#ch-export').addEventListener('click', () => {
            const md   = this.exportMarkdown();
            const blob = new Blob([md], { type: 'text/markdown' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = `chat-${Date.now()}.md`; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        });

        // Scroll lock: detect manual scroll up → pause auto-scroll
        const msgs    = this._msgsEl();
        const jumpBtn = this._shadow.querySelector('.ch-jump-btn');

        msgs.addEventListener('scroll', () => {
            const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 32;
            if (atBottom) {
                this._userScrolled = false;
                jumpBtn.classList.remove('visible');
            } else {
                this._userScrolled = true;
                jumpBtn.classList.add('visible');
            }
        });

        jumpBtn.addEventListener('click', () => {
            this._userScrolled = false;
            jumpBtn.classList.remove('visible');
            msgs.scrollTop = msgs.scrollHeight;
        });
    }

    _renderMessages() {
        const el = this._msgsEl();
        el.innerHTML = '';
        if (this._turns.length === 0) {
            el.innerHTML = '<div class="ch-empty">Start a conversation below</div>';
            return;
        }
        for (const t of this._turns) {
            const text = typeof t.content === 'string' ? t.content
                : (t.content.find?.(c => c.type === 'text')?.text ?? '');
            this._addBubble(t.role, text, t.attachments ?? []);
        }
    }

    _addBubble(role, text, attachments = []) {
        const empty = this._msgsEl().querySelector('.ch-empty');
        if (empty) empty.remove();

        const row    = this._makeBubbleRow(role);
        const bubble = row.querySelector('.ch-bubble');

        if (role === 'user') {
            bubble.textContent = text;
            // Render image thumbnails
            for (const att of attachments) {
                if (att.dataUrl && att.type?.startsWith('image/')) {
                    const img = document.createElement('img');
                    img.src = att.dataUrl;
                    img.className = 'ch-thumb';
                    img.alt = att.name ?? 'image';
                    bubble.appendChild(img);
                } else if (att.name) {
                    const badge = document.createElement('div');
                    badge.style.cssText = 'font-size:11px;color:#94a3b8;margin-top:4px;';
                    badge.textContent = `📎 ${att.name}`;
                    bubble.appendChild(badge);
                }
            }
        } else {
            bubble.innerHTML = _mdToHtml(text);
        }

        this._msgsEl().appendChild(row);
        this._scrollToBottom();
    }

    _makeBubbleRow(role) {
        const row = document.createElement('div');
        row.className = `ch-bubble-row ${role}`;
        row.innerHTML = `<span class="ch-role-label">${role === 'user' ? 'You' : 'Assistant'}</span>
                         <div class="ch-bubble" part="bubble"></div>`;
        return row;
    }

    _msgsEl() { return this._shadow.querySelector('.ch-messages'); }

    /** Auto-scroll to bottom, unless the user has manually scrolled up. */
    _scrollToBottom() {
        if (this._userScrolled) return;
        const el = this._msgsEl();
        if (el) el.scrollTop = el.scrollHeight;
    }

    _bus()     { return this.parentElement || document; }
    _escape(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

customElements.define('sg-llm-chat-history', SgLlmChatHistory);
window.SgLlmChatHistory = SgLlmChatHistory;

// ── Module helpers ─────────────────────────────────────────────────────────────

/**
 * Assemble the messages array from conversation turns + optional system prompt.
 * User turns with image attachments produce multimodal content arrays.
 * @param {Array} turns
 * @param {string} systemPrompt
 * @returns {Array<{role:string, content:string|Array}>}
 */
function _assembleMsgs(turns, systemPrompt) {
    const msgs = [];
    if (systemPrompt?.trim()) {
        msgs.push({ role: 'system', content: systemPrompt.trim() });
    }
    for (const t of turns) {
        if (t.role === 'assistant') {
            msgs.push({ role: 'assistant', content: t.content });
            continue;
        }
        // User turn
        const images  = (t.attachments ?? []).filter(a => a.dataUrl && a.type?.startsWith('image/'));
        const textAtt = (t.attachments ?? []).filter(a => a.textContent);
        let text = t.content ?? '';
        for (const att of textAtt) {
            text += `\n\n--- Attachment: ${att.name} ---\n${att.textContent}`;
        }
        if (images.length > 0) {
            const parts = [{ type: 'text', text }];
            for (const img of images) {
                parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
            }
            msgs.push({ role: 'user', content: parts });
        } else {
            msgs.push({ role: 'user', content: text });
        }
    }
    return msgs;
}

/**
 * Raw text → safe HTML for streaming display.
 * Escapes HTML entities and converts newlines to <br>.
 * Used during streaming to avoid broken partial markdown artefacts.
 * @param {string} text
 * @returns {string}
 */
function _rawToHtml(text) {
    if (!text) return '';
    return _esc(text).replace(/\n/g, '<br>');
}

/**
 * Minimal markdown → HTML converter. Handles: code blocks, inline code,
 * headings, bold, italic, links, lists. No external deps.
 * Used for completed assistant turns only (not during streaming).
 * @param {string} md
 * @returns {string}
 */
function _mdToHtml(md) {
    if (!md) return '';
    let s = md;
    // Code blocks
    s = s.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, c) =>
        `<pre><code>${_esc(c.trim())}</code></pre>`);
    // Inline code
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${_esc(c)}</code>`);
    // Headings
    s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
    s = s.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
    // Bold + italic
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g,         '<em>$1</em>');
    // Links
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Lists (simple — convert lines starting with - or * or 1.)
    s = s.replace(/((?:^[-*] .+\n?)+)/gm, m => {
        const items = m.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /, '')}</li>`);
        return `<ul>${items.join('')}</ul>`;
    });
    s = s.replace(/((?:^\d+\. .+\n?)+)/gm, m => {
        const items = m.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`);
        return `<ol>${items.join('')}</ol>`;
    });
    // Paragraphs: double newlines → <p>
    s = s.split(/\n\n+/).map(p =>
        p.startsWith('<') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`
    ).join('');
    return s;
}

function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
