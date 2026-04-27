/**
 * ved-vault-tree — lightweight custom element that renders a vault file tree.
 *
 * Listens for `ved:vault-ready` on document. When fired, calls openVaultTree()
 * and renders a collapsible tree. Clicking a file dispatches `ved:file-open`
 * on document.
 *
 * @module ved-vault-tree
 */

import { openVaultTree, walkTree } from '/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js'

const ICONS = {
    md:   '📝', markdown: '📝',
    json: '📋',
    png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼',
    sh:  '⚙',
    js:  '⚡',
    html: '🌐', htm: '🌐',
}

/** @param {string} name @returns {string} */
function fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase()
    return ICONS[ext] || '📄'
}

const STYLES = `
:host { display: block; height: 100%; overflow: auto; }

ul { list-style: none; margin: 0; padding: 0; }
li { margin: 0; }

.node {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.22rem 0.5rem;
    padding-left: calc(0.5rem + var(--depth, 0) * 1rem);
    font-size: 0.78rem;
    cursor: pointer;
    border-radius: 3px;
    color: #e2e8f0;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.node:hover { background: rgba(255,255,255,0.06); }
.node.active { background: rgba(0,255,170,0.12); color: #00ffaa; }

.node-icon { flex-shrink: 0; font-size: 0.9em; }
.node-name { overflow: hidden; text-overflow: ellipsis; }

.folder-toggle {
    flex-shrink: 0;
    font-size: 0.55em;
    color: #64748b;
    width: 0.8em;
    text-align: center;
}

.subtree { }

.msg {
    padding: 0.75rem 0.75rem;
    font-size: 0.78rem;
    color: #64748b;
    font-style: italic;
}
`

class VedVaultTree extends HTMLElement {
    constructor() {
        super()
        this._shadow = this.attachShadow({ mode: 'open' })
        this._vault = null
        this._activeEntryId = null
        this._bound = this._onVaultReady.bind(this)
    }

    connectedCallback() {
        this._shadow.innerHTML = `<style>${STYLES}</style><p class="msg">Waiting for vault credentials…</p>`
        document.addEventListener('ved:vault-ready', this._bound)
    }

    disconnectedCallback() {
        document.removeEventListener('ved:vault-ready', this._bound)
    }

    /** @param {CustomEvent} e */
    async _onVaultReady(e) {
        this._vault = e.detail.vault
        this._shadow.innerHTML = `<style>${STYLES}</style><p class="msg">Loading vault tree…</p>`
        try {
            const tree = await openVaultTree(this._vault)
            const ul = this._renderEntries(tree.rootTree.entries, 0)
            this._shadow.innerHTML = `<style>${STYLES}</style>`
            this._shadow.appendChild(ul)
        } catch (err) {
            this._shadow.innerHTML = `<style>${STYLES}</style><p class="msg">Error: ${err.message}</p>`
        }
    }

    /**
     * Render a list of tree entries as a `<ul>`.
     * @param {Array} entries
     * @param {number} depth
     * @returns {HTMLUListElement}
     */
    _renderEntries(entries, depth) {
        const ul = document.createElement('ul')
        for (const entry of entries) {
            ul.appendChild(this._renderEntry(entry, depth))
        }
        return ul
    }

    /**
     * Render a single entry as a `<li>`.
     * @param {object} entry
     * @param {number} depth
     * @returns {HTMLLIElement}
     */
    _renderEntry(entry, depth) {
        const li = document.createElement('li')

        if (entry.tree_id) {
            // Folder
            const node = this._makeNode({
                icon: '▶',
                name: entry.name || '[encrypted]',
                depth,
                extraClass: '',
            })
            node.querySelector('.folder-toggle').textContent = '▶'

            const subtreeWrap = document.createElement('div')
            subtreeWrap.className = 'subtree'
            subtreeWrap.hidden = true

            let loaded = false
            node.addEventListener('click', async () => {
                const open = !subtreeWrap.hidden
                if (open) {
                    subtreeWrap.hidden = true
                    node.querySelector('.folder-toggle').textContent = '▶'
                } else {
                    subtreeWrap.hidden = false
                    node.querySelector('.folder-toggle').textContent = '▼'
                    if (!loaded) {
                        loaded = true
                        subtreeWrap.innerHTML = `<p class="msg" style="padding-left:calc(0.5rem + ${depth + 1}rem)">Loading…</p>`
                        try {
                            const sub = await walkTree(this._vault, entry.tree_id)
                            subtreeWrap.innerHTML = ''
                            subtreeWrap.appendChild(this._renderEntries(sub.entries, depth + 1))
                        } catch (err) {
                            subtreeWrap.innerHTML = `<p class="msg">Error: ${err.message}</p>`
                        }
                    }
                }
            })

            li.appendChild(node)
            li.appendChild(subtreeWrap)
        } else {
            // File
            const entryId = entry.blob_id || entry.name
            const node = this._makeNode({
                icon: fileIcon(entry.name || ''),
                name: entry.name || '[encrypted]',
                depth,
                extraClass: this._activeEntryId === entryId ? 'active' : '',
            })
            node.querySelector('.folder-toggle').textContent = ''
            node.addEventListener('click', () => {
                // Clear previous active
                this._shadow.querySelectorAll('.node.active').forEach(n => n.classList.remove('active'))
                node.classList.add('active')
                this._activeEntryId = entryId
                document.dispatchEvent(new CustomEvent('ved:file-open', {
                    detail: { entry, vault: this._vault },
                    bubbles: false,
                }))
            })
            li.appendChild(node)
        }

        return li
    }

    /**
     * Build a node row element.
     * @param {{ icon: string, name: string, depth: number, extraClass: string }} opts
     * @returns {HTMLDivElement}
     */
    _makeNode({ icon, name, depth, extraClass }) {
        const node = document.createElement('div')
        node.className = `node${extraClass ? ' ' + extraClass : ''}`
        node.style.setProperty('--depth', depth)

        const toggle = document.createElement('span')
        toggle.className = 'folder-toggle'

        const iconEl = document.createElement('span')
        iconEl.className = 'node-icon'
        iconEl.textContent = icon

        const nameEl = document.createElement('span')
        nameEl.className = 'node-name'
        nameEl.textContent = name
        nameEl.title = name

        node.appendChild(toggle)
        node.appendChild(iconEl)
        node.appendChild(nameEl)
        return node
    }
}

customElements.define('ved-vault-tree', VedVaultTree)
