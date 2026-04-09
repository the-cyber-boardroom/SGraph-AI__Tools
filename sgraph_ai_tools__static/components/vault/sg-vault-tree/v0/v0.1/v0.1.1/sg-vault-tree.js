/**
 * sg-vault-tree — Vault file/folder tree panel.
 *
 * Displays the decrypted directory tree for a connected vault. Listens for
 * vault:connected on the [data-vault-bus] ancestor, then loads and renders the
 * tree from the vault ref → commit → tree chain. Supports expand/collapse for
 * folders and lazy loading of sub-trees. Emits vault:file-select when the user
 * clicks a file.
 *
 * Bus events consumed:
 *   vault:connected    — { vault, keys }  → loads tree
 *   vault:disconnected — {}               → clears tree
 *   vault:tree-refresh — {}               → reloads tree
 *
 * Bus events emitted:
 *   vault:file-select  — { path, fileId, size }
 *
 * @module sg-vault-tree
 * @version 0.1.1
 */

import {
    readFileAsJson,
    walkTree,
    openVaultTree,
    decryptMetadata,
} from '/core/vault-client/v1/v1.2/v1.2.0/sg-vault-client.js';

export class SgVaultTree extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._vault     = null;
        this._keys      = null;
        this._handlers  = {};
    }

    connectedCallback() {
        this._render();
        this._bindBusEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [evt, fn] of Object.entries(this._handlers)) {
            bus.removeEventListener(evt, fn);
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────

    _render() {
        this.shadowRoot.innerHTML = `
<style>
  :host { display: block; font-family: inherit; height: 100%; overflow: hidden; }
  .vt-panel {
      height: 100%;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: var(--sg-radius, 6px);
      background: var(--sg-bg-secondary, #16213e);
      overflow: hidden;
  }
  .vt-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--sg-border, #2a3a5c);
      flex-shrink: 0;
  }
  .vt-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--sg-text-muted, #8892b0);
  }
  .vt-btn-new {
      background: transparent;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: 4px;
      color: var(--sg-text-muted, #8892b0);
      font-size: 0.7rem;
      padding: 0.2rem 0.45rem;
      cursor: pointer;
  }
  .vt-btn-new:hover { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }
  .vt-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 0.375rem 0;
  }
  .vt-empty {
      padding: 1rem 0.75rem;
      font-size: 0.8rem;
      color: var(--sg-text-muted, #8892b0);
      text-align: center;
  }
  .vt-loading {
      padding: 0.75rem;
      font-size: 0.8rem;
      color: var(--sg-text-muted, #8892b0);
      display: flex;
      align-items: center;
      gap: 0.5rem;
  }
  .spinner {
      flex-shrink: 0;
      width: 12px; height: 12px;
      border: 2px solid var(--sg-border, #2a3a5c);
      border-top-color: var(--sg-accent, #4ecdc4);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Tree node styles */
  .vt-node {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.75rem;
      font-size: 0.8125rem;
      cursor: pointer;
      color: var(--sg-text, #ccd6f6);
      user-select: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
  }
  .vt-node:hover { background: rgba(78,205,196,0.07); }
  .vt-node.active { background: rgba(78,205,196,0.12); color: var(--sg-accent, #4ecdc4); }
  .vt-node-icon { flex-shrink: 0; font-size: 0.75rem; width: 14px; text-align: center; }
  .vt-node-name { overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .vt-node-size { font-size: 0.7rem; color: var(--sg-text-muted, #8892b0); flex-shrink: 0; }
  .vt-children { /* indent handled via padding-left on each child */ }
  .vt-error {
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
      color: var(--sg-error, #e94560);
  }
</style>

<div class="vt-panel">
  <div class="vt-header">
    <span class="vt-title">Files</span>
    <button class="vt-btn-new" id="btn-new" style="display:none" title="New file">+ New</button>
  </div>
  <div class="vt-scroll" id="tree-scroll">
    <div class="vt-empty">Connect to a vault to browse files.</div>
  </div>
</div>
`;
        this.shadowRoot.getElementById('btn-new').addEventListener('click', () => {
            this._emit('vault:new-file-request', { path: '' });
        });
    }

    // ── Bus ────────────────────────────────────────────────────────────────

    _bindBusEvents() {
        const bus = this._bus();
        const on = (evt, fn) => {
            const bound = fn.bind(this);
            this._handlers[evt] = bound;
            bus.addEventListener(evt, bound);
        };
        on('vault:connected',    this._onConnected);
        on('vault:disconnected', this._onDisconnected);
        on('vault:tree-refresh', this._onRefresh);
    }

    _onConnected(e) {
        this._vault = e.detail.vault;
        this._keys  = e.detail.keys;
        this.shadowRoot.getElementById('btn-new').style.display = '';
        this._loadTree();
    }

    _onDisconnected() {
        this._vault = null;
        this._keys  = null;
        this.shadowRoot.getElementById('btn-new').style.display = 'none';
        this._showEmpty('Connect to a vault to browse files.');
    }

    _onRefresh() {
        if (this._vault) this._loadTree();
    }

    // ── Tree loading ───────────────────────────────────────────────────────

    async _loadTree() {
        const scroll = this.shadowRoot.getElementById('tree-scroll');
        scroll.innerHTML = '<div class="vt-loading"><div class="spinner"></div>Loading tree…</div>';

        try {
            // Load ref → commit → root tree (with name_enc decryption)
            const result = await openVaultTree(this._vault);

            if (!result || !result.entries || result.entries.length === 0) {
                this._showEmpty('Vault is empty. Create the first file!');
                return;
            }

            // Store commit info for later use
            this._currentCommit = result.commit;

            scroll.innerHTML = '';
            this._renderTree(scroll, result.entries, '', 0);

        } catch (err) {
            if (err.message?.includes('404')) {
                this._showEmpty('Vault is empty. Create the first file!');
            } else {
                scroll.innerHTML = `<div class="vt-error">Failed to load tree: ${_esc(err.message)}</div>`;
            }
        }
    }

    _renderTree(container, entries, pathPrefix, depth) {
        // Sort: folders first, then alphabetical
        const sorted = [...entries].sort((a, b) => {
            const aDir = !!a.tree_id;
            const bDir = !!b.tree_id;
            if (aDir !== bDir) return aDir ? -1 : 1;
            return (a.name || '').localeCompare(b.name || '');
        });

        for (const entry of sorted) {
            const name    = entry.name || '(encrypted)';
            const size    = entry.size ?? '';
            const isDir   = !!entry.tree_id;
            const path    = pathPrefix ? `${pathPrefix}/${name}` : name;
            const indent  = depth * 14;

            const node = document.createElement('div');
            node.className = 'vt-node';
            node.style.paddingLeft = `${0.75 + indent / 16}rem`;
            node.dataset.path = path;

            const icon = document.createElement('span');
            icon.className = 'vt-node-icon';
            icon.textContent = isDir ? '▶' : '·';

            const nameEl = document.createElement('span');
            nameEl.className = 'vt-node-name';
            nameEl.textContent = name;

            const sizeEl = document.createElement('span');
            sizeEl.className = 'vt-node-size';
            if (!isDir && size !== '') sizeEl.textContent = _formatBytes(size);

            node.append(icon, nameEl, sizeEl);

            if (isDir) {
                let expanded = false;
                const childrenDiv = document.createElement('div');
                childrenDiv.className = 'vt-children';
                childrenDiv.style.display = 'none';

                node.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    expanded = !expanded;
                    icon.textContent = expanded ? '▼' : '▶';
                    childrenDiv.style.display = expanded ? '' : 'none';

                    if (expanded && !entry._loaded) {
                        entry._loaded = true;
                        childrenDiv.innerHTML = '<div class="vt-loading" style="padding-left:1rem"><div class="spinner"></div></div>';
                        try {
                            // walkTree fetches + decrypts name_enc for all entries
                            const subTree = await walkTree(this._vault, entry.tree_id);
                            childrenDiv.innerHTML = '';
                            this._renderTree(childrenDiv, subTree.entries || [], path, depth + 1);
                        } catch (err) {
                            childrenDiv.innerHTML = `<div class="vt-error">Error: ${_esc(err.message)}</div>`;
                        }
                    }

                    this._emit('vault:folder-select', { path });
                });

                container.append(node, childrenDiv);
            } else {
                node.addEventListener('click', () => {
                    this.shadowRoot.querySelectorAll('.vt-node.active')
                        .forEach(n => n.classList.remove('active'));
                    node.classList.add('active');
                    this._emit('vault:file-select', {
                        path,
                        fileId: entry.blob_id,
                        size:   entry.size ?? 0,
                    });
                });
                container.append(node);
            }
        }
    }

    _showEmpty(msg) {
        const scroll = this.shadowRoot.getElementById('tree-scroll');
        scroll.innerHTML = `<div class="vt-empty">${_esc(msg)}</div>`;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-vault-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }

    _emit(eventName, detail) {
        this._bus().dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }
}

customElements.define('sg-vault-tree', SgVaultTree);

function _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _formatBytes(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
    return `${(n / (1024 * 1024)).toFixed(1)}M`;
}
