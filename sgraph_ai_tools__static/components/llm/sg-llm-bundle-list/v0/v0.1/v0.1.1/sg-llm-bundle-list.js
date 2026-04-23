/**
 * sg-llm-bundle-list — Visual bundle browser.
 *
 * Displays saved bundles in reverse-chronological order. Each entry shows
 * timestamp, model, prompt preview, and cost. Click to load (time travel).
 * Delete action. Active bundle is highlighted.
 *
 * Place inside the shared event bus container alongside sg-llm-bundle.
 * Reads from the bundle index via BUNDLE_LIST_CHANGED events (which tell it
 * to re-fetch from sg-llm-bundle) or by listening to BUNDLE_SAVED/DELETED.
 *
 * Consumes (on parentElement):
 *   llm:bundle-list-changed  — re-renders the full list
 *   llm:bundle-saved         — adds/updates entry
 *   llm:bundle-loaded        — highlights active bundle
 *   llm:bundle-deleted       — removes entry
 *
 * Emits (on parentElement):
 *   llm:bundle-load-requested   — { bundleId }   user clicks a bundle entry
 *   llm:bundle-save-requested   — {}             user clicks "Save" button
 *   llm:bundle-delete-requested — { bundleId }   user clicks delete on entry
 *
 * Attributes:
 *   show-save-button  — boolean, renders a "Save State" button at the top
 *   max-entries       — number, limits rendered entries (default: unlimited)
 *
 * @module sg-llm-bundle-list
 * @version 0.1.1
 *
 * Changelog:
 *   v0.1.1: _bus() updated to walk [data-llm-bus] ancestor for sg-layout panel compatibility (backwards compatible).
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const BUNDLE_DELETE_EVENT = 'llm:bundle-delete-requested';

const CSS = `
:host { display: block; }
.bl-container {
    font-family: monospace;
    background: #0d0d1a;
    color: #e2e8f0;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.bl-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 8px;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
}
.bl-title {
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.bl-save-btn {
    font-family: monospace;
    font-size: 11px;
    background: #1e3a5f;
    color: #7cb9f8;
    border: 1px solid #2d5a8f;
    border-radius: 4px;
    padding: 3px 10px;
    cursor: pointer;
    transition: background 0.15s;
}
.bl-save-btn:hover { background: #2d5a8f; }
.bl-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
}
.bl-empty {
    padding: 20px 12px;
    font-size: 12px;
    color: #3a4060;
    text-align: center;
}
.bl-entry {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    border-left: 2px solid transparent;
    transition: background 0.12s, border-color 0.12s;
    position: relative;
}
.bl-entry:hover { background: #12122a; }
.bl-entry.active {
    border-left-color: #7c9ef8;
    background: #0f1428;
}
.bl-entry-body { flex: 1; min-width: 0; }
.bl-entry-row1 {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 2px;
}
.bl-timestamp {
    font-size: 11px;
    color: #94a3b8;
    flex-shrink: 0;
}
.bl-model {
    font-size: 11px;
    color: #7c9ef8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
}
.bl-cost {
    font-size: 10px;
    color: #4ade80;
    background: #0d2a1a;
    border: 1px solid #166534;
    border-radius: 3px;
    padding: 0 4px;
    margin-left: auto;
    flex-shrink: 0;
}
.bl-preview {
    font-size: 11px;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.bl-parent-badge {
    font-size: 10px;
    color: #475569;
    margin-top: 2px;
}
.bl-del-btn {
    font-size: 11px;
    background: none;
    border: none;
    color: #475569;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s;
    flex-shrink: 0;
    align-self: center;
}
.bl-entry:hover .bl-del-btn { opacity: 1; }
.bl-del-btn:hover { color: #f87171; }
`;

export class SgLlmBundleList extends HTMLElement {

    constructor() {
        super();
        this._activeBundleId = null;
        this._entries        = [];   // index array, newest-first
        this._boundHandlers  = {};
        this._shadow         = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._render();
        this._bindLlmEvents();
        this._requestRefresh();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [event, handler] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(event, handler);
        }
    }

    get showSaveButton() { return this.hasAttribute('show-save-button'); }

    get maxEntries() {
        const v = parseInt(this.getAttribute('max-entries'), 10);
        return isNaN(v) ? Infinity : v;
    }

    // ── Event binding ──────────────────────────────────────────────────────

    _bindLlmEvents() {
        const bus = this._bus();
        const on  = (event, handler) => {
            const bound = handler.bind(this);
            this._boundHandlers[event] = bound;
            bus.addEventListener(event, bound);
        };

        on(SGL_LLM.BUNDLE_LIST_CHANGED, this._onListChanged);
        on(SGL_LLM.BUNDLE_SAVED,        this._onBundleSaved);
        on(SGL_LLM.BUNDLE_LOADED,       this._onBundleLoaded);
        on(SGL_LLM.BUNDLE_DELETED,      this._onBundleDeleted);
    }

    _onListChanged() {
        this._requestRefresh();
    }

    _onBundleSaved(e) {
        const bundle = e.detail?.bundle;
        if (!bundle) return;
        const entry = this._bundleToEntry(bundle);
        // Prepend to list (newest first), remove any dup
        this._entries = [entry, ...this._entries.filter(e => e.id !== entry.id)];
        this._activeBundleId = bundle.id;
        this._renderList();
    }

    _onBundleLoaded(e) {
        const bundle = e.detail?.bundle;
        if (!bundle) return;
        this._activeBundleId = bundle.id;
        this._highlightActive();
    }

    _onBundleDeleted(e) {
        const id = e.detail?.bundleId;
        if (!id) return;
        this._entries = this._entries.filter(e => e.id !== id);
        if (this._activeBundleId === id) this._activeBundleId = null;
        this._renderList();
    }

    // ── Refresh from sg-llm-bundle ─────────────────────────────────────────

    /**
     * Read the current index from an sg-llm-bundle sibling element.
     * Gracefully does nothing if no bundle manager is present.
     */
    _requestRefresh() {
        const bus    = this._bus();
        const mgr    = bus?.querySelector?.('sg-llm-bundle');
        if (!mgr?.getIndex) return;
        this._entries        = mgr.getIndex();
        this._activeBundleId = mgr.getActiveBundleId?.() ?? null;
        this._renderList();
    }

    // ── DOM ────────────────────────────────────────────────────────────────

    _render() {
        this._shadow.innerHTML = `
            <style>${CSS}</style>
            <div class="bl-container" part="container">
                <div class="bl-header" part="header">
                    <span class="bl-title">Bundles</span>
                    ${this.showSaveButton ? '<button class="bl-save-btn" part="save-btn">Save State</button>' : ''}
                </div>
                <div class="bl-list" part="list"></div>
            </div>`;

        if (this.showSaveButton) {
            this._shadow.querySelector('.bl-save-btn')
                .addEventListener('click', () => this._emitLlm(SGL_LLM.BUNDLE_SAVE_REQUESTED, {}));
        }
    }

    _renderList() {
        const listEl = this._shadow.querySelector('.bl-list');
        if (!listEl) return;

        const entries = this._entries.slice(0, this.maxEntries);
        if (entries.length === 0) {
            listEl.innerHTML = '<div class="bl-empty">No saved bundles</div>';
            return;
        }

        listEl.innerHTML = '';
        for (const entry of entries) {
            listEl.appendChild(this._makeEntryEl(entry));
        }
    }

    _makeEntryEl(entry) {
        const div = document.createElement('div');
        div.className = 'bl-entry' + (entry.id === this._activeBundleId ? ' active' : '');
        div.dataset.id = entry.id;

        const ts     = this._formatTimestamp(entry.timestamp);
        const model  = this._shortModel(entry.model ?? '');
        const cost   = typeof entry.cost === 'number' ? `$${entry.cost.toFixed(4)}` : '';
        const preview = entry.promptPreview ?? '(no question)';
        const parentBadge = entry.parent_id
            ? `<div class="bl-parent-badge">↳ ${entry.parent_id.slice(-8)}</div>`
            : '';

        div.innerHTML = `
            <div class="bl-entry-body">
                <div class="bl-entry-row1">
                    <span class="bl-timestamp">${ts}</span>
                    <span class="bl-model">${this._esc(model)}</span>
                    ${cost ? `<span class="bl-cost">${cost}</span>` : ''}
                </div>
                <div class="bl-preview">${this._esc(preview)}</div>
                ${parentBadge}
            </div>
            <button class="bl-del-btn" title="Delete bundle" aria-label="Delete">✕</button>`;

        div.querySelector('.bl-entry-body').addEventListener('click', () => {
            this._emitLlm(SGL_LLM.BUNDLE_LOAD_REQUESTED, { bundleId: entry.id });
        });

        div.querySelector('.bl-del-btn').addEventListener('click', (ev) => {
            ev.stopPropagation();
            this._emitLlm(BUNDLE_DELETE_EVENT, { bundleId: entry.id });
        });

        return div;
    }

    _highlightActive() {
        const listEl = this._shadow.querySelector('.bl-list');
        if (!listEl) return;
        for (const el of listEl.querySelectorAll('.bl-entry')) {
            el.classList.toggle('active', el.dataset.id === this._activeBundleId);
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    _bundleToEntry(bundle) {
        const blocks  = bundle.reality?.blocks ?? [];
        const qBlock  = [...blocks].reverse().find(b => b.type === 'question');
        const preview = (qBlock?.content ?? '').slice(0, 60) || '(no question)';
        return {
            id:            bundle.id,
            parent_id:     bundle.parent_id,
            timestamp:     bundle.timestamp,
            model:         bundle.config?.model ?? '',
            cost:          bundle.response?.cost ?? null,
            promptPreview: preview,
        };
    }

    _formatTimestamp(iso) {
        if (!iso) return '—';
        try {
            const d = new Date(iso);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
        } catch { return iso.slice(11, 19) || iso; }
    }

    _shortModel(model) {
        // Trim provider prefix if present (e.g. "openai/gpt-4o" → "gpt-4o")
        const slash = model.lastIndexOf('/');
        return slash >= 0 ? model.slice(slash + 1) : model;
    }

    _esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

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

customElements.define('sg-llm-bundle-list', SgLlmBundleList);
window.SgLlmBundleList = SgLlmBundleList;
