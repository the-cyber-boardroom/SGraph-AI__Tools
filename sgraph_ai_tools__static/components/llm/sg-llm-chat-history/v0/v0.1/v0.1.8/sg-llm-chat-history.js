/**
 * sg-llm-chat-history — Multi-turn conversation display and state manager.
 *
 * Owns the conversation turn array. Displays alternating user/assistant
 * bubbles with live streaming. Assembles the full messages array (including
 * history and optional system prompt) and emits SEND on each new user turn.
 *
 * Changes from v0.1.1:
 *   - Assistant bubbles render images returned by the provider.
 *     Images come from e.detail.images[] on REQUEST_COMPLETE (requires
 *     sg-llm-request v0.1.1+). OpenAI image_url and Anthropic base64 formats
 *     are both supported.
 *   - _bus() updated to walk ancestors for [data-llm-bus] attribute, enabling
 *     use inside sg-layout panels (backwards compatible with parentElement).
 *   - Tracks attachments from sg-llm-attachment-manager via
 *     llm:attachment-added / llm:attachment-removed / llm:attachments-cleared.
 *     When chat-message fires, the internally tracked attachments are merged
 *     with any attachments from the event (so both wiring patterns work).
 *     After SEND, emits llm:attachments-cleared to reset attachment-manager.
 *
 * Listens for `llm:chat-message` from sg-llm-chat-input, adds the user
 * bubble, then fires SGL_LLM.SEND with the complete messages array.
 *
 * Consumes (on [data-llm-bus] ancestor):
 *   llm:chat-message         — { text, attachments? } → adds user turn, emits SEND
 *   llm:connected            — { provider, model } → stores for SEND
 *   llm:model-changed        — { model } → updates stored model
 *   llm:request-start        — shows streaming cursor
 *   llm:request-chunk        — { accumulated } → updates streaming bubble (raw text)
 *   llm:request-complete     — { content, images? } → finalises assistant bubble
 *   llm:request-error        — { error } → shows error in bubble
 *   llm:request-cancel       — marks bubble cancelled
 *   llm:attachment-added     — { attachment } → tracks in internal _attachments[]
 *   llm:attachment-removed   — { id } → removes from _attachments[]
 *   llm:attachments-cleared  — → clears _attachments[]
 *
 * Emits (on [data-llm-bus] ancestor):
 *   llm:send              — { messages[], model, provider, mode: 'build' }
 *   llm:attachments-cleared — after SEND to reset attachment-manager UI
 *
 * Public API:
 *   history.getMessages()         → [{role,content}] for external inspection
 *   history.setSystemPrompt(text) → set/update system prompt
 *   history.clear()               → wipe all turns
 *   history.exportMarkdown()      → conversation as markdown string
 *
 * Changes from v0.1.2:
 *   - Lightbox: double-click any image in the chat (assistant response images
 *     and user attachment thumbnails) to open a fullscreen overlay.
 *     The lightbox dims the rest of the UI and centres the image at full
 *     available size. Close by clicking the overlay, pressing Escape, or
 *     using the × button. Navigation arrows (← →) cycle through all images
 *     in the current conversation if multiple images are present.
 *
 * @module sg-llm-chat-history
 * @version 0.1.8 (debug)
 *
 * Changes from v0.1.7:
 *   - Temporary debug logging in _onBundleLoaded() to diagnose chat restore.
 *
 * Changes from v0.1.6:
 *   - Bundle restore: skip setState() when bundle.chat has no turns and no
 *     system prompt — avoids silently wiping the current chat for older bundles
 *     that were saved without chat state. Clicking those bundles now restores
 *     model/connection settings only (handled by sg-llm-connection).
 *   - Attachment deduplication: _onChatMessage now uses ONLY the internally
 *     tracked _attachments[] (from llm:attachment-added events). The event
 *     detail.attachments field is used as fallback only when no tracked
 *     attachments are present. This prevents double images when both
 *     sg-llm-chat-input and sg-llm-attachment-manager capture the same paste.
 *
 * Changes from v0.1.3:
 *   - getState() / setState() public API for bundle capture and restore.
 *   - Listens for llm:bundle-loaded: if bundle.chat exists, calls setState()
 *     to restore turns + system prompt. Model name displayed as a toast if
 *     bundle.config.model differs from the current model.
 *
 * Changes from v0.1.4:
 *   - User bubbles now rendered via _mdToHtml() instead of textContent, so
 *     newlines and markdown formatting (headings, code fences, bold, etc.)
 *     display correctly in user messages.
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
/* Assistant response images */
.ch-resp-img {
    display: block;
    max-width: 100%;
    max-height: 320px;
    border-radius: 6px;
    margin-top: 8px;
    border: 1px solid #1e2035;
    cursor: zoom-in;
    object-fit: contain;
    transition: opacity 0.1s;
}
.ch-resp-img:hover { opacity: 0.88; }

