/**
 * sg-llm-reality — The LLM reality constructor orchestrator.
 *
 * Manages a list of <sg-llm-block> elements, handles all SGL_LLM events,
 * assembles the messages array, and emits REALITY_CHANGED and SEND.
 *
 * Consumes (via parentElement event bus):
 *   llm:connected, llm:model-changed
 *   llm:request-start, llm:request-complete, llm:request-error, llm:request-cancel
 *   llm:attachment-added, llm:attachment-removed, llm:attachments-cleared
 *   llm:bundle-loaded
 *   llm:memory-updated
 *
 * Emits (via parentElement event bus):
 *   llm:reality-changed  — { messages[], tokenCount, estimatedCost, imageCount }
 *   llm:send             — { messages[], mode: 'build'|'memory-update' }
 *   llm:block-added      — { block }
 *   llm:block-removed    — { blockId }
 *   llm:block-reordered  — { blockIds[] }
 *
 * Note: drag-to-reorder and template presets are deferred to v0.1.1 surgical override.
 *
 * @module sg-llm-reality
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';
import { SgLlmBlock } from '/components/llm/sg-llm-reality/v0/v0.1/v0.1.0/sg-llm-block.js';
import {
    createBlock,
    assembleMessages,
    assembleMemoryUpdateMessages,
    totalTokens,
} from '/components/llm/sg-llm-reality/v0/v0.1/v0.1.0/sg-llm-reality-core.js';

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.reality-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0a0a18;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #e2e8f0;
}

/* ── Block list ──────────────────────────── */
.reality-blocks {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    scrollbar-width: thin;
    scrollbar-color: #222d4d transparent;
}
.reality-empty {
    text-align: center;
    color: #4a5568;
    padding: 32px 16px;
    font-size: 13px;
}

