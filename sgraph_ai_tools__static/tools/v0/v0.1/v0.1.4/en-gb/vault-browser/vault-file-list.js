/**
 * <vault-file-list> — Displays vault file listing grouped by type prefix.
 *
 * Supports both legacy bare/ path-based IDs and self-describing IDs
 * (e.g. ref-pid-muw-abc123). Groups by type prefix for self-describing IDs.
 *
 * Events emitted:
 *   vault-file-select  — { detail: { fileId } }
 *     Fired when the user clicks a file entry.
 *
 * Methods:
 *   render(fileIds)  — Render an array of file ID strings
 *   show() / hide()  — Toggle visibility
 *   setSelected(fileId) — Highlight the selected entry
 */
import { parseFileId, shortId } from '/core/vault-client/v1/v1.1/v1.1.0/vault-id-utils.js'

export class VaultFileList extends HTMLElement {

    connectedCallback() {
        this._selectedId = null

        this.innerHTML = `
            <style>
                vault-file-list { display: none; }
                vault-file-list.visible { display: block; }

                vault-file-list h2 {
                    font-size: 1.125rem;
                    margin-bottom: 0.75rem;
                }
                vault-file-list .vfl-list {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 0.75rem 1rem;
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                    line-height: 1.8;
                    max-height: 500px;
                    overflow-y: auto;
                }
                vault-file-list .vfl-group {
                    color: var(--sg-accent);
                    font-weight: 600;
                    margin-top: 0.5rem;
                }
                vault-file-list .vfl-group:first-child {
                    margin-top: 0;
                }
                vault-file-list .vfl-entry {
                    cursor: pointer;
                    padding: 0.125rem 0.5rem;
                    border-radius: 3px;
                    transition: background 0.1s;
                }
                vault-file-list .vfl-entry:hover {
                    background: rgba(78,205,196,0.1);
                    color: var(--sg-accent);
                }
                vault-file-list .vfl-entry.selected {
                    background: rgba(78,205,196,0.15);
                    color: var(--sg-accent);
                }
            </style>
            <h2>Vault Files</h2>
            <div class="vfl-list" id="vfl-list">(loading…)</div>`

        this._list = this.querySelector('#vfl-list')
    }

    render(fileIds) {
        this._list.innerHTML = ''

        if (!fileIds || fileIds.length === 0) {
            this._list.textContent = '(vault is empty)'
            return
        }

        // Group by type: bare/ path prefix or self-describing ID type
        const groups = {}
        const TYPE_LABELS = {
            'bare/data/':    'Objects',
            'bare/refs/':    'Refs',
            'bare/keys/':    'Keys',
            'bare/indexes/': 'Indexes',
            'obj':           'Objects',
            'ref':           'Refs',
            'key':           'Keys',
            'idx':           'Indexes',
            '':              'Other'
        }

        for (const id of fileIds) {
            let group   = ''
            let display = id

            // Try self-describing ID first
            const parts = id.split('/')
            const lastPart = parts[parts.length - 1]
            const parsed = parseFileId(lastPart)

            if (parsed) {
                group   = parsed.type
                display = shortId(id, 28)
            } else if (parts.length > 2) {
                // Legacy bare/ path format
                group   = parts.slice(0, 2).join('/') + '/'
                display = parts.slice(2).join('/')
            }

            if (!groups[group]) groups[group] = []
            groups[group].push({ fileId: id, display })
        }

        for (const [group, items] of Object.entries(groups).sort()) {
            if (group) {
                const header = document.createElement('div')
                header.className   = 'vfl-group'
                header.textContent = TYPE_LABELS[group] || group
                this._list.appendChild(header)
            }

            for (const { fileId, display } of items) {
                const entry = document.createElement('div')
                entry.className      = 'vfl-entry'
                entry.textContent    = display
                entry.dataset.fileId = fileId
                entry.title          = fileId
                entry.addEventListener('click', () => {
                    this.setSelected(fileId)
                    this.dispatchEvent(new CustomEvent('vault-file-select', {
                        bubbles: true,
                        detail: { fileId }
                    }))
                })
                this._list.appendChild(entry)
            }
        }
    }

    setSelected(fileId) {
        this._selectedId = fileId
        for (const el of this._list.querySelectorAll('.vfl-entry')) {
            el.classList.toggle('selected', el.dataset.fileId === fileId)
        }
    }

    show() { this.classList.add('visible') }
    hide() { this.classList.remove('visible') }
}

customElements.define('vault-file-list', VaultFileList)
