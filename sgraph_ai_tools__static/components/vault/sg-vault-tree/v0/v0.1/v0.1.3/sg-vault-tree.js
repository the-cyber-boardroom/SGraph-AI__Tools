/**
 * sg-vault-tree — Vault file/folder tree panel (session-based).
 *
 * Displays the decrypted directory tree from a VaultSession's persistent tree
 * model. Listens for vault:connected on the [data-vault-bus] ancestor, then
 * renders the tree from session.treeModel. Supports expand/collapse with lazy
 * loading via session.loadSubTree(). The tree model persists across refreshes
 * so expanded folders retain their state.
 *
 * Bus events consumed:
 *   vault:connected    — { session }     → renders tree from session.treeModel
 *   vault:disconnected — {}              → clears tree
 *   vault:tree-refresh — {}              → re-renders from model (no refetch)
 *
 * Bus events emitted:
 *   vault:file-select     — { path, fileId, size }
 *   vault:folder-select   — { path }
 *   vault:new-file-request — { path }
 *
 * @module sg-vault-tree
 * @version 0.1.3
 */

export class SgVaultTree extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._session   = null;
        this._handlers  = {};
        this._expanded  = new Set();
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
  .vt-children { }
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
        this._session = e.detail.session;
        this.shadowRoot.getElementById('btn-new').style.display = '';
        this._renderTreeFromModel();
    }

    _onDisconnected() {
        this._session = null;
        this._expanded.clear();
        this.shadowRoot.getElementById('btn-new').style.display = 'none';
        this._showEmpty('Connect to a vault to browse files.');
    }

    _onRefresh() {
        if (this._session) this._renderTreeFromModel();
    }

    // ── Tree rendering from session.treeModel ──────────────────────────────

    _renderTreeFromModel() {
        const scroll = this.shadowRoot.getElementById('tree-scroll');

        if (!this._session || !this._session.opened) {
            this._showEmpty('Vault is empty. Create the first file!');
            return;
        }

        const entries = this._session.treeModel.listFolder('/');
        if (!entries || entries.length === 0) {
            this._showEmpty('Vault is empty. Create the first file!');
            return;
        }

        scroll.innerHTML = '';
        this._renderEntries(scroll, entries, '', 0);
    }

    _renderEntries(container, entries, pathPrefix, depth) {
        const sorted = [...entries].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return (a.name || '').localeCompare(b.name || '');
        });

        for (const entry of sorted) {
            const name   = entry.name || '(encrypted)';
            const isDir  = entry.type === 'folder';
            const path   = pathPrefix ? `${pathPrefix}/${name}` : name;
            const indent = depth * 14;

            const node = document.createElement('div');
            node.className = 'vt-node';
            node.style.paddingLeft = `${0.75 + indent / 16}rem`;
            node.dataset.path = path;

            const icon = document.createElement('span');
            icon.className = 'vt-node-icon';

            const nameEl = document.createElement('span');
            nameEl.className = 'vt-node-name';
            nameEl.textContent = name;

            const sizeEl = document.createElement('span');
            sizeEl.className = 'vt-node-size';

            if (isDir) {
                const expanded = this._expanded.has(path);
                icon.textContent = expanded ? '▼' : '▶';

                const childrenDiv = document.createElement('div');
                childrenDiv.className = 'vt-children';
                childrenDiv.style.display = expanded ? '' : 'none';

                if (expanded) {
                    this._loadAndRenderChildren(childrenDiv, path, depth);
                }

                node.append(icon, nameEl, sizeEl);

                node.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const wasExpanded = this._expanded.has(path);
                    if (wasExpanded) {
                        this._expanded.delete(path);
                        icon.textContent = '▶';
                        childrenDiv.style.display = 'none';
                    } else {
                        this._expanded.add(path);
                        icon.textContent = '▼';
                        childrenDiv.style.display = '';
                        await this._loadAndRenderChildren(childrenDiv, path, depth);
                    }
                    this._emit('vault:folder-select', { path });
                });

                container.append(node, childrenDiv);
            } else {
                icon.textContent = '·';
                if (entry.size != null) sizeEl.textContent = _formatBytes(entry.size);

                node.append(icon, nameEl, sizeEl);

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

    async _loadAndRenderChildren(container, folderPath, depth) {
        const absPath = '/' + folderPath;

        if (this._session.treeModel.needsLoading(absPath)) {
            container.innerHTML = '<div class="vt-loading" style="padding-left:1rem"><div class="spinner"></div></div>';
            try {
                await this._session.loadSubTree(absPath);
            } catch (err) {
                container.innerHTML = `<div class="vt-error">Error: ${_esc(err.message)}</div>`;
                return;
            }
        }

        const children = this._session.treeModel.listFolder(absPath);
        container.innerHTML = '';

        if (!children || children.length === 0) {
            container.innerHTML = '<div class="vt-empty" style="padding:0.3rem 1rem;font-size:0.75rem">Empty folder</div>';
            return;
        }

        this._renderEntries(container, children, folderPath, depth + 1);
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