/* ── Add toolbar ────────────────────────── */
.reality-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 10px;
    border-top: 1px solid #1e2a45;
    background: #0d0d1a;
    flex-shrink: 0;
}
.add-btn {
    background: #0d1a2e;
    border: 1px solid #2d3f5e;
    border-radius: 4px;
    color: #7c9ef8;
    font-size: 11px;
    padding: 4px 8px;
    cursor: pointer;
    white-space: nowrap;
}
.add-btn:hover { background: #111a2e; border-color: #3b5bdb; }

/* ── Footer / send ───────────────────────── */
.reality-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-top: 1px solid #1e2a45;
    background: #0d0d1a;
    flex-shrink: 0;
}
.reality-token-count { font-size: 12px; color: #64748b; flex: 1; }
.send-btn {
    background: #1e3a8a;
    border: 1px solid #2d5bdb;
    border-radius: 5px;
    color: #e2e8f0;
    font-size: 13px;
    font-weight: 600;
    padding: 6px 14px;
    cursor: pointer;
}
.send-btn:hover:not(:disabled) { background: #1e40af; }
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.memory-btn {
    background: #0d2a1a;
    border: 1px solid #166534;
    border-radius: 5px;
    color: #4ade80;
    font-size: 12px;
    padding: 6px 10px;
    cursor: pointer;
}
.memory-btn:hover:not(:disabled) { background: #0d3a1a; }
.memory-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.memory-btn.hidden { display: none; }
`;

export class SgLlmReality extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // Block data array — source of truth
        this._blocks = [];

        // Image attachments tracked from ATTACHMENT_ADDED
        this._imageAttachments = [];

        // Attachment-sourced context block IDs (so we can remove them on ATTACHMENT_REMOVED)
        this._attachmentBlockMap = new Map(); // attachmentId → blockId

        // Connection state (for cost display, model name)
        this._currentModel = null;

        // Last request content (for Mode 2 memory update)
        this._lastQuestion = '';
        this._lastResponse = '';

        // Whether a request is in flight
        this._busy = false;

        // Pending send mode ('build' | 'memory-update' | null)
        this._pendingMode = null;

        // Bound listener refs for cleanup
        this._boundHandlers = {};
    }

    connectedCallback() {
        this._render();
        this._bindBlockEvents();
        this._bindLlmEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [event, handler] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(event, handler);
        }
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Return the current serialisable state (for bundle capture).
     * @returns {{ blocks: Array }}
     */
    getState() {
        return { blocks: this._blocks.map(b => ({ ...b })) };
    }

    /**
     * Restore state (from a bundle or external caller).
     * @param {{ blocks: Array }} state
     */
    setState(state) {
        if (!state?.blocks) return;
        this._blocks = state.blocks.map(b => ({ ...b }));
        this._rebuildDom();
        this._onChange();
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    _render() {
        this.shadowRoot.innerHTML = `
            <style>${STYLES}</style>
            <div class="reality-root">
                <div class="reality-blocks" id="blocks-container">
                    <div class="reality-empty" id="empty-msg">Add blocks below to build the model's reality.</div>
                </div>
                <div class="reality-toolbar" id="toolbar">
                    <button class="add-btn" data-type="system">  + System</button>
                    <button class="add-btn" data-type="context"> + Context</button>
                    <button class="add-btn" data-type="history"> + History</button>
                    <button class="add-btn" data-type="memory">  + Memory</button>
                    <button class="add-btn" data-type="question">+ Question</button>
                </div>
                <div class="reality-footer">
                    <span class="reality-token-count" id="tok-display">0 tokens</span>
                    <button class="memory-btn hidden" id="memory-btn">↻ Update Memory</button>
                    <button class="send-btn" id="send-btn">▶ Send</button>
                </div>
            </div>`;

        this.shadowRoot.getElementById('toolbar').addEventListener('click', (e) => {
            const btn = e.target.closest('.add-btn');
            if (btn) this._addBlock(btn.dataset.type);
        });

        this.shadowRoot.getElementById('send-btn').addEventListener('click', () => {
            this._onSend('build');
        });

        this.shadowRoot.getElementById('memory-btn').addEventListener('click', () => {
            this._onMemoryUpdate();
        });
    }

    _rebuildDom() {
        const container = this.shadowRoot.getElementById('blocks-container');
        if (!container) return;
        // Clear all existing sg-llm-block elements
        container.querySelectorAll('sg-llm-block').forEach(el => el.remove());
        // Re-insert from block data
        for (const block of this._blocks) {
            this._appendBlockEl(block);
        }
        this._updateEmptyState();
        this._updateMemoryBtn();
        this._updateImageBadges();
    }

    _appendBlockEl(block) {
        const container = this.shadowRoot.getElementById('blocks-container');
        if (!container) return;
        const el = document.createElement('sg-llm-block');
        container.appendChild(el);
        el.setData(block);
        return el;
    }

    _updateEmptyState() {
        const msg = this.shadowRoot.getElementById('empty-msg');
        if (msg) msg.style.display = this._blocks.length === 0 ? '' : 'none';
    }

    _updateMemoryBtn() {
        const hasMemory = this._blocks.some(b => b.type === 'memory');
        this.shadowRoot.getElementById('memory-btn')?.classList.toggle('hidden', !hasMemory);
    }

    _updateImageBadges() {
        // Find the question block element and update its badge
        const container = this.shadowRoot.getElementById('blocks-container');
        if (!container) return;
        const qIdx = this._blocks.findIndex(b => b.type === 'question');
        if (qIdx === -1) return;
        const blockEls = container.querySelectorAll('sg-llm-block');
        if (blockEls[qIdx]) blockEls[qIdx].setImageCount(this._imageAttachments.length);
    }

    _updateTokenDisplay() {
        const tok = totalTokens(this._blocks);
        const el = this.shadowRoot.getElementById('tok-display');
        if (el) el.textContent = `${tok} tokens`;
    }

    // ── Block management ─────────────────────────────────────────────────────

    _addBlock(type, overrides = {}) {
        const block = createBlock(type, overrides);
        this._blocks.push(block);
        this._appendBlockEl(block);
        this._updateEmptyState();
        this._updateMemoryBtn();
        this._onChange();
        this._emitLlm(SGL_LLM.BLOCK_ADDED, { block });
        return block;
    }

    _removeBlock(blockId) {
        const idx = this._blocks.findIndex(b => b.id === blockId);
        if (idx === -1) return;
        this._blocks.splice(idx, 1);
        // Remove DOM element
        const container = this.shadowRoot.getElementById('blocks-container');
        const blockEls  = container?.querySelectorAll('sg-llm-block');
        if (blockEls?.[idx]) blockEls[idx].remove();
        this._updateEmptyState();
        this._updateMemoryBtn();
        this._onChange();
        this._emitLlm(SGL_LLM.BLOCK_REMOVED, { blockId });
    }

    _updateBlockFromDom(blockId) {
        const idx = this._blocks.findIndex(b => b.id === blockId);
        if (idx === -1) return;
        const container = this.shadowRoot.getElementById('blocks-container');
        const blockEls  = container?.querySelectorAll('sg-llm-block');
        if (!blockEls?.[idx]) return;
        const updated = blockEls[idx].getData();
        if (updated) this._blocks[idx] = updated;
    }

    // ── Block DOM event listeners ────────────────────────────────────────────

    _bindBlockEvents() {
        const container = this.shadowRoot.getElementById('blocks-container');
        if (!container) return;

        container.addEventListener('block-change', (e) => {
            this._updateBlockFromDom(e.detail.blockId);
            this._onChange();
        });

        container.addEventListener('block-remove', (e) => {
            this._removeBlock(e.detail.blockId);
        });

        container.addEventListener('block-toggle', (e) => {
            this._updateBlockFromDom(e.detail.blockId);
            this._onChange();
        });
    }

    // ── SGL_LLM event listeners ──────────────────────────────────────────────

    _bindLlmEvents() {
        const bus = this._bus();

        const on = (event, handler) => {
            const bound = handler.bind(this);
            this._boundHandlers[event] = bound;
            bus.addEventListener(event, bound);
        };

        on(SGL_LLM.CONNECTED,           this._onConnected);
        on(SGL_LLM.MODEL_CHANGED,       this._onModelChanged);
        on(SGL_LLM.REQUEST_START,       this._onRequestStart);
        on(SGL_LLM.REQUEST_COMPLETE,    this._onRequestComplete);
        on(SGL_LLM.REQUEST_ERROR,       this._onRequestError);
        on(SGL_LLM.REQUEST_CANCEL,      this._onRequestCancel);
        on(SGL_LLM.ATTACHMENT_ADDED,    this._onAttachmentAdded);
        on(SGL_LLM.ATTACHMENT_REMOVED,  this._onAttachmentRemoved);
        on(SGL_LLM.ATTACHMENTS_CLEARED, this._onAttachmentsCleared);
        on(SGL_LLM.BUNDLE_LOADED,       this._onBundleLoaded);
        on(SGL_LLM.MEMORY_UPDATED,      this._onMemoryUpdated);
    }

    _onConnected(e) {
        this._currentModel = e.detail?.model ?? null;
    }

    _onModelChanged(e) {
        this._currentModel = e.detail?.model ?? null;
    }

    _onRequestStart() {
        this._busy = true;
        const btn = this.shadowRoot.getElementById('send-btn');
        const mBtn = this.shadowRoot.getElementById('memory-btn');
        if (btn)  btn.disabled  = true;
        if (mBtn) mBtn.disabled = true;
    }

    _onRequestComplete(e) {
        this._busy = false;
        this._lastResponse = e.detail?.content ?? '';

        const btn = this.shadowRoot.getElementById('send-btn');
        const mBtn = this.shadowRoot.getElementById('memory-btn');
        if (btn)  btn.disabled  = false;
        if (mBtn) mBtn.disabled = false;

        if (this._pendingMode === 'memory-update') {
            this._applyMemoryUpdate(this._lastResponse);
        }
        this._pendingMode = null;
    }

    _onRequestError() {
        this._busy = false;
        this._pendingMode = null;
        const btn  = this.shadowRoot.getElementById('send-btn');
        const mBtn = this.shadowRoot.getElementById('memory-btn');
        if (btn)  btn.disabled  = false;
        if (mBtn) mBtn.disabled = false;
    }

    _onRequestCancel() {
        this._onRequestError();
    }

    _onAttachmentAdded(e) {
        const att = e.detail?.attachment;
        if (!att) return;

        if (att.type === 'text' || att.type === 'clipboard-text') {
            // Auto-create a context block for the text attachment
            const block = this._addBlock('context', {
                label:   att.name || 'Attachment',
                content: att.textContent || '',
            });
            this._attachmentBlockMap.set(att.id, block.id);

        } else if (att.type === 'image' || att.type === 'clipboard-image') {
            this._imageAttachments.push({ id: att.id, dataUrl: att.dataUrl });
            this._updateImageBadges();
            this._onChange();
        }
    }

    _onAttachmentRemoved(e) {
        const attId = e.detail?.id;
        if (!attId) return;

        // Remove corresponding context block (if text attachment)
        const blockId = this._attachmentBlockMap.get(attId);
        if (blockId) {
            this._removeBlock(blockId);
            this._attachmentBlockMap.delete(attId);
        }

        // Remove from image cache (if image attachment)
        const imgIdx = this._imageAttachments.findIndex(i => i.id === attId);
        if (imgIdx !== -1) {
            this._imageAttachments.splice(imgIdx, 1);
            this._updateImageBadges();
            this._onChange();
        }
    }

    _onAttachmentsCleared() {
        // Remove all attachment-sourced context blocks
        for (const blockId of this._attachmentBlockMap.values()) {
            this._removeBlock(blockId);
        }
        this._attachmentBlockMap.clear();
        this._imageAttachments = [];
        this._updateImageBadges();
        this._onChange();
    }

    _onBundleLoaded(e) {
        const bundle = e.detail?.bundle;
        if (!bundle?.reality?.blocks) return;
        this.setState({ blocks: bundle.reality.blocks });
    }

    _onMemoryUpdated(e) {
        const content = e.detail?.content;
        if (!content) return;
        this._applyMemoryUpdate(content);
    }

    // ── Send modes ───────────────────────────────────────────────────────────

    _onSend(mode) {
        if (this._busy) return;

        const messages = assembleMessages(this._blocks, this._imageAttachments);
        // Capture the current question text for Mode 2 later
        const qBlock = this._blocks.find(b => b.type === 'question' && b.enabled);
        this._lastQuestion = qBlock?.content ?? '';

        this._pendingMode = mode;
        this._emitLlm(SGL_LLM.SEND, {
            messages,
            mode,
            model:    this._currentModel,
        });
    }

    _onMemoryUpdate() {
        if (this._busy) return;
        const memBlock = this._blocks.find(b => b.type === 'memory' && b.enabled);
        if (!memBlock) return;

        const messages = assembleMemoryUpdateMessages(
            memBlock,
            this._lastQuestion,
            this._lastResponse,
        );
        this._pendingMode = 'memory-update';
        this._emitLlm(SGL_LLM.SEND, {
            messages,
            mode:  'memory-update',
            model: this._currentModel,
        });
    }

    _applyMemoryUpdate(content) {
        const idx = this._blocks.findIndex(b => b.type === 'memory');
        if (idx === -1) return;
        this._blocks[idx].content = content;

        // Update the DOM element
        const container = this.shadowRoot.getElementById('blocks-container');
        const blockEls  = container?.querySelectorAll('sg-llm-block');
        if (blockEls?.[idx]) {
            blockEls[idx].setData({ ...this._blocks[idx] });
        }
        this._onChange();
    }

    // ── onChange ─────────────────────────────────────────────────────────────

    _onChange() {
        this._updateTokenDisplay();

        const messages = assembleMessages(this._blocks, this._imageAttachments);
        const tokenCount = totalTokens(this._blocks);

        this._emitLlm(SGL_LLM.REALITY_CHANGED, {
            messages,
            tokenCount,
            estimatedCost: 0,   // sg-llm-pricing not yet available
            imageCount: this._imageAttachments.length,
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** The event bus: the parent element (or document as fallback). */
    _bus() {
        return this.parentElement || document;
    }

    _emitLlm(eventName, detail) {
        const bus = this._bus();
        bus.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }
}

customElements.define('sg-llm-reality', SgLlmReality);

// Expose for surgical overrides
window.SgLlmReality = SgLlmReality;
