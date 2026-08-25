/**
 * sg-conversation-list.js
 * Conversation-row Web Component: name/number, snippet, unread dot, and a
 * configurable status chip (WhatsApp Desk uses it for the 24h window).
 * Platform-neutral — rows are plain data; selection is an intent event.
 *
 * Row shape: { id, name?, snippet?, unread?: number,
 *              chip?: { label, tone: 'ok'|'warn'|'muted' } }
 *
 * Methods:  setConversations(rows), setActive(id)
 * Events:   sg-conversation-list:select { id }
 *
 * @module sg-conversation-list
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';

export class SgConversationList extends SgComponent {
    static jsUrl = import.meta.url;

    #rows = [];
    #activeId = null;

    // ─── Public API ────────────────────────────────────────────────────────

    setConversations(rows) {
        this.#rows = Array.isArray(rows) ? [...rows] : [];
        if (this._isReady) this._renderAll();
    }

    setActive(id) {
        this.#activeId = id;
        if (this._isReady) {
            for (const el of this._listEl.querySelectorAll('.sgcl-row')) {
                el.classList.toggle('sgcl-row--active', el.dataset.cid === id);
            }
        }
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    bindElements() { this._listEl = this.$('.sgcl-list'); this._emptyEl = this.$('.sgcl-empty'); }

    setupEventListeners() {
        this.addTrackedListener(this._listEl, 'click', (e) => {
            const row = e.target.closest('.sgcl-row');
            if (row) this.emit('sg-conversation-list:select', { id: row.dataset.cid });
        });
    }

    onReady() { this._renderAll(); }

    // ─── Internals ─────────────────────────────────────────────────────────

    _renderAll() {
        const esc = t => this._escapeHtml(String(t ?? ''));
        this._emptyEl.hidden = this.#rows.length > 0;
        this._listEl.innerHTML = this.#rows.map(r => `
            <div class="sgcl-row${r.id === this.#activeId ? ' sgcl-row--active' : ''}" data-cid="${esc(r.id)}">
              <div class="sgcl-main">
                <span class="sgcl-name">${esc(r.name || r.id)}</span>
                <span class="sgcl-snippet">${esc(r.snippet || '')}</span>
              </div>
              <div class="sgcl-side">
                ${r.chip ? `<span class="sgcl-chip sgcl-chip--${esc(r.chip.tone || 'muted')}">${esc(r.chip.label)}</span>` : ''}
                ${r.unread ? `<span class="sgcl-unread">${esc(r.unread)}</span>` : ''}
              </div>
            </div>`).join('');
    }
}

customElements.define('sg-conversation-list', SgConversationList);
