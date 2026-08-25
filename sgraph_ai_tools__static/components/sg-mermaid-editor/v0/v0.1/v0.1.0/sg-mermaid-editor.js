/**
 * <sg-mermaid-editor> — Mermaid markup editor with debounced live-update events.
 *
 * A styled textarea with a small toolbar. Emits `sg-mermaid:markup-changed`
 * on every debounced keystroke so a sibling <sg-mermaid-render> can re-render.
 * Intentionally decoupled from the renderer — wiring is the tool's job.
 *
 * API:
 *   getValue()           → string
 *   setValue(text)       → void  (fires markup-changed)
 *   focus()              → void
 *   clear()              → void  (fires markup-changed with '')
 *
 * Events (dispatched on element, bubbles + composed):
 *   sg-mermaid:markup-changed  — { markup: string }
 *
 * Attributes:
 *   placeholder  — textarea placeholder (default: 'Enter Mermaid markup…')
 *   debounce     — ms between keystrokes and emit (default: 600)
 *
 * @module sg-mermaid-editor
 * @version 0.1.0
 */

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; min-height: 0; }

.sme-toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 10px; background: var(--sg-bg-card,#0d1117);
    border: 1px solid var(--sg-border,#1a2a3a);
    border-bottom: none; border-radius: var(--sg-radius,6px) var(--sg-radius,6px) 0 0;
    flex-shrink: 0;
}

.sme-btn {
    background: rgba(15,52,96,.6); border: 1px solid var(--sg-border,#1a2a3a);
    color: var(--sg-text-dim,#8899aa); cursor: pointer; border-radius: 4px;
    padding: 3px 9px; font-size: .7rem; font-family: var(--sg-font-mono,monospace);
    transition: color .15s, border-color .15s, background .15s; line-height: 1.5;
}
.sme-btn:hover {
    color: var(--sg-accent,#4ecdc4); border-color: var(--sg-accent,#4ecdc4);
    background: rgba(15,52,96,1);
}

.sme-label {
    font-size: .7rem; color: var(--sg-text-dim,#8899aa);
    font-family: var(--sg-font-mono,monospace); margin-right: auto; opacity: .6;
}

.sme-status {
    font-size: .65rem; color: #c3e88d; font-family: var(--sg-font-mono,monospace);
    opacity: 0; transition: opacity .3s;
}
.sme-status.visible { opacity: 1; }

textarea {
    flex: 1; min-height: 0; resize: none;
    background: var(--sg-bg-card,#0d1117); color: var(--sg-text,#e2e8f0);
    border: 1px solid var(--sg-border,#1a2a3a);
    border-radius: 0 0 var(--sg-radius,6px) var(--sg-radius,6px);
    padding: 10px 12px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', Monaco, monospace;
    font-size: .8125rem; line-height: 1.65; tab-size: 2;
    outline: none; box-sizing: border-box; width: 100%;
    transition: border-color .15s;
}
textarea:focus { border-color: var(--sg-accent,#4ecdc4); }
textarea::placeholder { color: var(--sg-text-dim,#8899aa); opacity: .5; }
`;

export class SgMermaidEditor extends HTMLElement {
    connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' });
        const placeholder = this.getAttribute('placeholder') || 'Enter Mermaid markup…';

        shadow.innerHTML = `<style>${STYLES}</style>
<div class="sme-toolbar">
    <span class="sme-label">Mermaid markup</span>
    <button class="sme-btn" id="copy" title="Copy markup to clipboard">Copy</button>
    <button class="sme-btn" id="clear" title="Clear editor">Clear</button>
    <span class="sme-status" id="status"></span>
</div>
<textarea id="ta" spellcheck="false" autocorrect="off" autocapitalize="off"
          placeholder="${placeholder}"></textarea>`;

        this._ta      = shadow.getElementById('ta');
        this._status  = shadow.getElementById('status');
        this._timer   = null;
        this._debounceMs = parseInt(this.getAttribute('debounce') || '600', 10);

        this._ta.addEventListener('input', () => this._schedule());
        this._ta.addEventListener('keydown', e => this._onKey(e));

        shadow.getElementById('copy').addEventListener('click', () => this._copy());
        shadow.getElementById('clear').addEventListener('click', () => this.clear());
    }

    /** @returns {string} */
    getValue() { return this._ta?.value ?? ''; }

    /**
     * @param {string} text
     * @param {boolean} [silent=false] — if true, don't fire markup-changed
     */
    setValue(text, silent = false) {
        if (!this._ta) return;
        this._ta.value = text;
        if (!silent) this._emit(text);
    }

    focus() { this._ta?.focus(); }

    clear() {
        if (!this._ta) return;
        this._ta.value = '';
        this._emit('');
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _schedule() {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._emit(this._ta.value), this._debounceMs);
    }

    _emit(markup) {
        this.dispatchEvent(new CustomEvent('sg-mermaid:markup-changed',
            { detail: { markup }, bubbles: true, composed: true }));
    }

    _onKey(e) {
        // Tab inserts two spaces instead of moving focus
        if (e.key === 'Tab') {
            e.preventDefault();
            const { selectionStart: s, selectionEnd: en, value } = this._ta;
            this._ta.value = value.slice(0, s) + '  ' + value.slice(en);
            this._ta.selectionStart = this._ta.selectionEnd = s + 2;
            this._schedule();
        }
    }

    async _copy() {
        const text = this.getValue();
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            this._flash('Copied!');
        } catch {
            this._flash('Copy failed');
        }
    }

    _flash(msg) {
        this._status.textContent = msg;
        this._status.classList.add('visible');
        clearTimeout(this._flashTimer);
        this._flashTimer = setTimeout(() => this._status.classList.remove('visible'), 1800);
    }
}

customElements.define('sg-mermaid-editor', SgMermaidEditor);
