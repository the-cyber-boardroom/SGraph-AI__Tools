/**
 * <vault-schema-ref> — Renders ref objects.
 *
 * Shows the commit_id reference with a clickable link.
 */
import { registerSchemaViewer } from './vault-schema-registry.js'

export class VaultSchemaRef extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <style>
                vault-schema-ref { display: block; }
                vault-schema-ref .vsr-section {
                    margin-bottom: 1rem;
                }
                vault-schema-ref .vsr-label {
                    font-size: 0.75rem;
                    color: var(--sg-text-dim);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 0.25rem;
                }
                vault-schema-ref .vsr-value {
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                }
                vault-schema-ref .vsr-ref {
                    color: var(--sg-accent, #4ecdc4);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                    cursor: pointer;
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                }
                vault-schema-ref .vsr-ref:hover {
                    text-decoration-style: solid;
                    filter: brightness(1.2);
                }
            </style>
            <div id="vsr-root"></div>`

        this._root = this.querySelector('#vsr-root')
    }

    render(data) {
        this._root.innerHTML = ''

        this._addTextRow('Version', data.version)

        // Commit ref — the main field
        if (data.commit_id) {
            const section = document.createElement('div')
            section.className = 'vsr-section'
            section.appendChild(this._makeLabel('Commit'))
            section.appendChild(this._refLink(data.commit_id))
            this._root.appendChild(section)
        }
    }

    _addTextRow(label, value) {
        if (value === null || value === undefined) return
        const section = document.createElement('div')
        section.className = 'vsr-section'
        section.appendChild(this._makeLabel(label))
        const val = document.createElement('div')
        val.className = 'vsr-value'
        val.textContent = String(value)
        section.appendChild(val)
        this._root.appendChild(section)
    }

    _makeLabel(text) {
        const el = document.createElement('div')
        el.className = 'vsr-label'
        el.textContent = text
        return el
    }

    _refLink(val) {
        const a = document.createElement('span')
        a.className   = 'vsr-ref'
        a.textContent = val
        a.title       = `Navigate to ${val}`
        a.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('vault-object-navigate', {
                bubbles: true,
                detail: { fileId: `bare/data/${val}` }
            }))
        })
        return a
    }
}

customElements.define('vault-schema-ref', VaultSchemaRef)
registerSchemaViewer('ref_v1', 'vault-schema-ref')
