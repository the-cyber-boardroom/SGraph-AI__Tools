/**
 * sg-llm-bundle — Headless execution bundle orchestrator.
 *
 * "Git for prompts." Captures the complete state of an LLM session (reality
 * blocks, connection config, response, metrics) into a bundle and saves it to
 * localStorage. Tracks parent_id to build a fork tree. Supports auto-save after
 * every completed request.
 *
 * Headless — no Shadow DOM, no UI. Place inside the shared event bus container.
 *
 * Storage:
 *   localStorage key 'sg-llm-bundles'       → Map of id → bundle (JSON)
 *   localStorage key 'sg-llm-bundles-index' → Array of index entries (JSON)
 *
 * Bundle data shape:
 *   {
 *     id:        'bundle-20260331-143022-a1b2',
 *     timestamp: '2026-03-31T14:30:22.000Z',
 *     parent_id: 'bundle-...' | null,
 *     config:    { provider, model, streaming },
 *     reality:   { blocks: [...] },
 *     response:  { text, tokens: { prompt, completion, total }, cost, duration_ms, finish_reason },
 *   }
 *
 * Consumes (on parentElement):
 *   llm:reality-changed      — captures current blocks
 *   llm:connected            — captures provider/model/streaming config
 *   llm:model-changed        — updates current model
 *   llm:streaming-changed    — updates streaming flag
 *   llm:request-complete     — captures response; auto-saves if enabled
 *   llm:bundle-save-requested  — triggers manual save
 *   llm:bundle-load-requested  — loads a bundle by id
 *   llm:bundle-delete-requested (custom) — deletes a bundle by id
 *
 * Emits (on parentElement):
 *   llm:bundle-saved         — { bundle }
 *   llm:bundle-loaded        — { bundle }
 *   llm:bundle-deleted       — { bundleId }
 *   llm:bundle-list-changed  — {}
 *
 * Attributes:
 *   auto-save  — boolean, enables auto-save after REQUEST_COMPLETE (default: false)
 *
 * @module sg-llm-bundle
 * @version 0.1.6
 *
 * Changelog:
 *   v0.1.6: _captureChat() now reads the registered sg-llm-chat-history instance
 *     from bus.__sgLlmChatHistory instead of using querySelector(). querySelector
 *     cannot pierce sg-layout's shadow DOM, so chat state was never captured when
 *     using the chat tool — bundle.chat was always { turns: [], systemPrompt: '' }.
 *     Removed debug console.group logging added in v0.1.5.
 *   v0.1.5: Temporary debug logging in loadBundle() to diagnose chat restore.
 *   v0.1.4: Self-healing stale index entries. deleteBundle() previously had an
 *     early return when the bundle was absent from the store, so the index entry
 *     was never cleaned up and the delete button appeared broken. loadBundle()
 *     also returned null silently for missing bundles. Both methods now always
 *     remove the entry from the index and emit the appropriate events, making
 *     the UI self-healing when index and store get out of sync (e.g. after a
 *     localStorage quota error or a cross-session inconsistency).
 *   v0.1.3: Fixed auto-save missing the assistant response. Both sg-llm-bundle
 *     and sg-llm-chat-history listen to REQUEST_COMPLETE; bundle was firing first
 *     and capturing chat state before chat-history had pushed the assistant turn.
 *     Auto-save is now deferred with setTimeout(0) so all REQUEST_COMPLETE
 *     handlers run before the snapshot is taken.
 *   v0.1.2: saveBundle() now also captures sg-llm-chat-history state
 *     (turns array + systemPrompt) and stores it as bundle.chat.
 *     Bundle shape gains: chat: { turns: [], systemPrompt: '' }
 *     Backwards compatible — chat field absent in bundles saved by v0.1.0/v0.1.1.
 *   v0.1.1: _bus() updated to walk [data-llm-bus] ancestor for sg-layout panel compatibility (backwards compatible).
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const STORAGE_KEY       = 'sg-llm-bundles';
const INDEX_KEY         = 'sg-llm-bundles-index';
const BUNDLE_ID_DELETE  = 'llm:bundle-delete-requested';

export class SgLlmBundle extends HTMLElement {

    constructor() {
        super();
        // Captured state — updated by incoming events
        this._currentReality = { blocks: [] };
        this._currentConfig  = { provider: null, model: null, streaming: true };
        this._lastResponse   = { text: '', tokens: { prompt: 0, completion: 0, total: 0 }, cost: 0, duration_ms: 0, finish_reason: '' };
        this._activeBundleId = null;
        this._boundHandlers  = {};
    }

    connectedCallback() {
        this._bindLlmEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [event, handler] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(event, handler);
        }
    }

    get autoSave() {
        return this.hasAttribute('auto-save');
    }

    // ── Event binding ──────────────────────────────────────────────────────

    _bindLlmEvents() {
        const bus = this._bus();
        const on = (event, handler) => {
            const bound = handler.bind(this);
            this._boundHandlers[event] = bound;
            bus.addEventListener(event, bound);
        };

        on(SGL_LLM.REALITY_CHANGED,    this._onRealityChanged);
        on(SGL_LLM.CONNECTED,          this._onConnected);
        on(SGL_LLM.MODEL_CHANGED,      this._onModelChanged);
        on(SGL_LLM.STREAMING_CHANGED,  this._onStreamingChanged);
        on(SGL_LLM.REQUEST_COMPLETE,   this._onRequestComplete);
        on(SGL_LLM.BUNDLE_SAVE_REQUESTED,  this._onSaveRequested);
        on(SGL_LLM.BUNDLE_LOAD_REQUESTED,  this._onLoadRequested);
        on(BUNDLE_ID_DELETE,               this._onDeleteRequested);
    }

    _onRealityChanged(e) {
        // Store a snapshot of the blocks array from the REALITY_CHANGED event
        // (sg-llm-reality includes the assembled messages; we want the raw blocks
        //  for bundle restore — sg-llm-reality.getState() is called at save time
        //  instead so we always get the latest block data)
        if (e.detail?.messages !== undefined) {
            // Store partial info; full blocks captured at save time via getState()
            this._currentReality._tokenCount = e.detail.tokenCount;
        }
    }

    _onConnected(e) {
        this._currentConfig.provider  = e.detail?.provider  ?? null;
        this._currentConfig.model     = e.detail?.model      ?? null;
    }

    _onModelChanged(e) {
        this._currentConfig.model = e.detail?.model ?? null;
    }

    _onStreamingChanged(e) {
        this._currentConfig.streaming = e.detail?.streaming ?? true;
    }

    _onRequestComplete(e) {
        const d = e.detail || {};
        this._lastResponse = {
            text:        d.content          ?? '',
            tokens:  {
                prompt:      d.promptTokens     ?? 0,
                completion:  d.completionTokens ?? 0,
                total:       (d.promptTokens ?? 0) + (d.completionTokens ?? 0),
            },
            cost:        d.cost       ?? 0,
            duration_ms: d.latencyMs  ?? 0,
            finish_reason: d.finishReason ?? 'stop',
        };
        // Defer auto-save so that sg-llm-chat-history (which also listens to
        // REQUEST_COMPLETE) can push the assistant turn before we snapshot state.
        if (this.autoSave) setTimeout(() => this.saveBundle(), 0);
    }

    _onSaveRequested() {
        this.saveBundle();
    }

    _onLoadRequested(e) {
        const id = e.detail?.bundleId;
        if (id) this.loadBundle(id);
    }

    _onDeleteRequested(e) {
        const id = e.detail?.bundleId;
        if (id) this.deleteBundle(id);
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Capture the current state and save a new bundle to localStorage.
     * Returns the bundle object.
     * @returns {object}
     */
    saveBundle() {
        const reality = this._captureReality();
        const chat    = this._captureChat();
        const bundle = {
            id:        _makeId(),
            timestamp: new Date().toISOString(),
            parent_id: this._activeBundleId,
            config:    { ...this._currentConfig },
            reality,
            chat,
            response:  { ...this._lastResponse, tokens: { ...this._lastResponse.tokens } },
        };

        // Write full bundle
        const store = _loadStore();
        store[bundle.id] = bundle;
        _saveStore(store);

        // Update index
        this._updateIndex(bundle);

        this._activeBundleId = bundle.id;
        this._emitLlm(SGL_LLM.BUNDLE_SAVED,        { bundle });
        this._emitLlm(SGL_LLM.BUNDLE_LIST_CHANGED, {});
        return bundle;
    }

    /**
     * Load a bundle from localStorage and emit BUNDLE_LOADED.
     * @param {string} id
     * @returns {object|null}
     */
    loadBundle(id) {
        const store  = _loadStore();
        const bundle = store[id];
        if (!bundle) {
            _removeFromIndex(id);
            this._emitLlm(SGL_LLM.BUNDLE_DELETED, { bundleId: id });
            return null;
        }
        this._activeBundleId = id;
        this._emitLlm(SGL_LLM.BUNDLE_LOADED, { bundle });
        return bundle;
    }

    /**
     * Delete a bundle from localStorage.
     * @param {string} id
     */
    deleteBundle(id) {
        const store = _loadStore();
        // Always clean up index and notify — even if the full bundle data is
        // absent from the store (stale entry). The early-return guard was the
        // reason the delete button appeared to do nothing for broken bundles.
        if (store[id]) {
            delete store[id];
            _saveStore(store);
        }
        _removeFromIndex(id);
        if (this._activeBundleId === id) this._activeBundleId = null;
        this._emitLlm(SGL_LLM.BUNDLE_DELETED,      { bundleId: id });
        this._emitLlm(SGL_LLM.BUNDLE_LIST_CHANGED, {});
    }

    /**
     * Returns the lightweight bundle index (for bundle-list rendering).
     * Each entry: { id, parent_id, timestamp, model, promptPreview }
     * @returns {Array<object>}
     */
    getIndex() {
        return _loadIndex();
    }

    /**
     * Returns the full bundle object for a given id, or null.
     * @param {string} id
     * @returns {object|null}
     */
    getBundle(id) {
        return _loadStore()[id] ?? null;
    }

    /** @returns {string|null} The currently active bundle id. */
    getActiveBundleId() {
        return this._activeBundleId;
    }

    // ── State capture ──────────────────────────────────────────────────────

    /**
     * Capture the current reality state.
     * Tries to read from the sg-llm-reality element in the same bus container;
     * falls back to the last REALITY_CHANGED detail if not found.
     * @returns {{ blocks: Array }}
     */
    _captureReality() {
        const bus      = this._bus();
        const reality  = bus?.querySelector?.('sg-llm-reality');
        if (reality?.getState) return reality.getState();
        return { blocks: [] };
    }

    /**
     * Capture current chat history state from sg-llm-chat-history.
     * Uses the __sgLlmChatHistory registration on the bus element instead of
     * querySelector, because querySelector cannot pierce sg-layout's shadow DOM.
     * @returns {{ turns: Array, systemPrompt: string }}
     */
    _captureChat() {
        const bus     = this._bus();
        const history = bus?.__sgLlmChatHistory;
        if (history?.getState) return history.getState();
        return { turns: [], systemPrompt: '' };
    }

    // ── Index management ───────────────────────────────────────────────────

    _updateIndex(bundle) {
        const index = _loadIndex();

        // Build a prompt preview from the last user message in the reality blocks
        let promptPreview = '';
        const blocks = bundle.reality?.blocks ?? [];
        const qBlock = [...blocks].reverse().find(b => b.type === 'question');
        promptPreview = (qBlock?.content ?? '').slice(0, 60) || '(no question)';

        const entry = {
            id:            bundle.id,
            parent_id:     bundle.parent_id,
            timestamp:     bundle.timestamp,
            model:         bundle.config?.model ?? '',
            promptPreview,
        };

        // Remove existing entry for this id (shouldn't happen, but be safe)
        const filtered = index.filter(e => e.id !== bundle.id);
        filtered.unshift(entry); // newest first
        _saveIndex(filtered);
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }

    _emitLlm(eventName, detail) {
        this._bus().dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }
}

customElements.define('sg-llm-bundle', SgLlmBundle);
window.SgLlmBundle = SgLlmBundle;

// ── localStorage helpers ──────────────────────────────────────────────────────

function _loadStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
}

function _saveStore(store) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* quota */ }
}

function _loadIndex() {
    try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); }
    catch { return []; }
}

function _saveIndex(index) {
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)); } catch { /* quota */ }
}

function _removeFromIndex(id) {
    const index = _loadIndex().filter(e => e.id !== id);
    _saveIndex(index);
}

function _makeId() {
    const now = new Date();
    const ts  = now.toISOString().replace(/[-:T]/g, '').slice(0, 15); // 20260331T143022
    const rnd = Math.random().toString(16).slice(2, 6);
    return `bundle-${ts}-${rnd}`;
}
