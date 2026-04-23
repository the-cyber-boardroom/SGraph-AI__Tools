/**
 * sg-llm-attachment-manager — Standalone file attachment UI component.
 *
 * Handles all user input paths for adding files to an LLM request:
 *   - Click-to-browse file picker
 *   - Drag-and-drop onto the component
 *   - Clipboard paste (images via Ctrl+V / right-click paste)
 *
 * Displays a preview row: image thumbnails and filename badges, each with
 * a remove button. Maintains an internal attachment list and broadcasts
 * changes to the event bus using the standard SGL_LLM attachment events.
 *
 * Can be composed alongside sg-llm-chat-input (for attachments in chat),
 * sg-llm-reality (for attachments in one-shot), or any other component
 * that consumes attachment events.
 *
 * Emits (on parentElement):
 *   llm:attachment-added    — { attachment: { id, name, type, size, dataUrl?, textContent? } }
 *   llm:attachment-removed  — { id }
 *   llm:attachments-cleared — {}
 *
 * Consumes (on parentElement):
 *   llm:request-start    — optionally disables input (if disable-on-send attr set)
 *   llm:request-complete — re-enables input
 *   llm:request-error    — re-enables input
 *   llm:request-cancel   — re-enables input
 *
 * Public API:
 *   manager.getAttachments()          → current attachment array (copy)
 *   manager.clear()                   → remove all attachments
 *   manager.addFile(file)             → programmatically add a File object
 *   manager.removeAttachment(id)      → remove by id
 *
 * Attributes:
 *   accept         — file picker accept string (default: images + common text types)
 *   multiple       — allow multiple files (default: true)
 *   disable-on-send — disable input during in-flight requests (default: false)
 *   placeholder    — text shown in empty drop zone (default: "Attach files…")
 *
 * @module sg-llm-attachment-manager
 * @version 0.1.2
 *
 * Changelog:
 *   v0.1.2: Three fixes:
 *     1. Paste guard now walks into shadow roots to find the real focused element,
 *        preventing double-capture when focus is in sg-llm-chat-input's textarea.
 *     2. Always listens for llm:attachments-cleared (was guarded by disable-on-send).
 *        Clears the panel without re-emitting to avoid event loops.
 *     3. Remove button (✕) color changed to visible #64748b.
 *   v0.1.1: _bus() updated to walk [data-llm-bus] ancestor for sg-layout panel compatibility (backwards compatible).
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const DEFAULT_ACCEPT = 'image/*,.txt,.md,.js,.ts,.json,.yaml,.yml,.toml,.xml,.csv,.html,.css,.py,.sh,.go,.rs,.java,.c,.cpp,.h';

const TEXT_EXTS = new Set([
    'txt','md','js','ts','json','yaml','yml','toml','xml',
    'csv','html','css','py','sh','go','rs','java','c','cpp','h',
]);

const CSS = `
:host {
    display: block;
}
* { box-sizing: border-box; }

.am-root {
    font-family: system-ui, sans-serif;
    background: #0d0d1a;
}

/* ── Drop zone ───────────────────────────────────────────── */
.am-dropzone {
    border: 1px dashed #1e2035;
    border-radius: 6px;
    padding: 8px 10px;
    transition: border-color 0.12s, background 0.12s;
    cursor: pointer;
}
.am-dropzone:hover,
.am-dropzone.drag-over {
    border-color: #4ade80;
    background: #071a0e;
}
.am-dropzone.disabled {
    opacity: 0.45;
    pointer-events: none;
}

