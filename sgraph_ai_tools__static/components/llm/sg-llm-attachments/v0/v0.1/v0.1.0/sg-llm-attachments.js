/**
 * sg-llm-attachments — File drop zone, clipboard paste handler, and attachment cache.
 *
 * One instance per tool page. Owns the cache of all attached items (text, images, PDFs).
 * When an item is added it emits ATTACHMENT_ADDED so sg-llm-reality can auto-create
 * Context blocks (text) or track images for multimodal Question content.
 *
 * Input methods:
 *   - Drag & drop files onto the drop zone
 *   - Ctrl+V paste — captures text and screenshots from clipboard
 *   - Browse button — standard file picker
 *
 * Emits (on parentElement):
 *   llm:attachment-added    — { attachment: { id, type, name, size, textContent?, dataUrl? } }
 *   llm:attachment-removed  — { id }
 *   llm:attachments-cleared — {}
 *
 * Consumes (on parentElement):
 *   llm:model-changed  — to show image compatibility warning
 *   llm:bundle-loaded  — to restore cached attachments from a bundle
 *
 * @module sg-llm-attachments
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

/** Text file extensions that are read as UTF-8 text. */
const TEXT_EXTS = new Set([
    'txt', 'md', 'markdown', 'html', 'htm', 'css', 'js', 'mjs', 'ts', 'tsx',
    'json', 'jsonc', 'yaml', 'yml', 'csv', 'xml', 'sh', 'py', 'rb', 'java',
    'c', 'cpp', 'h', 'rs', 'go', 'toml', 'ini', 'env', 'sql', 'graphql',
]);

/** Image MIME types rendered as thumbnails. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

/** Models known NOT to support vision. Used for compatibility warning. */
const NO_VISION_MODELS = new Set(['llama3.2', 'mistral', 'codestral']);

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.att-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0a0a18;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #e2e8f0;
    overflow: hidden;
}

