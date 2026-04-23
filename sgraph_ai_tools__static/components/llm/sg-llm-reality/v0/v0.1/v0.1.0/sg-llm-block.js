/**
 * sg-llm-block — Web Component for a single reality block.
 *
 * Renders the editor for ONE block (system / context / history / memory / question).
 * Has no knowledge of the block list. Communicates with the parent (sg-llm-reality)
 * via plain bubbling DOM events — NOT SGL_LLM events.
 *
 * Public API:
 *   blockEl.setData(block)   — set block data, re-render
 *   blockEl.getData()        — read current data (incl. edits from the DOM)
 *
 * Emits (bubbling CustomEvents on itself):
 *   'block-change'  — user edited any field.         detail: { blockId }
 *   'block-remove'  — user clicked ✕ remove.         detail: { blockId }
 *   'block-toggle'  — user toggled enabled/disabled. detail: { blockId, enabled }
 *
 * @module sg-llm-block
 * @version 0.1.0
 */

import {
    BLOCK_TYPES,
    estimateTokens,
    blockTokens,
} from '/components/llm/sg-llm-reality/v0/v0.1/v0.1.0/sg-llm-reality-core.js';

// ── Styles ────────────────────────────────────────────────────────────────────

const STYLES = `
:host { display: block; }

.block-root {
    background: #111122;
    border: 1px solid #222d4d;
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
    transition: opacity 0.2s;
}
.block-root.disabled {
    opacity: 0.45;
}

/* ── Header ─────────────────────────────── */
.block-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    background: #0d0d1a;
    border-bottom: 1px solid #222d4d;
    cursor: default;
    user-select: none;
}
.block-header.collapsible { cursor: pointer; }

.block-icon  { font-size: 13px; flex-shrink: 0; }
.block-label { font-size: 12px; font-weight: 600; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.05em; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.block-sublabel { font-size: 12px; color: #64748b; margin-left: 4px; font-weight: normal; text-transform: none; letter-spacing: 0; }
.block-tokens  { font-size: 11px; color: #4a5568; flex-shrink: 0; }
.block-toggle  { background: none; border: none; cursor: pointer; font-size: 14px; padding: 0 2px; color: #4ade80; flex-shrink: 0; }
.block-toggle.off { color: #4a5568; }
.block-remove  { background: none; border: none; cursor: pointer; font-size: 14px; padding: 0 2px; color: #4a5568; flex-shrink: 0; }
.block-remove:hover { color: #f87171; }
.block-collapse-icon { font-size: 11px; color: #4a5568; flex-shrink: 0; transition: transform 0.15s; }
.block-collapse-icon.open { transform: rotate(90deg); }

/* ── Body ───────────────────────────────── */
.block-body { padding: 10px; }
.block-body.hidden { display: none; }

textarea, input[type=text] {
    width: 100%;
    box-sizing: border-box;
    background: #0a0a18;
    border: 1px solid #1e2a45;
    border-radius: 4px;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    padding: 8px;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s;
}
textarea { min-height: 80px; }
textarea:focus, input[type=text]:focus { border-color: #3b5bdb; }

.field-label { font-size: 11px; color: #64748b; margin-bottom: 4px; }

/* context label input */
.context-label-row { margin-bottom: 8px; }
.context-label-row input { min-height: unset; resize: none; }

/* history pairs */
.history-pairs { display: flex; flex-direction: column; gap: 8px; }
.history-pair { border: 1px solid #1e2a45; border-radius: 6px; padding: 8px; position: relative; }
.pair-remove { position: absolute; top: 6px; right: 6px; background: none; border: none; cursor: pointer; color: #4a5568; font-size: 12px; padding: 0; }
.pair-remove:hover { color: #f87171; }
.pair-user-row    { margin-bottom: 6px; }
.pair-label { font-size: 11px; color: #64748b; margin-bottom: 4px; }
.history-add-btn {
    margin-top: 8px;
    background: #0d1a2e;
    border: 1px dashed #2d3f5e;
    border-radius: 4px;
    color: #64748b;
    font-size: 12px;
    padding: 6px;
    width: 100%;
    cursor: pointer;
    text-align: center;
}
.history-add-btn:hover { color: #a0aec0; border-color: #3b5bdb; }

/* image badge for question */
.image-badge {
    display: inline-block;
    background: #1a2a3e;
    border: 1px solid #2d4a6e;
    border-radius: 4px;
    color: #7c9ef8;
    font-size: 11px;
    padding: 3px 8px;
    margin-top: 6px;
}
.image-badge.hidden { display: none; }
`;