/* Per-bubble action toolbar */
.ch-bubble-actions {
    display: flex;
    gap: 4px;
    margin-top: 4px;
    opacity: 0;
    transition: opacity 0.15s;
}
.ch-bubble-row:hover .ch-bubble-actions { opacity: 1; }
.ch-copy-btn {
    font-family: monospace;
    font-size: 10px;
    background: #1e2035;
    color: #64748b;
    border: 1px solid #2d3060;
    border-radius: 4px;
    padding: 2px 7px;
    cursor: pointer;
    transition: color 0.12s, background 0.12s;
    white-space: nowrap;
}
.ch-copy-btn:hover { color: #e2e8f0; background: #283452; }
.ch-copy-btn.copied { color: #4ade80; border-color: #166534; }

/* Lightbox overlay */
.ch-lightbox {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0,0,0,0.88);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: ch-lb-in 0.15s ease;
    cursor: zoom-out;
}
@keyframes ch-lb-in {
    from { opacity: 0; }
    to   { opacity: 1; }
}
.ch-lightbox.hidden { display: none; }
.ch-lightbox__img {
    max-width: 92vw;
    max-height: 92vh;
    object-fit: contain;
    border-radius: 6px;
    box-shadow: 0 8px 48px rgba(0,0,0,0.8);
    cursor: default;
    user-select: none;
}
.ch-lightbox__close {
    position: fixed;
    top: 16px;
    right: 20px;
    font-size: 28px;
    color: #e2e8f0;
    background: none;
    border: none;
    cursor: pointer;
    line-height: 1;
    opacity: 0.7;
    transition: opacity 0.12s;
    z-index: 10000;
}
.ch-lightbox__close:hover { opacity: 1; }
.ch-lightbox__nav {
    position: fixed;
    top: 50%;
    transform: translateY(-50%);
    font-size: 32px;
    color: #e2e8f0;
    background: rgba(0,0,0,0.4);
    border: none;
    cursor: pointer;
    padding: 8px 14px;
    border-radius: 6px;
    opacity: 0.6;
    transition: opacity 0.12s, background 0.12s;
    z-index: 10000;
    line-height: 1;
}
.ch-lightbox__nav:hover { opacity: 1; background: rgba(0,0,0,0.7); }
.ch-lightbox__nav.prev { left: 16px; }
.ch-lightbox__nav.next { right: 16px; }
.ch-lightbox__nav:disabled { opacity: 0.15; cursor: default; }
.ch-lightbox__counter {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    color: #94a3b8;
    font-size: 12px;
    font-family: monospace;
    z-index: 10000;
}
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
        this._attachments   = [];    // tracked from sg-llm-attachment-manager events
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
        if (this._lbKeyHandler) {
            document.removeEventListener('keydown', this._lbKeyHandler);
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

    /**
     * Return a serialisable snapshot of current chat state for bundle capture.
     * @returns {{ turns: Array, systemPrompt: string }}
     */
    getState() {
        return {
            turns: JSON.parse(JSON.stringify(this._turns)),
            systemPrompt: this._systemPrompt,
        };
    }

    /**
     * Restore chat state from a previously captured snapshot (bundle restore).
     * Replaces all turns and system prompt then re-renders.
     * @param {{ turns: Array, systemPrompt?: string }} state
     */
    setState(state) {
        this._turns        = Array.isArray(state?.turns) ? state.turns : [];
        this._systemPrompt = state?.systemPrompt ?? '';
        this._streamingEl  = null;
        this._streamingText = '';

        // Update the system prompt textarea if rendered
        const ta = this._shadow.querySelector('.ch-system-body textarea');
        if (ta) ta.value = this._systemPrompt;

        this._renderMessages();
        this._scrollToBottom();
    }

    // ── Event binding ──────────────────────────────────────────────────────

    _bindEvents() {
        const bus = this._bus();
        const on  = (ev, fn) => {
            const bound = fn.bind(this);
            this._boundHandlers[ev] = bound;
            bus.addEventListener(ev, bound);
        };
        on(CHAT_MESSAGE,                   this._onChatMessage);
        on(SGL_LLM.CONNECTED,             this._onConnected);
        on(SGL_LLM.MODEL_CHANGED,         this._onModelChanged);
        on(SGL_LLM.REQUEST_START,         this._onRequestStart);
        on(SGL_LLM.REQUEST_CHUNK,         this._onRequestChunk);
        on(SGL_LLM.REQUEST_COMPLETE,      this._onRequestComplete);
        on(SGL_LLM.REQUEST_ERROR,         this._onRequestError);
        on(SGL_LLM.REQUEST_CANCEL,        this._onRequestCancel);
        on(SGL_LLM.ATTACHMENT_ADDED,      this._onAttachmentAdded);
        on(SGL_LLM.ATTACHMENT_REMOVED,    this._onAttachmentRemoved);
        on(SGL_LLM.ATTACHMENTS_CLEARED,   this._onAttachmentsCleared);
        on(SGL_LLM.BUNDLE_LOADED,         this._onBundleLoaded);
    }

    _onChatMessage(e) {
        const { text = '' } = e.detail ?? {};
        // Prefer internally tracked attachments (from llm:attachment-added events via
        // sg-llm-attachment-manager). Fall back to event detail only when the internal
        // list is empty — this handles the standalone chat-input-only case and prevents
        // double images when both components capture the same paste event.
        const eventAtts  = e.detail?.attachments ?? [];
        const allAtts    = this._attachments.length > 0 ? [...this._attachments] : eventAtts;
        if (!text.trim() && allAtts.length === 0) return;

        // Add user bubble
        const turn = { role: 'user', content: text, attachments: allAtts };
        this._turns.push(turn);
        this._addBubble('user', text, allAtts);

        // Clear internal attachment tracking and notify attachment-manager to reset
        this._attachments = [];
        this._bus().dispatchEvent(new CustomEvent(SGL_LLM.ATTACHMENTS_CLEARED, {
            bubbles: true, composed: true, detail: {},
        }));

        // Emit SEND with full history
        const messages = _assembleMsgs(this._turns, this._systemPrompt);
        this._bus().dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
            detail: { messages, model: this._model, provider: this._provider, mode: 'build' },
            bubbles: true, composed: true,
        }));
    }

    _onAttachmentAdded(e) {
        const att = e.detail?.attachment;
        if (att) this._attachments.push(att);
    }

    _onAttachmentRemoved(e) {
        const id = e.detail?.id;
        if (id != null) this._attachments = this._attachments.filter(a => a.id !== id);
    }

    _onAttachmentsCleared() {
        this._attachments = [];
    }

    _onBundleLoaded(e) {
        const bundle = e.detail?.bundle;
        console.group('[sg-llm-chat-history] _onBundleLoaded');
        console.log('bundle received:', !!bundle);
        console.log('bundle.chat:', bundle?.chat);
        if (!bundle?.chat) {
            console.warn('→ skip: no bundle.chat field');
            console.groupEnd();
            return;
        }
        const { turns = [], systemPrompt = '' } = bundle.chat;
        console.log('turns.length:', turns.length, '| systemPrompt:', systemPrompt || '(empty)');
        if (!turns.length && !systemPrompt) {
            console.warn('→ skip: empty turns and no systemPrompt');
            console.groupEnd();
            return;
        }
        console.log('→ calling setState with', turns.length, 'turns');
        console.groupEnd();
        this.setState(bundle.chat);
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

    /** Response complete — replace raw text with fully-rendered markdown + images. */
    _onRequestComplete(e) {
        const content = e.detail?.content ?? this._streamingText;
        const images  = e.detail?.images  ?? [];
        if (this._streamingEl) {
            this._streamingEl.innerHTML = _mdToHtml(content);
            // Append any images returned by the provider
            for (const imgObj of images) {
                const url = imgObj?.image_url?.url
                    || (imgObj?.source?.type === 'base64'
                        ? `data:${imgObj.source.media_type};base64,${imgObj.source.data}`
                        : null);
                if (url) {
                    const img = document.createElement('img');
                    img.src       = url;
                    img.className = 'ch-resp-img';
                    img.alt       = 'Response image';
                    img.title     = 'Click to open full size';
                    img.addEventListener('click', () => _openInTab(url));
                    this._streamingEl.appendChild(img);
                }
            }
            this._streamingEl = null;
        }
        this._turns.push({ role: 'assistant', content, images });
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
            </div>
            <!-- Lightbox (hidden until triggered) -->
            <div class="ch-lightbox hidden" id="ch-lb">
                <button class="ch-lightbox__close" id="ch-lb-close" title="Close (Esc)">×</button>
                <button class="ch-lightbox__nav prev" id="ch-lb-prev" title="Previous image">‹</button>
                <img class="ch-lightbox__img" id="ch-lb-img" alt="Full size image">
                <button class="ch-lightbox__nav next" id="ch-lb-next" title="Next image">›</button>
                <div class="ch-lightbox__counter" id="ch-lb-counter"></div>
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

        // Double-click on any image → open lightbox
        msgs.addEventListener('dblclick', (e) => {
            const img = e.target.closest('img');
            if (img) this._openLightbox(img.src);
        });

        this._initLightbox();
    }

    /** Wire up lightbox controls. */
    _initLightbox() {
        const lb      = this._shadow.getElementById('ch-lb');
        const lbImg   = this._shadow.getElementById('ch-lb-img');
        const lbClose = this._shadow.getElementById('ch-lb-close');
        const lbPrev  = this._shadow.getElementById('ch-lb-prev');
        const lbNext  = this._shadow.getElementById('ch-lb-next');

        // Click overlay background → close
        lb.addEventListener('click', (e) => { if (e.target === lb) this._closeLightbox(); });
        lbClose.addEventListener('click', () => this._closeLightbox());
        lbPrev.addEventListener('click',  (e) => { e.stopPropagation(); this._lbNavigate(-1); });
        lbNext.addEventListener('click',  (e) => { e.stopPropagation(); this._lbNavigate(+1); });

        // Keyboard: Escape closes, arrows navigate
        this._lbKeyHandler = (e) => {
            if (lb.classList.contains('hidden')) return;
            if (e.key === 'Escape')      this._closeLightbox();
            if (e.key === 'ArrowLeft')   this._lbNavigate(-1);
            if (e.key === 'ArrowRight')  this._lbNavigate(+1);
        };
        document.addEventListener('keydown', this._lbKeyHandler);
    }

    /**
     * Collect all <img> src values currently rendered in the messages area.
     * @returns {string[]}
     */
    _collectImageSrcs() {
        return [...this._msgsEl().querySelectorAll('img')].map(i => i.src);
    }

    /**
     * Open the lightbox showing the given src.
     * @param {string} src
     */
    _openLightbox(src) {
        this._lbSrcs = this._collectImageSrcs();
        this._lbIdx  = this._lbSrcs.indexOf(src);
        if (this._lbIdx < 0) { this._lbIdx = 0; this._lbSrcs = [src]; }
        this._lbRefresh();
        this._shadow.getElementById('ch-lb').classList.remove('hidden');
    }

    _closeLightbox() {
        this._shadow.getElementById('ch-lb').classList.add('hidden');
    }

    /** @param {number} dir +1 or -1 */
    _lbNavigate(dir) {
        if (!this._lbSrcs?.length) return;
        this._lbIdx = (this._lbIdx + dir + this._lbSrcs.length) % this._lbSrcs.length;
        this._lbRefresh();
    }

    _lbRefresh() {
        const img     = this._shadow.getElementById('ch-lb-img');
        const prev    = this._shadow.getElementById('ch-lb-prev');
        const next    = this._shadow.getElementById('ch-lb-next');
        const counter = this._shadow.getElementById('ch-lb-counter');
        const total   = this._lbSrcs.length;
        img.src = this._lbSrcs[this._lbIdx];
        prev.disabled    = total <= 1;
        next.disabled    = total <= 1;
        counter.textContent = total > 1 ? `${this._lbIdx + 1} / ${total}` : '';
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
            this._addBubble(t.role, text, t.attachments ?? [], t.images ?? []);
        }
    }

    _addBubble(role, text, attachments = [], images = []) {
        const empty = this._msgsEl().querySelector('.ch-empty');
        if (empty) empty.remove();

        const row     = this._makeBubbleRow(role);
        const bubble  = row.querySelector('.ch-bubble');
        const actions = row.querySelector('.ch-bubble-actions');

        if (role === 'user') {
            bubble.innerHTML = _mdToHtml(text);
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
            for (const imgObj of images) {
                const url = imgObj?.image_url?.url
                    || (imgObj?.source?.type === 'base64'
                        ? `data:${imgObj.source.media_type};base64,${imgObj.source.data}`
                        : null);
                if (url) {
                    const img = document.createElement('img');
                    img.src       = url;
                    img.className = 'ch-resp-img';
                    img.alt       = 'Response image';
                    img.title     = 'Double-click to enlarge';
                    img.addEventListener('dblclick', () => this._openLightbox(url));
                    bubble.appendChild(img);
                    // "Open ↗" button directly after each image
                    const openBtn = document.createElement('button');
                    openBtn.className = 'ch-copy-btn';
                    openBtn.style.cssText = 'opacity:1;display:block;margin-top:3px;';
                    openBtn.textContent = 'Open ↗';
                    openBtn.title = 'Open image full size';
                    openBtn.addEventListener('click', (e) => { e.stopPropagation(); _openInTab(url); });
                    bubble.appendChild(openBtn);
                }
            }
        }

        // Copy-text button in the hover toolbar
        if (actions) {
            actions.appendChild(this._makeCopyBtn(() => text));
        }

        this._msgsEl().appendChild(row);
        this._scrollToBottom();
    }

    _makeBubbleRow(role) {
        const row = document.createElement('div');
        row.className = `ch-bubble-row ${role}`;
        row.innerHTML = `<span class="ch-role-label">${role === 'user' ? 'You' : 'Assistant'}</span>
                         <div class="ch-bubble" part="bubble"></div>
                         <div class="ch-bubble-actions"></div>`;
        return row;
    }

    /**
     * Create a "Copy" button that copies text to clipboard and briefly flashes "Copied ✓".
     * @param {function} getTextFn  Called at click-time to get the text to copy
     * @returns {HTMLButtonElement}
     */
    _makeCopyBtn(getTextFn) {
        const btn = document.createElement('button');
        btn.className = 'ch-copy-btn';
        btn.textContent = 'Copy';
        btn.title = 'Copy to clipboard';
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                await navigator.clipboard.writeText(getTextFn() || '');
                btn.textContent = 'Copied ✓';
                btn.classList.add('copied');
                setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
            } catch {
                btn.textContent = 'Failed';
                setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
            }
        });
        return btn;
    }

    _msgsEl() { return this._shadow.querySelector('.ch-messages'); }

    /** Auto-scroll to bottom, unless the user has manually scrolled up. */
    _scrollToBottom() {
        if (this._userScrolled) return;
        const el = this._msgsEl();
        if (el) el.scrollTop = el.scrollHeight;
    }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }
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

/**
 * Open a URL in a new tab. For data: URLs, converts to a Blob URL first
 * because browsers block window.open() with data: URLs as a security policy.
 * @param {string} url
 */
async function _openInTab(url) {
    let target = url;
    if (url.startsWith('data:')) {
        const blob   = await fetch(url).then(r => r.blob());
        target       = URL.createObjectURL(blob);
        // Revoke after a generous delay to allow the tab to fully load.
        setTimeout(() => URL.revokeObjectURL(target), 60_000);
    }
    window.open(target, '_blank');
}