/* ── Header ───────────────────────────── */
.att-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid #1e2a45;
    background: #0d0d1a;
    flex-shrink: 0;
}
.att-title   { font-size: 12px; font-weight: 600; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.05em; flex: 1; }
.att-summary { font-size: 11px; color: #4a5568; }
.clear-btn   { background: none; border: 1px solid #2d3f5e; border-radius: 4px; color: #64748b; font-size: 11px; padding: 3px 8px; cursor: pointer; }
.clear-btn:hover { color: #f87171; border-color: #991b1b; }
.clear-btn.hidden { display: none; }

/* ── Drop zone ────────────────────────── */
.drop-zone {
    margin: 10px;
    padding: 16px;
    border: 2px dashed #1e2a45;
    border-radius: 8px;
    text-align: center;
    color: #4a5568;
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    flex-shrink: 0;
}
.drop-zone.drag-over { border-color: #3b5bdb; background: #0d1a2e; color: #7c9ef8; }
.drop-zone-hint  { margin-bottom: 6px; }
.browse-btn {
    background: #0d1a2e;
    border: 1px solid #2d3f5e;
    border-radius: 4px;
    color: #7c9ef8;
    font-size: 12px;
    padding: 5px 12px;
    cursor: pointer;
    display: inline-block;
}
.browse-btn:hover { background: #111a2e; border-color: #3b5bdb; }

/* ── List ─────────────────────────────── */
.att-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 10px 10px;
    scrollbar-width: thin;
    scrollbar-color: #222d4d transparent;
}
.att-empty { text-align: center; color: #4a5568; padding: 12px; font-size: 12px; }

/* ── Item ─────────────────────────────── */
.att-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: #111122;
    border: 1px solid #1e2a45;
    border-radius: 6px;
    padding: 8px;
    margin-bottom: 6px;
    position: relative;
}
.att-item.image { align-items: center; }

.att-thumb {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    background: #0a0a18;
}
.att-icon  { font-size: 22px; flex-shrink: 0; width: 32px; text-align: center; }
.att-info  { flex: 1; min-width: 0; }
.att-name  { font-size: 12px; font-weight: 600; color: #a0aec0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.att-size  { font-size: 11px; color: #4a5568; margin-top: 2px; }
.att-preview { font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.4; white-space: pre-wrap; word-break: break-all; }

.att-warn { font-size: 11px; color: #f59e0b; margin-top: 4px; }

.att-remove { position: absolute; top: 6px; right: 6px; background: none; border: none; cursor: pointer; color: #4a5568; font-size: 13px; padding: 0; line-height: 1; }
.att-remove:hover { color: #f87171; }

/* ── Totals bar ───────────────────────── */
.att-totals { font-size: 11px; color: #4a5568; padding: 6px 12px; border-top: 1px solid #1e2a45; flex-shrink: 0; }
`;

export class SgLlmAttachments extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        /** @type {Map<string, object>} id → attachment object */
        this._cache = new Map();
        this._currentModel = null;
        this._boundHandlers = {};
        this._pasteHandler = null;
    }

    connectedCallback() {
        this._render();
        this._bindDomEvents();
        this._bindLlmEvents();
        // Clipboard paste is document-level (works anywhere on the page)
        this._pasteHandler = this._onPaste.bind(this);
        document.addEventListener('paste', this._pasteHandler);
    }

    disconnectedCallback() {
        if (this._pasteHandler) document.removeEventListener('paste', this._pasteHandler);
        const bus = this._bus();
        for (const [event, handler] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(event, handler);
        }
    }

    // ── Render ────────────────────────────────────────────────────────────

    _render() {
        this.shadowRoot.innerHTML = `
            <style>${STYLES}</style>
            <div class="att-root">
                <div class="att-header">
                    <span class="att-title">📎 Attachments</span>
                    <span class="att-summary" id="summary"></span>
                    <button class="clear-btn hidden" id="clear-btn">Clear All</button>
                </div>
                <div class="drop-zone" id="drop-zone" tabindex="0" role="button" aria-label="Drop files here or click to browse">
                    <div class="drop-zone-hint">Drop files here, or paste (Ctrl+V)</div>
                    <span class="browse-btn" id="browse-btn">Browse files…</span>
                    <input type="file" id="file-input" multiple hidden>
                </div>
                <div class="att-list" id="att-list">
                    <div class="att-empty" id="empty-msg">No attachments yet.</div>
                </div>
                <div class="att-totals" id="totals" style="display:none"></div>
            </div>`;
    }

    _renderItem(att) {
        const isImage = att.type === 'image' || att.type === 'clipboard-image';
        const isText  = att.type === 'text'  || att.type === 'clipboard-text';
        const isPdf   = att.type === 'pdf';

        let thumbHtml = '';
        if (isImage && att.dataUrl) {
            thumbHtml = `<img class="att-thumb" src="${att.dataUrl}" alt="${_esc(att.name)}">`;
        } else {
            const icon = isPdf ? '📄' : isText ? '📝' : '📎';
            thumbHtml = `<div class="att-icon">${icon}</div>`;
        }

        const preview = isText && att.textContent
            ? `<div class="att-preview">${_esc(att.textContent.split('\n').slice(0, 3).join('\n'))}</div>`
            : '';

        const warn = isImage && this._currentModel && NO_VISION_MODELS.has(this._currentModel)
            ? `<div class="att-warn">⚠ ${_esc(this._currentModel)} may not support images</div>`
            : '';

        const el = document.createElement('div');
        el.className = `att-item${isImage ? ' image' : ''}`;
        el.dataset.id = att.id;
        el.innerHTML = `
            ${thumbHtml}
            <div class="att-info">
                <div class="att-name">${_esc(att.name)}</div>
                <div class="att-size">${_formatSize(att.size)}${isText ? ` · ~${Math.ceil((att.textContent?.length || 0) / 4)} tok` : ''}</div>
                ${preview}${warn}
            </div>
            <button class="att-remove" data-id="${att.id}" title="Remove">✕</button>`;
        return el;
    }

    _refreshList() {
        const list     = this.shadowRoot.getElementById('att-list');
        const emptyMsg = this.shadowRoot.getElementById('empty-msg');
        const clearBtn = this.shadowRoot.getElementById('clear-btn');
        const totals   = this.shadowRoot.getElementById('totals');
        const summary  = this.shadowRoot.getElementById('summary');

        // Remove existing items (keep empty-msg)
        list.querySelectorAll('.att-item').forEach(el => el.remove());

        if (this._cache.size === 0) {
            emptyMsg.style.display = '';
            clearBtn.classList.add('hidden');
            totals.style.display = 'none';
            summary.textContent = '';
            return;
        }

        emptyMsg.style.display = 'none';
        clearBtn.classList.remove('hidden');

        let textTok = 0;
        let imageCount = 0;

        for (const att of this._cache.values()) {
            list.appendChild(this._renderItem(att));
            if (att.type === 'text' || att.type === 'clipboard-text') {
                textTok += Math.ceil((att.textContent?.length || 0) / 4);
            } else if (att.type === 'image' || att.type === 'clipboard-image') {
                imageCount++;
            }
        }

        summary.textContent = `${this._cache.size} item${this._cache.size === 1 ? '' : 's'}`;

        const parts = [];
        if (textTok > 0)    parts.push(`~${textTok} tokens (text)`);
        if (imageCount > 0) parts.push(`${imageCount} image${imageCount === 1 ? '' : 's'}`);
        totals.textContent = parts.join(' + ');
        totals.style.display = parts.length ? '' : 'none';
    }

    // ── DOM event binding ─────────────────────────────────────────────────

    _bindDomEvents() {
        const root     = this.shadowRoot;
        const dropZone = root.getElementById('drop-zone');
        const fileInput= root.getElementById('file-input');
        const browseBtn= root.getElementById('browse-btn');
        const clearBtn = root.getElementById('clear-btn');
        const list     = root.getElementById('att-list');

        // Drag & drop
        dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', ()  => { dropZone.classList.remove('drag-over'); });
        dropZone.addEventListener('drop',      (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            this._processFiles([...e.dataTransfer.files]);
        });

        // Browse
        browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
        dropZone.addEventListener('click',  (e) => {
            if (e.target === dropZone) fileInput.click();
        });
        fileInput.addEventListener('change', () => {
            this._processFiles([...fileInput.files]);
            fileInput.value = '';
        });

        // Clear all
        clearBtn.addEventListener('click', () => this._clearAll());

        // Remove individual item
        list.addEventListener('click', (e) => {
            const btn = e.target.closest('.att-remove');
            if (btn) this._removeItem(btn.dataset.id);
        });
    }

    // ── LLM event binding ─────────────────────────────────────────────────

    _bindLlmEvents() {
        const bus = this._bus();

        const on = (event, handler) => {
            const bound = handler.bind(this);
            this._boundHandlers[event] = bound;
            bus.addEventListener(event, bound);
        };

        on(SGL_LLM.MODEL_CHANGED, this._onModelChanged);
        on(SGL_LLM.CONNECTED,     this._onConnected);
        on(SGL_LLM.BUNDLE_LOADED, this._onBundleLoaded);
    }

    _onModelChanged(e) {
        this._currentModel = e.detail?.model ?? null;
        this._refreshList(); // re-render to update any image warnings
    }

    _onConnected(e) {
        this._currentModel = e.detail?.model ?? null;
    }

    _onBundleLoaded(e) {
        const bundle = e.detail?.bundle;
        if (!bundle?.attachments) return;
        this._cache.clear();
        for (const att of bundle.attachments) {
            this._cache.set(att.id, att);
        }
        this._refreshList();
        // Re-emit all attachments so sg-llm-reality can restore its state
        for (const att of this._cache.values()) {
            this._emitLlm(SGL_LLM.ATTACHMENT_ADDED, { attachment: att });
        }
    }

    // ── Clipboard paste ───────────────────────────────────────────────────

    _onPaste(e) {
        // Only handle paste if this component is in the same layout (bus)
        const items = [...(e.clipboardData?.items || [])];

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) this._processImageFile(file, 'clipboard-image', 'Screenshot');
            } else if (item.type === 'text/plain') {
                item.getAsString((text) => {
                    if (text?.trim()) this._addTextItem('clipboard-text', 'Pasted text', text);
                });
            }
        }
    }

    // ── File processing ───────────────────────────────────────────────────

    _processFiles(files) {
        for (const file of files) {
            const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
            if (IMAGE_TYPES.has(file.type)) {
                this._processImageFile(file, 'image', file.name);
            } else if (file.type === 'application/pdf') {
                this._processPdfFile(file);
            } else if (TEXT_EXTS.has(ext) || file.type.startsWith('text/')) {
                this._processTextFile(file);
            } else {
                // Unknown — treat as binary, store name/size only
                this._addGenericItem(file);
            }
        }
    }

    _processTextFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => this._addTextItem('text', file.name, e.target.result, file.size);
        reader.readAsText(file);
    }

    _processImageFile(file, type, name) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const att = {
                id:      _makeId(),
                type,
                name,
                size:    file.size || 0,
                dataUrl: e.target.result,
            };
            this._cache.set(att.id, att);
            this._refreshList();
            this._emitLlm(SGL_LLM.ATTACHMENT_ADDED, { attachment: att });
        };
        reader.readAsDataURL(file);
    }

    _processPdfFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const att = {
                id:     _makeId(),
                type:   'pdf',
                name:   file.name,
                size:   file.size,
                dataUrl: e.target.result,
            };
            this._cache.set(att.id, att);
            this._refreshList();
            this._emitLlm(SGL_LLM.ATTACHMENT_ADDED, { attachment: att });
        };
        reader.readAsDataURL(file);
    }

    _addTextItem(type, name, textContent, size) {
        const att = {
            id:          _makeId(),
            type,
            name,
            size:        size ?? new Blob([textContent]).size,
            textContent,
        };
        this._cache.set(att.id, att);
        this._refreshList();
        this._emitLlm(SGL_LLM.ATTACHMENT_ADDED, { attachment: att });
    }

    _addGenericItem(file) {
        const att = {
            id:   _makeId(),
            type: 'binary',
            name: file.name,
            size: file.size,
        };
        this._cache.set(att.id, att);
        this._refreshList();
        this._emitLlm(SGL_LLM.ATTACHMENT_ADDED, { attachment: att });
    }

    // ── Remove / clear ────────────────────────────────────────────────────

    _removeItem(id) {
        if (!this._cache.has(id)) return;
        this._cache.delete(id);
        this._refreshList();
        this._emitLlm(SGL_LLM.ATTACHMENT_REMOVED, { id });
    }

    _clearAll() {
        this._cache.clear();
        this._refreshList();
        this._emitLlm(SGL_LLM.ATTACHMENTS_CLEARED, {});
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    _bus() { return this.parentElement || document; }

    _emitLlm(eventName, detail) {
        this._bus().dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }

    /**
     * Returns a copy of all attachments in the cache (for bundle capture).
     * @returns {Array<object>}
     */
    getAttachments() {
        return [...this._cache.values()].map(a => ({ ...a }));
    }
}

customElements.define('sg-llm-attachments', SgLlmAttachments);
window.SgLlmAttachments = SgLlmAttachments;

// ── Utilities ─────────────────────────────────────────────────────────────────

function _makeId() {
    return `att-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024)       return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
