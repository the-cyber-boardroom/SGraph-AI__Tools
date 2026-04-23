/**
 * <vault-nav-history> — Breadcrumb trail for vault object navigation.
 *
 * Tracks visited file IDs and renders a clickable trail with back/forward.
 *
 * Events emitted:
 *   vault-object-navigate  — { detail: { fileId } }
 *     Fired when user clicks a breadcrumb or back/forward button.
 *
 * Methods:
 *   push(fileId)  — Add a new entry to history
 *   clear()       — Reset history
 */
export class VaultNavHistory extends HTMLElement {

    connectedCallback() {
        this._history = []   // array of fileId strings
        this._index   = -1   // current position

        this.innerHTML = `
            <style>
                vault-nav-history { display: none; }
                vault-nav-history.visible { display: block; }
                vault-nav-history .vnh-bar {
                    display: flex;
                    align-items: center;
                    gap: 0.375rem;
                    padding: 0.375rem 0;
                    font-size: 0.8125rem;
                    font-family: var(--sg-font-mono);
                    overflow-x: auto;
                    white-space: nowrap;
                }
                vault-nav-history .vnh-btn {
                    background: none;
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    color: var(--sg-text-dim);
                    padding: 0.125rem 0.5rem;
                    cursor: pointer;
                    font-size: 0.8125rem;
                    line-height: 1.4;
                    flex-shrink: 0;
                }
                vault-nav-history .vnh-btn:hover:not(:disabled) {
                    color: var(--sg-accent);
                    border-color: var(--sg-accent);
                }
                vault-nav-history .vnh-btn:disabled {
                    opacity: 0.3;
                    cursor: default;
                }
                vault-nav-history .vnh-sep {
                    color: var(--sg-text-dim);
                    flex-shrink: 0;
                }
                vault-nav-history .vnh-crumb {
                    color: var(--sg-text-dim);
                    cursor: pointer;
                    flex-shrink: 0;
                }
                vault-nav-history .vnh-crumb:hover {
                    color: var(--sg-accent);
                    text-decoration: underline;
                }
                vault-nav-history .vnh-crumb.current {
                    color: var(--sg-text);
                    font-weight: 600;
                    cursor: default;
                    text-decoration: none;
                }
            </style>
            <div class="vnh-bar" id="vnh-bar">
                <button class="vnh-btn" id="vnh-back" disabled title="Back">\u2190</button>
                <button class="vnh-btn" id="vnh-fwd"  disabled title="Forward">\u2192</button>
                <span id="vnh-crumbs"></span>
            </div>`

        this._backBtn  = this.querySelector('#vnh-back')
        this._fwdBtn   = this.querySelector('#vnh-fwd')
        this._crumbs   = this.querySelector('#vnh-crumbs')

        this._backBtn.addEventListener('click', () => this._go(this._index - 1))
        this._fwdBtn.addEventListener('click',  () => this._go(this._index + 1))
    }

    push(fileId) {
        // If we navigated back and then click something new, truncate forward history
        if (this._index < this._history.length - 1) {
            this._history = this._history.slice(0, this._index + 1)
        }
        this._history.push(fileId)
        this._index = this._history.length - 1
        this._render()
        this.classList.add('visible')
    }

    clear() {
        this._history = []
        this._index = -1
        this._render()
        this.classList.remove('visible')
    }

    _go(idx) {
        if (idx < 0 || idx >= this._history.length) return
        this._index = idx
        this._render()
        this.dispatchEvent(new CustomEvent('vault-object-navigate', {
            bubbles: true,
            detail: { fileId: this._history[idx] }
        }))
    }

    _render() {
        this._backBtn.disabled = this._index <= 0
        this._fwdBtn.disabled  = this._index >= this._history.length - 1

        this._crumbs.innerHTML = ''

        // Show last N entries to avoid overflow
        const maxShow = 6
        const start   = Math.max(0, this._history.length - maxShow)

        if (start > 0) {
            const dots = document.createElement('span')
            dots.className   = 'vnh-sep'
            dots.textContent = '… '
            this._crumbs.appendChild(dots)
        }

        for (let i = start; i < this._history.length; i++) {
            if (i > start) {
                const sep = document.createElement('span')
                sep.className   = 'vnh-sep'
                sep.textContent = ' \u203a '
                this._crumbs.appendChild(sep)
            }

            const crumb = document.createElement('span')
            crumb.className = 'vnh-crumb' + (i === this._index ? ' current' : '')
            crumb.textContent = this._shortId(this._history[i])
            crumb.title = this._history[i]
            if (i !== this._index) {
                const idx = i
                crumb.addEventListener('click', () => this._go(idx))
            }
            this._crumbs.appendChild(crumb)
        }
    }

    /** Shorten "bare/data/obj-abc123def456" to "obj-abc123d…" */
    _shortId(fileId) {
        const parts = fileId.split('/')
        const name  = parts[parts.length - 1]
        return name.length > 16 ? name.slice(0, 14) + '…' : name
    }
}

customElements.define('vault-nav-history', VaultNavHistory)
