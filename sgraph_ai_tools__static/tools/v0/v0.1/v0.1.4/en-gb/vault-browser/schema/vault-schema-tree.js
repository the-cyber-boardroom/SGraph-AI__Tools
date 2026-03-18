/**
 * <vault-schema-tree> — Renders tree_v1 objects.
 *
 * Shows file entries with clickable blob and sub-tree references.
 */
import { registerSchemaViewer } from './vault-schema-registry.js'
import { fileIdToPath } from '/core/vault-client/v1/v1.1/v1.1.0/vault-id-utils.js'

export class VaultSchemaTree extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <style>
                vault-schema-tree { display: block; }
                vault-schema-tree .vst-label {
                    font-size: 0.75rem;
                    color: var(--sg-text-dim);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 0.5rem;
                }
                vault-schema-tree .vst-entry {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 0.5rem 0.75rem;
                    margin-bottom: 0.375rem;
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                }
                vault-schema-tree .vst-icon {
                    flex-shrink: 0;
                    width: 1.25rem;
                    text-align: center;
                    color: var(--sg-text-dim);
                }
                vault-schema-tree .vst-name {
                    flex: 1;
                    font-weight: 500;
                }
                vault-schema-tree .vst-size {
                    color: var(--sg-text-dim);
                    font-size: 0.75rem;
                    flex-shrink: 0;
                }
                vault-schema-tree .vst-ref {
                    color: var(--sg-accent, #4ecdc4);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                    cursor: pointer;
                    font-size: 0.75rem;
                    flex-shrink: 0;
                }
                vault-schema-tree .vst-ref:hover {
                    text-decoration-style: solid;
                    filter: brightness(1.2);
                }
            </style>
            <div id="vst-root"></div>`

        this._root = this.querySelector('#vst-root')
    }

    render(data) {
        this._root.innerHTML = ''

        const entries = data.entries || []
        const label = document.createElement('div')
        label.className = 'vst-label'
        label.textContent = `TREE ENTRIES (${entries.length})`
        this._root.appendChild(label)

        for (const entry of entries) {
            this._root.appendChild(this._renderEntry(entry))
        }

        if (entries.length === 0) {
            const empty = document.createElement('div')
            empty.style.color = 'var(--sg-text-dim)'
            empty.style.fontStyle = 'italic'
            empty.textContent = '(empty tree)'
            this._root.appendChild(empty)
        }
    }

    _renderEntry(entry) {
        const row = document.createElement('div')
        row.className = 'vst-entry'

        const isDir = entry.tree_id && !entry.blob_id
        const icon  = document.createElement('span')
        icon.className   = 'vst-icon'
        icon.textContent = isDir ? '/' : ' '
        row.appendChild(icon)

        const name = document.createElement('span')
        name.className   = 'vst-name'
        name.textContent = entry.path || entry.name || (entry.name_enc ? '[encrypted]' : '(unnamed)')
        row.appendChild(name)

        const sizeVal = entry.size !== undefined && entry.size !== null
            ? entry.size
            : (entry.size_enc ? '[enc]' : null)
        if (sizeVal !== null) {
            const size = document.createElement('span')
            size.className   = 'vst-size'
            size.textContent = typeof sizeVal === 'number' ? this._formatBytes(sizeVal) : sizeVal
            row.appendChild(size)
        }

        // Blob ref
        if (entry.blob_id) {
            row.appendChild(this._refLink(entry.blob_id, 'blob'))
        }
        // Sub-tree ref
        if (entry.tree_id) {
            row.appendChild(this._refLink(entry.tree_id, 'tree'))
        }

        return row
    }

    _refLink(val, label) {
        const a = document.createElement('span')
        a.className   = 'vst-ref'
        a.textContent = label || val
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

    _formatBytes(n) {
        if (n < 1024) return `${n} B`
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
        return `${(n / (1024 * 1024)).toFixed(1)} MB`
    }
}

customElements.define('vault-schema-tree', VaultSchemaTree)
registerSchemaViewer('tree_v1', 'vault-schema-tree')
