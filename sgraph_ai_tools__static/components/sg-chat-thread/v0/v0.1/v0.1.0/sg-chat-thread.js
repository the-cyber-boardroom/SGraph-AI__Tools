/**
 * sg-chat-thread.js
 * Message-thread Web Component: in/out bubbles, timestamps, receipt ticks,
 * media placeholders with intent buttons, an under-bubble transcript slot.
 * Platform-neutral — takes normalized messages, knows nothing about
 * WhatsApp/Graph. First consumer: whatsapp-desk; future: vault agent chats.
 *
 * Message shape:
 *   { id, direction: 'in'|'out', type: 'text'|'audio'|'image'|'video'|'document'|…,
 *     text?, timestamp, status?: 'sent'|'delivered'|'read'|'failed',
 *     voice?: boolean, transcript?: string, senderName? }
 *
 * Events (composed, bubbling):
 *   sg-chat-thread:media-click       { messageId, type }
 *   sg-chat-thread:transcribe-click  { messageId }
 *
 * @module sg-chat-thread
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';

const TICKS = { sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠' };
const MEDIA_ICON = { audio: '🎙', image: '🖼', video: '🎬', document: '📄', sticker: '🏷', location: '📍' };

export class SgChatThread extends SgComponent {
    static jsUrl = import.meta.url;

    #messages = [];

    // ─── Public API ────────────────────────────────────────────────────────

    /** Replace the thread. @param {Array} messages */
    setMessages(messages) {
        this.#messages = Array.isArray(messages) ? [...messages] : [];
        if (this._isReady) this._renderAll();
    }

    /** Append one message and keep scroll pinned to the bottom. */
    appendMessage(message) {
        this.#messages.push(message);
        if (this._isReady) {
            this._listEl.insertAdjacentHTML('beforeend', this._renderBubble(message));
            this._scrollToEnd();
        }
    }

    /** Update one message in place (receipt tick, transcript arrival). */
    updateMessage(messageId, patch) {
        const m = this.#messages.find(x => x.id === messageId);
        if (!m) return;
        Object.assign(m, patch);
        if (this._isReady) {
            const el = this._listEl.querySelector(`[data-mid="${CSS.escape(messageId)}"]`);
            if (el) { el.outerHTML = this._renderBubble(m); }
        }
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    bindElements() { this._listEl = this.$('.sgct-list'); }

    setupEventListeners() {
        this.addTrackedListener(this._listEl, 'click', this._onClick);
    }

    onReady() { this._renderAll(); }

    // ─── Internals ─────────────────────────────────────────────────────────

    _onClick(e) {
        const bubble = e.target.closest('[data-mid]');
        if (!bubble) return;
        const messageId = bubble.dataset.mid;
        if (e.target.closest('[data-transcribe]')) {
            this.emit('sg-chat-thread:transcribe-click', { messageId });
        } else if (e.target.closest('[data-media]')) {
            this.emit('sg-chat-thread:media-click', { messageId, type: bubble.dataset.type });
        }
    }

    _renderAll() {
        this._listEl.innerHTML = this.#messages.map(m => this._renderBubble(m)).join('');
        this._scrollToEnd();
    }

    _renderBubble(m) {
        const esc = t => this._escapeHtml(String(t ?? ''));
        const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const tick = m.direction === 'out' && m.status
            ? `<span class="sgct-tick${m.status === 'read' ? ' sgct-tick--read' : ''}${m.status === 'failed' ? ' sgct-tick--failed' : ''}">${TICKS[m.status] ?? ''}</span>`
            : '';
        const media = m.type !== 'text'
            ? `<button type="button" class="sgct-media" data-media>${MEDIA_ICON[m.type] ?? '📎'} ${esc(m.type)}${m.voice ? ' (voice note)' : ''}</button>`
              + (m.voice && !m.transcript
                  ? ` <button type="button" class="sgct-media" data-transcribe>📝 Transcribe</button>` : '')
            : '';
        const transcript = m.transcript
            ? `<div class="sgct-transcript">📝 ${esc(m.transcript)}</div>` : '';
        const name = m.direction === 'in' && m.senderName
            ? `<div class="sgct-name">${esc(m.senderName)}</div>` : '';
        return `
            <div class="sgct-row sgct-row--${m.direction}" data-mid="${esc(m.id)}" data-type="${esc(m.type)}">
              <div class="sgct-bubble">
                ${name}
                ${media}
                ${m.text ? `<div class="sgct-text">${esc(m.text)}</div>` : ''}
                ${transcript}
                <div class="sgct-meta">${time} ${tick}</div>
              </div>
            </div>`;
    }

    _scrollToEnd() { this._listEl.scrollTop = this._listEl.scrollHeight; }
}

customElements.define('sg-chat-thread', SgChatThread);