/* ── Top row: label + browse button ─────────────────────── */
.am-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
}
.am-label {
    font-size: 11px;
    color: #374151;
    user-select: none;
}
.am-browse-btn {
    font-size: 11px;
    font-family: monospace;
    background: none;
    border: 1px solid #1e2035;
    color: #64748b;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
    white-space: nowrap;
}
.am-browse-btn:hover { color: #e2e8f0; border-color: #374151; }

/* ── Attachment previews ─────────────────────────────────── */
.am-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.am-list:empty { display: none; }

.am-badge {
    display: flex;
    align-items: center;
    gap: 5px;
    background: #12122a;
    border: 1px solid #2d3060;
    border-radius: 4px;
    padding: 3px 6px 3px 6px;
    font-size: 11px;
    color: #94a3b8;
    max-width: 180px;
}
.am-thumb {
    width: 28px;
    height: 28px;
    object-fit: cover;
    border-radius: 3px;
    flex-shrink: 0;
}
.am-icon {
    font-size: 14px;
    flex-shrink: 0;
    line-height: 1;
}
.am-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100px;
    flex: 1;
}
.am-size {
    font-size: 9px;
    color: #374151;
    white-space: nowrap;
    flex-shrink: 0;
}
.am-remove {
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 0 1px;
    font-size: 11px;
    flex-shrink: 0;
    line-height: 1;
    transition: color 0.1s;
}
.am-remove:hover { color: #f87171; }

/* ── Empty hint ──────────────────────────────────────────── */
.am-hint {
    font-size: 10px;
    color: #1e2035;
    text-align: center;
    padding: 4px 0 2px;
    user-select: none;
}
.am-list:not(:empty) + .am-hint { display: none; }
`;

export class SgLlmAttachmentManager extends HTMLElement {

    constructor() {
        super();
        this._attachments   = [];
        this._disabled      = false;
        this._boundHandlers = {};
        this._shadow        = this.attachShadow({ mode: 'open' });
    }

    static get observedAttributes() {
        return ['accept', 'multiple', 'disable-on-send', 'placeholder'];
    }

    connectedCallback() {
        this._render();
        this._bindBusEvents();
        this._bindPaste();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [ev, fn] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(ev, fn);
        }
        if (this._boundHandlers._paste) {
            document.removeEventListener('paste', this._boundHandlers._paste);
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Returns a copy of the current attachment array.
     * @returns {Array<{id:string, name:string, type:string, size:number, dataUrl?:string, textContent?:string}>}
     */
    getAttachments() { return [...this._attachments]; }

    /** Remove all attachments and emit llm:attachments-cleared. */
    clear() {
        this._attachments = [];
        this._renderList();
        this._bus().dispatchEvent(new CustomEvent(SGL_LLM.ATTACHMENTS_CLEARED, {
            detail: {}, bubbles: true, composed: true,
        }));
    }

    /**
     * Programmatically add a File object.
     * @param {File} file
     */
    addFile(file) { this._readFile(file); }

    /**
     * Remove an attachment by id.
     * @param {string} id
     */
    removeAttachment(id) { this._removeAttachment(id); }

    // ── Bus events ─────────────────────────────────────────────────────────

    _bindBusEvents() {
        const bus = this._bus();
        const on  = (ev, fn) => {
            const bound = fn.bind(this);
            this._boundHandlers[ev] = bound;
            bus.addEventListener(ev, bound);
        };
        // Always listen for clear so the panel resets after a message is sent.
        // Clear internally without re-emitting (would cause a loop).
        on(SGL_LLM.ATTACHMENTS_CLEARED, () => {
            this._attachments = [];
            this._renderList();
        });
        if (this.hasAttribute('disable-on-send')) {
            on(SGL_LLM.REQUEST_START,    () => this._setDisabled(true));
            on(SGL_LLM.REQUEST_COMPLETE, () => this._setDisabled(false));
            on(SGL_LLM.REQUEST_ERROR,    () => this._setDisabled(false));
            on(SGL_LLM.REQUEST_CANCEL,   () => this._setDisabled(false));
        }
    }

    _bindPaste() {
        const handler = this._onPaste.bind(this);
        this._boundHandlers._paste = handler;
        document.addEventListener('paste', handler);
    }

    // ── File reading ───────────────────────────────────────────────────────

    _readFile(file) {
        const ext    = file.name.split('.').pop().toLowerCase();
        const isImg  = file.type.startsWith('image/');
        const isTxt  = TEXT_EXTS.has(ext) || file.type.startsWith('text/');
        if (!isImg && !isTxt) return;

        const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        if (isImg) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                this._addAttachment({
                    id, name: file.name, type: file.type,
                    size: file.size, dataUrl: ev.target.result,
                });
            };
            reader.readAsDataURL(file);
        } else {
            const reader = new FileReader();
            reader.onload = (ev) => {
                this._addAttachment({
                    id, name: file.name, type: file.type || 'text/plain',
                    size: file.size, textContent: ev.target.result,
                });
            };
            reader.readAsText(file);
        }
    }

    _addAttachment(att) {
        this._attachments.push(att);
        this._renderList();
        this._bus().dispatchEvent(new CustomEvent(SGL_LLM.ATTACHMENT_ADDED, {
            detail: { attachment: { ...att } },
            bubbles: true, composed: true,
        }));
    }

    _removeAttachment(id) {
        this._attachments = this._attachments.filter(a => a.id !== id);
        this._renderList();
        this._bus().dispatchEvent(new CustomEvent(SGL_LLM.ATTACHMENT_REMOVED, {
            detail: { id }, bubbles: true, composed: true,
        }));
    }

    // ── DOM event handlers ─────────────────────────────────────────────────

    _onDragOver(e) {
        e.preventDefault();
        this._shadow.querySelector('.am-dropzone').classList.add('drag-over');
    }

    _onDragLeave() {
        this._shadow.querySelector('.am-dropzone').classList.remove('drag-over');
    }

    _onDrop(e) {
        e.preventDefault();
        this._shadow.querySelector('.am-dropzone').classList.remove('drag-over');
        for (const file of e.dataTransfer?.files ?? []) this._readFile(file);
    }

    _onPaste(e) {
        // Walk into shadow roots to find the truly-focused element.
        // document.activeElement only returns the shadow HOST when focus is inside
        // a shadow root, so without this the guard fails for components like
        // sg-llm-chat-input that keep their textarea in a shadow DOM.
        let focused = document.activeElement;
        while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
        const isInput = focused && (
            focused.tagName === 'INPUT' ||
            focused.tagName === 'TEXTAREA' ||
            focused.isContentEditable
        );
        if (isInput && !this.contains(focused) && !this.shadowRoot?.contains(focused)) return;

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

    _setDisabled(disabled) {
        this._disabled = disabled;
        const dz = this._shadow.querySelector('.am-dropzone');
        if (dz) dz.classList.toggle('disabled', disabled);
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    _render() {
        const placeholder = this.getAttribute('placeholder') || 'Drop files here or click Browse';
        const accept      = this.getAttribute('accept') || DEFAULT_ACCEPT;
        const multiple    = this.getAttribute('multiple') !== 'false';

        this._shadow.innerHTML = `
        <style>${CSS}</style>
        <div class="am-root" part="root">
            <div class="am-dropzone" part="dropzone">
                <div class="am-header">
                    <span class="am-label" part="label">Attachments</span>
                    <button class="am-browse-btn" part="browse-btn">+ Browse</button>
                </div>
                <div class="am-list" part="list"></div>
                <div class="am-hint" part="hint">${placeholder}</div>
            </div>
        </div>
        <input type="file" style="display:none"${multiple ? ' multiple' : ''} accept="${accept}">`;

        const dz     = this._shadow.querySelector('.am-dropzone');
        const browse = this._shadow.querySelector('.am-browse-btn');
        const pick   = this._shadow.querySelector('input[type="file"]');

        dz.addEventListener('dragover',  (e) => this._onDragOver(e));
        dz.addEventListener('dragleave', ()  => this._onDragLeave());
        dz.addEventListener('drop',      (e) => this._onDrop(e));

        browse.addEventListener('click', () => pick.click());
        pick.addEventListener('change',  (e) => this._onFilesPicked(e));
    }

    _renderList() {
        const el = this._shadow.querySelector('.am-list');
        if (!el) return;
        el.innerHTML = '';

        for (const att of this._attachments) {
            const badge = document.createElement('div');
            badge.className = 'am-badge';
            badge.setAttribute('part', 'badge');

            if (att.dataUrl && att.type?.startsWith('image/')) {
                const img = document.createElement('img');
                img.src       = att.dataUrl;
                img.className = 'am-thumb';
                img.alt       = att.name;
                badge.appendChild(img);
            } else {
                const icon = document.createElement('span');
                icon.className   = 'am-icon';
                icon.textContent = '📎';
                badge.appendChild(icon);
            }

            const name = document.createElement('span');
            name.className   = 'am-name';
            name.textContent = att.name;
            name.title       = att.name;
            badge.appendChild(name);

            const size = document.createElement('span');
            size.className   = 'am-size';
            size.textContent = _fmtSize(att.size);
            badge.appendChild(size);

            const rm = document.createElement('button');
            rm.className   = 'am-remove';
            rm.textContent = '✕';
            rm.title       = 'Remove';
            rm.addEventListener('click', () => this._removeAttachment(att.id));
            badge.appendChild(rm);

            el.appendChild(badge);
        }
    }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }
}

customElements.define('sg-llm-attachment-manager', SgLlmAttachmentManager);
window.SgLlmAttachmentManager = SgLlmAttachmentManager;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a byte count as a human-readable size string.
 * @param {number} bytes
 * @returns {string}
 */
function _fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024)        return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
