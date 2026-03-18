/**
 * <vault-schema-commit> — Renders commit_v1 objects.
 *
 * Shows commit message, tree ref, parent refs, author, timestamp.
 */
import { registerSchemaViewer } from './vault-schema-registry.js'
import { fileIdToPath } from '/core/vault-client/v1/v1.1/v1.1.0/vault-id-utils.js'

export class VaultSchemaCommit extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <style>
                vault-schema-commit { display: block; }
                vault-schema-commit .vsc-section {
                    margin-bottom: 1rem;
                }
                vault-schema-commit .vsc-label {
                    font-size: 0.75rem;
                    color: var(--sg-text-dim);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 0.25rem;
                }
                vault-schema-commit .vsc-value {
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                }
                vault-schema-commit .vsc-message {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 0.75rem 1rem;
                    font-size: 0.875rem;
                    line-height: 1.5;
                    white-space: pre-wrap;
                    margin-bottom: 1rem;
                }
                vault-schema-commit .vsc-ref {
                    color: var(--sg-accent, #4ecdc4);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                    cursor: pointer;
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                }
                vault-schema-commit .vsc-ref:hover {
                    text-decoration-style: solid;
                    filter: brightness(1.2);
                }
                vault-schema-commit .vsc-parents {
                    display: flex;
                    flex-direction: column;
                    gap: 0.25rem;
                }
            </style>
            <div id="vsc-root"></div>`

        this._root = this.querySelector('#vsc-root')
    }

    render(data) {
        this._root.innerHTML = ''

        // Message (check both decrypted and encrypted forms)
        const message = data.message || (data.message_enc ? '[encrypted]' : null)
        if (message) {
            const msgLabel = this._makeLabel('Message')
            this._root.appendChild(msgLabel)
            const msg = document.createElement('div')
            msg.className = 'vsc-message'
            msg.textContent = message
            this._root.appendChild(msg)
        }

        // Core fields
        this._addRefRow('Tree', data.tree_id, 'obj-')
        this._addTextRow('Schema', data.schema || 'commit_v1')
        this._addTextRow('Timestamp', data.timestamp_ms ? new Date(data.timestamp_ms).toISOString() : '—')
        this._addRefRow('Branch', data.branch_id)
        this._addRefRow('Author Key', data.author_key_id)

        // Parents
        const parents = data.parents || (data.parent ? [data.parent] : [])
        if (parents.length > 0) {
            this._root.appendChild(this._makeLabel(`Parents (${parents.length})`))
            const container = document.createElement('div')
            container.className = 'vsc-parents'
            for (const pid of parents) {
                container.appendChild(this._refLink(pid, 'obj-'))
            }
            this._root.appendChild(container)
            this._root.appendChild(document.createElement('br'))
        }

        // Signature
        if (data.signature) {
            this._addTextRow('Signature', data.signature)
        }
        if (data.author_signature) {
            this._addTextRow('Author Signature', data.author_signature)
        }
    }

    _addTextRow(label, value) {
        if (value === null || value === undefined) return
        const section = document.createElement('div')
        section.className = 'vsc-section'
        section.appendChild(this._makeLabel(label))
        const val = document.createElement('div')
        val.className = 'vsc-value'
        val.textContent = String(value)
        section.appendChild(val)
        this._root.appendChild(section)
    }

    _addRefRow(label, value, prefix) {
        if (value === null || value === undefined) return
        const section = document.createElement('div')
        section.className = 'vsc-section'
        section.appendChild(this._makeLabel(label))
        section.appendChild(this._refLink(value, prefix))
        this._root.appendChild(section)
    }

    _makeLabel(text) {
        const el = document.createElement('div')
        el.className = 'vsc-label'
        el.textContent = text
        return el
    }

    _refLink(val, prefix) {
        const a = document.createElement('span')
        a.className   = 'vsc-ref'
        a.textContent = val
        a.title       = `Navigate to ${val}`
        a.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('vault-object-navigate', {
                bubbles: true,
                detail: { fileId: this._refToFileId(val) }
            }))
        })
        return a
    }

    _refToFileId(val) {
        return fileIdToPath(val)
    }
}

customElements.define('vault-schema-commit', VaultSchemaCommit)
registerSchemaViewer('commit_v1', 'vault-schema-commit')
