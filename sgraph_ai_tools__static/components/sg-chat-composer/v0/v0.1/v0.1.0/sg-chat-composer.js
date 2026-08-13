/**
 * sg-chat-composer.js
 * Composer Web Component: text box + attach + send, with a `mode` that
 * platforms with messaging windows (WhatsApp's 24h rule) switch to
 * template-only — free text disabled, template picker + reason chip shown.
 * Platform-neutral: templates arrive via setTemplates(); the host decides
 * what modes mean.
 *
 * Attributes:  mode = 'free' | 'template-only'   (observed)
 * Methods:     setDraft(text), getDraft(), setTemplates([{name,lang,label?}]),
 *              setReason(text), clear()
 * Events (composed, bubbling):
 *   sg-chat-composer:send    { kind: 'text', body } | { kind: 'template', name, lang }
 *   sg-chat-composer:attach  {}
 *
 * @module sg-chat-composer
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';

export class SgChatComposer extends SgComponent {
    static jsUrl = import.meta.url;

    #templates = [];
    #reason = '';

    static get observedAttributes() { return ['mode']; }
    attributeChangedCallback() { if (this._isReady) this._renderMode(); }

    get mode() { return this.getAttribute('mode') === 'template-only' ? 'template-only' : 'free'; }

    // ─── Public API ────────────────────────────────────────────────────────

    setDraft(text) { if (this._isReady) { this._textEl.value = String(text ?? ''); this._textEl.focus(); } }
    getDraft()     { return this._isReady ? this._textEl.value : ''; }
    clear()        { if (this._isReady) this._textEl.value = ''; }

    /** @param {Array<{name:string, lang:string, label?:string}>} templates */
    setTemplates(templates) {
        this.#templates = Array.isArray(templates) ? templates : [];
        if (this._isReady) this._renderTemplates();
    }

    /** Chip text explaining why free text is unavailable (template-only mode). */
    setReason(text) {
        this.#reason = String(text ?? '');
        if (this._isReady) this._renderMode();
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    bindElements() {
        this._textEl     = this.$('.sgcc-text');
        this._sendBtn    = this.$('.sgcc-send');
        this._attachBtn  = this.$('.sgcc-attach');
        this._templateEl = this.$('.sgcc-template');
        this._reasonEl   = this.$('.sgcc-reason');
    }

    setupEventListeners() {
        this.addTrackedListener(this._sendBtn, 'click', this._onSend);
        this.addTrackedListener(this._attachBtn, 'click', () => this.emit('sg-chat-composer:attach', {}));
        this.addTrackedListener(this._textEl, 'keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._onSend(); }
        });
    }

    onReady() { this._renderTemplates(); this._renderMode(); }

    // ─── Internals ─────────────────────────────────────────────────────────

    _onSend() {
        if (this.mode === 'template-only') {
            const [name, lang] = (this._templateEl.value || '').split('::');
            if (!name) return;
            this.emit('sg-chat-composer:send', { kind: 'template', name, lang });
            return;
        }
        const body = this._textEl.value.trim();
        if (!body) return;
        this.emit('sg-chat-composer:send', { kind: 'text', body });
        this._textEl.value = '';
    }

    _renderTemplates() {
        this._templateEl.innerHTML = this.#templates.map(t =>
            `<option value="${this._escapeHtml(t.name)}::${this._escapeHtml(t.lang)}">${this._escapeHtml(t.label || t.name)}</option>`
        ).join('');
    }

    _renderMode() {
        const tplOnly = this.mode === 'template-only';
        this._textEl.disabled        = tplOnly;
        this._textEl.placeholder     = tplOnly ? 'Free text unavailable — pick a template' : 'Type a message…';
        this._attachBtn.disabled     = tplOnly;
        this._templateEl.hidden      = !tplOnly;
        this._reasonEl.hidden        = !(tplOnly && this.#reason);
        this._reasonEl.textContent   = this.#reason;
        this._sendBtn.textContent    = tplOnly ? 'Send template' : 'Send';
    }
}

customElements.define('sg-chat-composer', SgChatComposer);
