/**
 * sg-llm-chat-input — Message input bar with file/image attachment support.
 *
 * Accepts text (Shift+Enter = newline, Enter = send) and file attachments
 * (file picker, drag-and-drop, clipboard paste). Emits `llm:chat-message`
 * with { text, attachments } when user submits.
 *
 * During in-flight requests the textarea stays writable (user can compose
 * the next message) but the Send button is disabled until the response
 * completes. A Cancel button appears in place of Send.
 *
 * Consumes (on parentElement):
 *   llm:request-start    — disables Send, shows Cancel; textarea stays active
 *   llm:request-complete — re-enables Send, hides Cancel
 *   llm:request-error    — re-enables Send, hides Cancel
 *   llm:request-cancel   — re-enables Send, hides Cancel
 *
 * Emits (on parentElement):
 *   llm:chat-message  — { text, attachments: [{id,name,type,size,dataUrl?,textContent?}] }
 *   llm:cancel        — user clicked Cancel during in-flight request
 *
 * Public API:
 *   input.clear()            → clear text and attachments
 *   input.focus()            → focus the textarea
 *   input.setDisabled(bool)  → programmatic full disable (textarea + send)
 *
 * @module sg-llm-chat-input
 * @version 0.1.1
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const CHAT_MESSAGE = 'llm:chat-message';

const TEXT_EXTS = new Set(['txt','md','js','ts','json','yaml','yml','toml','xml',
    'csv','html','css','py','sh','go','rs','java','c','cpp','h']);

const CSS = `
:host { display: block; }
.ci-wrap {
    font-family: system-ui, sans-serif;
    background: #0d0d1a;
    border-top: 1px solid #1e2035;
    padding: 10px 12px;
}
.ci-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
}
.ci-attachments:empty { display: none; }
.ci-att-badge {
    display: flex;
    align-items: center;
    gap: 5px;
    background: #12122a;
    border: 1px solid #2d3060;
    border-radius: 4px;
    padding: 3px 6px 3px 8px;
    font-size: 11px;
    color: #94a3b8;
    max-width: 160px;
}
.ci-att-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 110px;
}
.ci-att-thumb {
    width: 32px;
    height: 32px;
    object-fit: cover;
    border-radius: 3px;
    flex-shrink: 0;
}
.ci-att-remove {
    background: none;
    border: none;
    color: #475569;
    cursor: pointer;
    padding: 0 2px;
    font-size: 12px;
    flex-shrink: 0;
    line-height: 1;
}
.ci-att-remove:hover { color: #f87171; }
.ci-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
}
.ci-textarea-wrap {
    flex: 1;
    position: relative;
    background: #12122a;
    border: 1px solid #2d3060;
    border-radius: 8px;
    transition: border-color 0.12s;
}
.ci-textarea-wrap:focus-within { border-color: #7c9ef8; }
.ci-textarea-wrap.drag-over { border-color: #4ade80; background: #0d2a1a; }
textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    background: transparent;
    color: #e2e8f0;
    border: none;
    outline: none;
    padding: 10px 40px 10px 12px;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    resize: none;
    min-height: 44px;
    max-height: 160px;
    overflow-y: auto;
}
textarea::placeholder { color: #2a2a4a; }
textarea:disabled { opacity: 0.4; cursor: not-allowed; }
.ci-attach-btn {
    position: absolute;
    bottom: 7px;
    right: 8px;
    background: none;
    border: none;
    color: #475569;
    cursor: pointer;
    font-size: 16px;
    padding: 2px;
    line-height: 1;
    transition: color 0.12s;
}
.ci-attach-btn:hover { color: #94a3b8; }
.ci-send-btn, .ci-cancel-btn {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s;
}
.ci-send-btn {
    background: #1e2860;
    color: #7c9ef8;
}
.ci-send-btn:hover:not(:disabled) { background: #2d3880; }
.ci-send-btn:disabled { opacity: 0.35; cursor: default; }
.ci-cancel-btn {
    background: #2a0d0d;
    color: #f87171;
    display: none;
}
.ci-cancel-btn:hover { background: #3d1515; }
.ci-cancel-btn.visible { display: flex; }
.ci-hint {
    font-size: 10px;
    color: #2a2a4a;
    margin-top: 6px;
    text-align: right;
}
`;

export class SgLlmChatInput extends HTMLElement {

    constructor() {
        super();
        this._attachments   = [];   // [{id, name, type, size, dataUrl?, textContent?}]
        this._disabled      = false;
        this._requesting    = false;
        this._boundHandlers = {};
        this._shadow        = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._render();
        this._bindEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [ev, fn] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(ev, fn);
        }
        document.removeEventListener('paste', this._boundHandlers._paste);
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /** Clear text input and all attachments. */
    clear() {
        const ta = this._ta();
        if (ta) { ta.value = ''; this._resize(ta); }
        this._attachments = [];
        this._renderAttachments();
    }

    /** Focus the textarea. */
    focus() { this._ta()?.focus(); }

    /**
     * Programmatic full disable — disables both textarea and send button.
     * Separate from the per-request requesting state.
     * @param {boolean} disabled
     */
    setDisabled(disabled) {
        this._disabled = disabled;
        const ta = this._ta();
        if (ta) ta.disabled = disabled;
        const send = this._shadow.querySelector('.ci-send-btn');
        if (send) send.disabled = disabled;
    }

    // ── LLM event binding ──────────────────────────────────────────────────

    _bindEvents() {
        const bus = this._bus();
        const on  = (ev, fn) => {
            const bound = fn.bind(this);
            this._boundHandlers[ev] = bound;
            bus.addEventListener(ev, bound);
        };
        on(SGL_LLM.REQUEST_START,    this._onRequestStart);
        on(SGL_LLM.REQUEST_COMPLETE, this._onRequestDone);
        on(SGL_LLM.REQUEST_ERROR,    this._onRequestDone);
        on(SGL_LLM.REQUEST_CANCEL,   this._onRequestDone);

        // Clipboard paste (document level for images)
        const pasteHandler = this._onPaste.bind(this);
        this._boundHandlers._paste = pasteHandler;
        document.addEventListener('paste', pasteHandler);
    }

    /**
     * Request started — keep textarea writable so user can compose next
     * message, but disable Send and show Cancel.
     */
    _onRequestStart() {
        this._requesting = true;
        const send   = this._shadow.querySelector('.ci-send-btn');
        const cancel = this._shadow.querySelector('.ci-cancel-btn');
        if (send)   send.disabled = true;
        if (cancel) cancel.classList.add('visible');
    }

    /** Request finished (complete / error / cancel) — restore Send. */
    _onRequestDone() {
        this._requesting = false;
        const send   = this._shadow.querySelector('.ci-send-btn');
        const cancel = this._shadow.querySelector('.ci-cancel-btn');
        if (send)   send.disabled = this._disabled;
        if (cancel) cancel.classList.remove('visible');
    }

    // ── Input + attachment handling ────────────────────────────────────────

    _onKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this._send();
        }
    }

    _send() {
        if (this._disabled || this._requesting) return;
        const ta   = this._ta();
        const text = ta?.value?.trim() ?? '';
        if (!text && this._attachments.length === 0) return;

        this._bus().dispatchEvent(new CustomEvent(CHAT_MESSAGE, {
            detail: { text, attachments: [...this._attachments] },
            bubbles: true, composed: true,
        }));

        this.clear();
        ta?.focus();
    }

    _cancel() {
        this._bus().dispatchEvent(new CustomEvent(SGL_LLM.CANCEL, {
            detail: {}, bubbles: true, composed: true,
        }));
    }

    /**
     * Clipboard paste handler — intercept image pastes when this component
     * has focus inside its shadow root.
     * Uses shadowRoot.activeElement (standard API) for reliable shadow DOM
     * focus detection.
     */
    _onPaste(e) {
        if (!this._shadow.activeElement) return;
        const items = e.clipboardData?.items ?? [];
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) this._readFile(file);
            }
        }
    }

    _onFilesPicked(e) {
        for (const file of e.target.files ?? []) this._readFile(file);
        e.target.value = '';
    }

    _onDrop(e) {
        e.preventDefault();
        this._shadow.querySelector('.ci-textarea-wrap').classList.remove('drag-over');
        for (const file of e.dataTransfer?.files ?? []) this._readFile(file);
    }

    _readFile(file) {
        const ext  = file.name.split('.').pop().toLowerCase();
        const isImg = file.type.startsWith('image/');
        const isTxt = TEXT_EXTS.has(ext) || file.type.startsWith('text/');

        const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        if (isImg) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                this._addAttachment({ id, name: file.name, type: file.type, size: file.size, dataUrl: ev.target.result });
            };
            reader.readAsDataURL(file);
        } else if (isTxt) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                this._addAttachment({ id, name: file.name, type: file.type || 'text/plain', size: file.size, textContent: ev.target.result });
            };
            reader.readAsText(file);
        }
    }

    _addAttachment(att) {
        this._attachments.push(att);
        this._renderAttachments();
    }

    _removeAttachment(id) {
        this._attachments = this._attachments.filter(a => a.id !== id);
        this._renderAttachments();
    }

    _renderAttachments() {
        const el = this._shadow.querySelector('.ci-attachments');
        if (!el) return;
        el.innerHTML = '';
        for (const att of this._attachments) {
            const badge = document.createElement('div');
            badge.className = 'ci-att-badge';
            if (att.dataUrl && att.type?.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = att.dataUrl;
                img.className = 'ci-att-thumb';
                img.alt = att.name;
                badge.appendChild(img);
            } else {
                badge.appendChild(Object.assign(document.createElement('span'), { textContent: '📎' }));
            }
            const name = document.createElement('span');
            name.className   = 'ci-att-name';
            name.textContent = att.name;
            name.title       = att.name;
            badge.appendChild(name);
            const rm = document.createElement('button');
            rm.className   = 'ci-att-remove';
            rm.textContent = '✕';
            rm.title       = 'Remove';
            rm.addEventListener('click', () => this._removeAttachment(att.id));
            badge.appendChild(rm);
            el.appendChild(badge);
        }
    }

    // ── DOM ────────────────────────────────────────────────────────────────

    _render() {
        this._shadow.innerHTML = `
            <style>${CSS}</style>
            <div class="ci-wrap" part="wrap">
                <div class="ci-attachments" part="attachments"></div>
                <div class="ci-row">
                    <div class="ci-textarea-wrap" part="textarea-wrap">
                        <textarea placeholder="Type a message… (Enter to send, Shift+Enter for newline)" rows="1"></textarea>
                        <button class="ci-attach-btn" title="Attach file">📎</button>
                    </div>
                    <button class="ci-send-btn" title="Send">▶</button>
                    <button class="ci-cancel-btn" title="Cancel">✕</button>
                </div>
                <div class="ci-hint">Drag & drop files · Ctrl+V to paste images</div>
            </div>
            <input type="file" style="display:none" multiple accept="image/*,.txt,.md,.js,.ts,.json,.yaml,.yml,.toml,.xml,.csv,.html,.css,.py,.sh,.go,.rs,.java,.c,.cpp,.h">`;

        const ta    = this._shadow.querySelector('textarea');
        const wrap  = this._shadow.querySelector('.ci-textarea-wrap');
        const send  = this._shadow.querySelector('.ci-send-btn');
        const cancel= this._shadow.querySelector('.ci-cancel-btn');
        const attach= this._shadow.querySelector('.ci-attach-btn');
        const pick  = this._shadow.querySelector('input[type="file"]');

        ta.addEventListener('keydown',  (e) => this._onKeydown(e));
        ta.addEventListener('input',    () => this._resize(ta));

        wrap.addEventListener('dragover',  (e) => { e.preventDefault(); wrap.classList.add('drag-over'); });
        wrap.addEventListener('dragleave', ()  => wrap.classList.remove('drag-over'));
        wrap.addEventListener('drop',      (e) => this._onDrop(e));

        send.addEventListener('click',   () => this._send());
        cancel.addEventListener('click', () => this._cancel());

        attach.addEventListener('click', () => pick.click());
        pick.addEventListener('change',  (e) => this._onFilesPicked(e));
    }

    _ta()       { return this._shadow.querySelector('textarea'); }
    _bus()      { return this.parentElement || document; }

    _resize(ta) {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
}

customElements.define('sg-llm-chat-input', SgLlmChatInput);
window.SgLlmChatInput = SgLlmChatInput;
