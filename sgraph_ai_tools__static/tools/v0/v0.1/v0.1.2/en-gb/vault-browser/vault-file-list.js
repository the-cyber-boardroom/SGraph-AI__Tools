/**
 * <vault-file-list> — Displays vault file listing grouped by prefix.
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

        const groups = {}
        for (const id of fileIds) {
            const parts   = id.split('/')
            const group   = parts.length > 2 ? parts.slice(0, 2).join('/') + '/' : ''
            const display = parts.length > 2 ? parts.slice(2).join('/') : id
            if (!groups[group]) groups[group] = []
            groups[group].push({ fileId: id, display })
        }

        for (const [group, items] of Object.entries(groups).sort()) {
            if (group) {
                const header = document.createElement('div')
                header.className   = 'vfl-group'
                header.textContent = group
                this._list.appendChild(header)
            }

            for (const { fileId, display } of items) {
                const entry = document.createElement('div')
                entry.className      = 'vfl-entry'
                entry.textContent    = display
                entry.dataset.fileId = fileId
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