// ── Component ─────────────────────────────────────────────────────────────────

export class SgLlmBlock extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._block = null;
        this._collapsed = false;
    }

    connectedCallback() {
        if (this._block) this._render();
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Set the block data and render the block.
     * @param {object} block - Block data object from createBlock().
     */
    setData(block) {
        this._block = { ...block };
        // Context and history collapse by default
        this._collapsed = BLOCK_TYPES[block.type]?.collapsible ?? false;
        if (this.shadowRoot) this._render();
    }

    /**
     * Read the current block data, incorporating any DOM edits.
     * @returns {object}
     */
    getData() {
        if (!this._block) return null;
        return this._readFromDom();
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    _render() {
        const b = this._block;
        const meta = BLOCK_TYPES[b.type] || {};
        const collapsible = meta.collapsible ?? false;
        const tokens = blockTokens(b);

        this.shadowRoot.innerHTML = `
            <style>${STYLES}</style>
            <div class="block-root${b.enabled ? '' : ' disabled'}" data-id="${b.id}">
                ${this._renderHeader(b, meta, collapsible, tokens)}
                <div class="block-body${collapsible && this._collapsed ? ' hidden' : ''}" id="body">
                    ${this._renderBody(b)}
                </div>
            </div>`;

        this._attachEvents();
    }

    _renderHeader(b, meta, collapsible, tokens) {
        const subLabel = b.type === 'context' && b.label ? `<span class="block-sublabel">${_esc(b.label)}</span>` : '';
        const collapseIcon = collapsible
            ? `<span class="block-collapse-icon${this._collapsed ? '' : ' open'}">▶</span>`
            : '';
        return `
            <div class="block-header${collapsible ? ' collapsible' : ''}" id="header">
                ${collapseIcon}
                <span class="block-icon">${meta.icon || ''}</span>
                <span class="block-label">${meta.label || b.type}${subLabel}</span>
                <span class="block-tokens" id="tok-display">${tokens} tok</span>
                <button class="block-toggle${b.enabled ? '' : ' off'}" id="toggle-btn" title="${b.enabled ? 'Disable block' : 'Enable block'}">●</button>
                <button class="block-remove" id="remove-btn" title="Remove block">✕</button>
            </div>`;
    }

    _renderBody(b) {
        switch (b.type) {
            case 'system':
                return `<textarea id="content" placeholder="Define the agent's role and constraints…">${_esc(b.content)}</textarea>`;
            case 'context':
                return `
                    <div class="context-label-row">
                        <div class="field-label">Label</div>
                        <input type="text" id="ctx-label" placeholder="Document name, e.g. architecture.md" value="${_esc(b.label)}">
                    </div>
                    <div class="field-label">Content</div>
                    <textarea id="content" placeholder="Paste or type context here…">${_esc(b.content)}</textarea>`;
            case 'history':
                return `
                    <div class="history-pairs" id="pairs-container">
                        ${(b.pairs || []).map((p, i) => this._renderPair(p, i)).join('')}
                    </div>
                    <button class="history-add-btn" id="add-pair-btn">+ Add pair</button>`;
            case 'memory':
                return `<textarea id="content" placeholder="Session memory — decisions, patterns, preferences…">${_esc(b.content)}</textarea>`;
            case 'question':
                return `
                    <textarea id="content" placeholder="What do you want the model to do?">${_esc(b.content)}</textarea>
                    <div class="image-badge${(b._imageCount || 0) > 0 ? '' : ' hidden'}" id="img-badge">📷 ${b._imageCount || 0} image${(b._imageCount || 0) === 1 ? '' : 's'} attached</div>`;
            default:
                return `<textarea id="content">${_esc(b.content || '')}</textarea>`;
        }
    }

    _renderPair(pair, index) {
        return `
            <div class="history-pair" data-pair-index="${index}">
                <button class="pair-remove" data-pair-index="${index}" title="Remove pair">✕</button>
                <div class="pair-user-row">
                    <div class="pair-label">👤 User</div>
                    <textarea class="pair-user" data-pair-index="${index}" placeholder="User message…">${_esc(pair.user)}</textarea>
                </div>
                <div>
                    <div class="pair-label">🤖 Assistant</div>
                    <textarea class="pair-asst" data-pair-index="${index}" placeholder="Assistant response…">${_esc(pair.assistant)}</textarea>
                </div>
            </div>`;
    }

    // ── Event wiring ────────────────────────────────────────────────────────

    _attachEvents() {
        const root   = this.shadowRoot;
        const header = root.getElementById('header');
        const body   = root.getElementById('body');

        // Collapse toggle (collapsible blocks only)
        if (header?.classList.contains('collapsible')) {
            header.addEventListener('click', (e) => {
                // Don't collapse when clicking buttons inside the header
                if (e.target.closest('button')) return;
                this._collapsed = !this._collapsed;
                body?.classList.toggle('hidden', this._collapsed);
                root.querySelector('.block-collapse-icon')?.classList.toggle('open', !this._collapsed);
            });
        }

        // Enable / disable toggle
        root.getElementById('toggle-btn')?.addEventListener('click', () => {
            this._block.enabled = !this._block.enabled;
            root.querySelector('.block-root')?.classList.toggle('disabled', !this._block.enabled);
            root.getElementById('toggle-btn')?.classList.toggle('off', !this._block.enabled);
            root.getElementById('toggle-btn').title = this._block.enabled ? 'Disable block' : 'Enable block';
            this._emit('block-toggle', { blockId: this._block.id, enabled: this._block.enabled });
        });

        // Remove block
        root.getElementById('remove-btn')?.addEventListener('click', () => {
            this._emit('block-remove', { blockId: this._block.id });
        });

        // Input changes — any textarea or text input
        root.querySelectorAll('textarea, input[type=text]').forEach(el => {
            el.addEventListener('input', () => {
                this._updateTokenDisplay();
                this._emit('block-change', { blockId: this._block.id });
            });
        });

        // History-specific: add pair
        root.getElementById('add-pair-btn')?.addEventListener('click', () => {
            if (!this._block.pairs) this._block.pairs = [];
            this._block.pairs.push({ user: '', assistant: '' });
            // Re-render body only
            const body = root.getElementById('body');
            if (body) body.innerHTML = this._renderBody(this._block);
            this._attachHistoryEvents();
            this._emit('block-change', { blockId: this._block.id });
        });

        this._attachHistoryEvents();
    }

    _attachHistoryEvents() {
        const root = this.shadowRoot;
        // Remove pair buttons
        root.querySelectorAll('.pair-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.pairIndex, 10);
                this._block.pairs.splice(idx, 1);
                const body = root.getElementById('body');
                if (body) body.innerHTML = this._renderBody(this._block);
                this._attachHistoryEvents();
                this._updateTokenDisplay();
                this._emit('block-change', { blockId: this._block.id });
            });
        });
    }

    // ── DOM read-back ───────────────────────────────────────────────────────

    _readFromDom() {
        const root = this.shadowRoot;
        const b = { ...this._block };

        switch (b.type) {
            case 'system':
            case 'memory':
            case 'question':
                b.content = root.getElementById('content')?.value ?? b.content;
                break;
            case 'context':
                b.label   = root.getElementById('ctx-label')?.value ?? b.label;
                b.content = root.getElementById('content')?.value   ?? b.content;
                break;
            case 'history':
                b.pairs = [];
                root.querySelectorAll('.history-pair').forEach(pairEl => {
                    const userEl = pairEl.querySelector('.pair-user');
                    const asstEl = pairEl.querySelector('.pair-asst');
                    b.pairs.push({
                        user:      userEl?.value  ?? '',
                        assistant: asstEl?.value  ?? '',
                    });
                });
                break;
        }
        return b;
    }

    // ── Token display update ────────────────────────────────────────────────

    _updateTokenDisplay() {
        const current = this._readFromDom();
        const tok = blockTokens(current);
        const el = this.shadowRoot.getElementById('tok-display');
        if (el) el.textContent = `${tok} tok`;
    }

    // ── Image count (called by sg-llm-reality) ──────────────────────────────

    /**
     * Update the image attachment count badge on a question block.
     * @param {number} count
     */
    setImageCount(count) {
        if (this._block?.type !== 'question') return;
        this._block._imageCount = count;
        const badge = this.shadowRoot.getElementById('img-badge');
        if (badge) {
            badge.textContent = `📷 ${count} image${count === 1 ? '' : 's'} attached`;
            badge.classList.toggle('hidden', count === 0);
        }
    }

    // ── Event helper ────────────────────────────────────────────────────────

    _emit(name, detail) {
        this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    }
}

customElements.define('sg-llm-block', SgLlmBlock);

// Expose for surgical overrides
window.SgLlmBlock = SgLlmBlock;

// ── Utilities ─────────────────────────────────────────────────────────────────

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
