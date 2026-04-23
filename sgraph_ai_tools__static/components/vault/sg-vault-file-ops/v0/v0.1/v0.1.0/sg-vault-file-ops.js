/**
 * sg-vault-file-ops — File/folder operation toolbar for vault sessions.
 *
 * Provides a context-aware toolbar with buttons for creating, renaming,
 * moving, and deleting files and folders. Listens for vault:file-select and
 * vault:folder-select to enable/disable actions. All operations go through
 * the mutations module and commit via the session's two-branch model.
 *
 * Bus events consumed:
 *   vault:connected      — { session }
 *   vault:disconnected   — {}
 *   vault:file-select    — { path, fileId, size }
 *   vault:folder-select  — { path }
 *
 * Bus events emitted:
 *   vault:tree-refresh        — {} (after any mutation)
 *   vault:file-ops-status     — { message, type }
 *   vault:new-file-request    — { path } (opens the create-file dialog)
 *
 * @module sg-vault-file-ops
 * @version 0.1.0
 */

import {
    addFile, removeFile, renameFile, moveFile,
    createFolder, removeFolder, renameFolder,
} from '/core/vault-mutations/v1/v1.0/v1.0.0/sg-vault-mutations.js';

export class SgVaultFileOps extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._session      = null;
        this._selectedPath  = null;
        this._selectedType  = null;
        this._handlers      = {};
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
  :host { display: block; font-family: inherit; }
  .fo-bar {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.4rem 0.75rem;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: var(--sg-radius, 6px);
      background: var(--sg-bg-secondary, #16213e);
      flex-wrap: wrap;
  }
  .fo-bar.hidden { display: none; }
  .fo-btn {
      background: transparent;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: 4px;
      color: var(--sg-text-muted, #8892b0);
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      cursor: pointer;
      white-space: nowrap;
  }
  .fo-btn:hover:not(:disabled) {
      border-color: var(--sg-accent, #4ecdc4);
      color: var(--sg-accent, #4ecdc4);
  }
  .fo-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .fo-btn-danger:hover:not(:disabled) {
      border-color: var(--sg-error, #e94560);
      color: var(--sg-error, #e94560);
  }
  .fo-sep {
      width: 1px;
      height: 16px;
      background: var(--sg-border, #2a3a5c);
      margin: 0 0.15rem;
  }
  .fo-selection {
      flex: 1;
      font-size: 0.7rem;
      color: var(--sg-text-muted, #8892b0);
      text-align: right;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
  }

  /* Dialog overlay */
  .fo-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 9999;
      align-items: center;
      justify-content: center;
  }
  .fo-overlay.visible { display: flex; }
  .fo-dialog {
      background: var(--sg-bg-secondary, #16213e);
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: var(--sg-radius, 6px);
      padding: 1.25rem;
      min-width: 320px;
      max-width: 440px;
  }
  .fo-dialog-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--sg-text, #ccd6f6);
      margin-bottom: 0.75rem;
  }
  .fo-dialog-label {
      font-size: 0.7rem;
      color: var(--sg-text-muted, #8892b0);
      margin-bottom: 0.2rem;
      display: block;
  }
  .fo-dialog-input {
      width: 100%;
      box-sizing: border-box;
      background: var(--sg-bg-primary, #0d1b2a);
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: 4px;
      color: var(--sg-text, #ccd6f6);
      font-size: 0.8125rem;
      padding: 0.35rem 0.5rem;
      font-family: monospace;
      margin-bottom: 0.75rem;
  }
  .fo-dialog-input:focus { outline: none; border-color: var(--sg-accent, #4ecdc4); }
  .fo-dialog-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
  }
  .fo-dialog-btn {
      padding: 0.3rem 0.75rem;
      border-radius: 4px;
      border: 1px solid var(--sg-border, #2a3a5c);
      background: transparent;
      color: var(--sg-text-muted, #8892b0);
      font-size: 0.75rem;
      cursor: pointer;
  }
  .fo-dialog-btn:hover { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }
  .fo-dialog-btn-primary {
      background: var(--sg-accent, #4ecdc4);
      color: #0d1b2a;
      border-color: transparent;
      font-weight: 600;
  }
  .fo-dialog-btn-primary:hover { opacity: 0.85; }
  .fo-dialog-btn-danger {
      border-color: var(--sg-error, #e94560);
      color: var(--sg-error, #e94560);
  }
  .fo-dialog-btn-danger:hover { background: rgba(233,69,96,0.1); }
  .fo-dialog-status {
      font-size: 0.7rem;
      margin-top: 0.5rem;
      color: var(--sg-error, #e94560);
  }
</style>

<div class="fo-bar hidden" id="bar">
  <button class="fo-btn" id="btn-new-file" disabled title="New file">+ File</button>
  <button class="fo-btn" id="btn-new-folder" disabled title="New folder">+ Folder</button>
  <div class="fo-sep"></div>
  <button class="fo-btn" id="btn-rename" disabled title="Rename selected">Rename</button>
  <button class="fo-btn fo-btn-danger" id="btn-delete" disabled title="Delete selected">Delete</button>
  <span class="fo-selection" id="selection"></span>
</div>

<div class="fo-overlay" id="overlay">
  <div class="fo-dialog" id="dialog"></div>
</div>
`;
        this.shadowRoot.getElementById('btn-new-file').addEventListener('click', () => this._showNewFileDialog());
        this.shadowRoot.getElementById('btn-new-folder').addEventListener('click', () => this._showNewFolderDialog());
        this.shadowRoot.getElementById('btn-rename').addEventListener('click', () => this._showRenameDialog());
        this.shadowRoot.getElementById('btn-delete').addEventListener('click', () => this._showDeleteDialog());
    }

    // ── Bus ────────────────────────────────────────────────────────────────

    _bindBusEvents() {
        const bus = this._bus();
        const on = (evt, fn) => {
            const bound = fn.bind(this);
            this._handlers[evt] = bound;
            bus.addEventListener(evt, bound);
        };
        on('vault:connected',    (e) => this._onConnected(e));
        on('vault:disconnected', ()  => this._onDisconnected());
        on('vault:file-select',  (e) => this._onSelect(e.detail.path, 'file'));
        on('vault:folder-select',(e) => this._onSelect(e.detail.path, 'folder'));
    }

    _onConnected(e) {
        this._session = e.detail.session;
        const bar = this.shadowRoot.getElementById('bar');
        if (this._session.writable) {
            bar.classList.remove('hidden');
            this.shadowRoot.getElementById('btn-new-file').disabled = false;
            this.shadowRoot.getElementById('btn-new-folder').disabled = false;
        }
    }

    _onDisconnected() {
        this._session = null;
        this._selectedPath = null;
        this._selectedType = null;
        this.shadowRoot.getElementById('bar').classList.add('hidden');
    }

    _onSelect(path, type) {
        this._selectedPath = path;
        this._selectedType = type;
        this.shadowRoot.getElementById('selection').textContent = path || '';
        this.shadowRoot.getElementById('btn-rename').disabled = !path;
        this.shadowRoot.getElementById('btn-delete').disabled = !path;
    }

    // ── Dialogs ────────────────────────────────────────────────────────────

    _showDialog(html) {
        const dialog = this.shadowRoot.getElementById('dialog');
        dialog.innerHTML = html;
        this.shadowRoot.getElementById('overlay').classList.add('visible');
        const input = dialog.querySelector('input');
        if (input) { input.focus(); input.select(); }
    }

    _hideDialog() {
        this.shadowRoot.getElementById('overlay').classList.remove('visible');
    }

    _showNewFileDialog() {
        const parentPath = this._selectedType === 'folder' ? '/' + this._selectedPath : '/';
        this._showDialog(`
            <div class="fo-dialog-title">New File</div>
            <label class="fo-dialog-label">Parent: ${_esc(parentPath)}</label>
            <input class="fo-dialog-input" id="dlg-input" placeholder="filename.txt" spellcheck="false">
            <div class="fo-dialog-actions">
                <button class="fo-dialog-btn" id="dlg-cancel">Cancel</button>
                <button class="fo-dialog-btn fo-dialog-btn-primary" id="dlg-ok">Create</button>
            </div>
            <div class="fo-dialog-status" id="dlg-status"></div>
        `);
        this.shadowRoot.getElementById('dlg-cancel').addEventListener('click', () => this._hideDialog());
        this.shadowRoot.getElementById('dlg-ok').addEventListener('click', async () => {
            const name = this.shadowRoot.getElementById('dlg-input').value.trim();
            if (!name) return;
            try {
                await addFile(this._session, parentPath, name, '');
                this._hideDialog();
                this._emit('vault:tree-refresh', {});
            } catch (err) {
                this.shadowRoot.getElementById('dlg-status').textContent = err.message;
            }
        });
        this.shadowRoot.getElementById('dlg-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.shadowRoot.getElementById('dlg-ok').click();
            if (e.key === 'Escape') this._hideDialog();
        });
    }

    _showNewFolderDialog() {
        const parentPath = this._selectedType === 'folder' ? '/' + this._selectedPath : '/';
        this._showDialog(`
            <div class="fo-dialog-title">New Folder</div>
            <label class="fo-dialog-label">Parent: ${_esc(parentPath)}</label>
            <input class="fo-dialog-input" id="dlg-input" placeholder="folder-name" spellcheck="false">
            <div class="fo-dialog-actions">
                <button class="fo-dialog-btn" id="dlg-cancel">Cancel</button>
                <button class="fo-dialog-btn fo-dialog-btn-primary" id="dlg-ok">Create</button>
            </div>
            <div class="fo-dialog-status" id="dlg-status"></div>
        `);
        this.shadowRoot.getElementById('dlg-cancel').addEventListener('click', () => this._hideDialog());
        this.shadowRoot.getElementById('dlg-ok').addEventListener('click', async () => {
            const name = this.shadowRoot.getElementById('dlg-input').value.trim();
            if (!name) return;
            try {
                await createFolder(this._session, parentPath, name);
                this._hideDialog();
                this._emit('vault:tree-refresh', {});
            } catch (err) {
                this.shadowRoot.getElementById('dlg-status').textContent = err.message;
            }
        });
        this.shadowRoot.getElementById('dlg-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.shadowRoot.getElementById('dlg-ok').click();
            if (e.key === 'Escape') this._hideDialog();
        });
    }

    _showRenameDialog() {
        if (!this._selectedPath) return;

        const lastSlash = this._selectedPath.lastIndexOf('/');
        const currentName = lastSlash >= 0 ? this._selectedPath.slice(lastSlash + 1) : this._selectedPath;
        const parentPath  = lastSlash > 0 ? '/' + this._selectedPath.slice(0, lastSlash) : '/';
        const renameFn    = this._selectedType === 'folder' ? renameFolder : renameFile;

        this._showDialog(`
            <div class="fo-dialog-title">Rename ${this._selectedType === 'folder' ? 'Folder' : 'File'}</div>
            <label class="fo-dialog-label">Current: ${_esc(currentName)}</label>
            <input class="fo-dialog-input" id="dlg-input" value="${_esc(currentName)}" spellcheck="false">
            <div class="fo-dialog-actions">
                <button class="fo-dialog-btn" id="dlg-cancel">Cancel</button>
                <button class="fo-dialog-btn fo-dialog-btn-primary" id="dlg-ok">Rename</button>
            </div>
            <div class="fo-dialog-status" id="dlg-status"></div>
        `);
        this.shadowRoot.getElementById('dlg-cancel').addEventListener('click', () => this._hideDialog());
        this.shadowRoot.getElementById('dlg-ok').addEventListener('click', async () => {
            const newName = this.shadowRoot.getElementById('dlg-input').value.trim();
            if (!newName || newName === currentName) return;
            try {
                await renameFn(this._session, parentPath, currentName, newName);
                this._hideDialog();
                this._selectedPath = null;
                this._onSelect(null, null);
                this._emit('vault:tree-refresh', {});
            } catch (err) {
                this.shadowRoot.getElementById('dlg-status').textContent = err.message;
            }
        });
        this.shadowRoot.getElementById('dlg-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.shadowRoot.getElementById('dlg-ok').click();
            if (e.key === 'Escape') this._hideDialog();
        });
    }

    _showDeleteDialog() {
        if (!this._selectedPath) return;

        const lastSlash = this._selectedPath.lastIndexOf('/');
        const name      = lastSlash >= 0 ? this._selectedPath.slice(lastSlash + 1) : this._selectedPath;
        const parentPath = lastSlash > 0 ? '/' + this._selectedPath.slice(0, lastSlash) : '/';
        const deleteFn  = this._selectedType === 'folder' ? removeFolder : removeFile;

        this._showDialog(`
            <div class="fo-dialog-title">Delete ${this._selectedType === 'folder' ? 'Folder' : 'File'}</div>
            <div class="fo-dialog-label" style="margin-bottom:0.75rem">
                Are you sure you want to delete <strong style="color:var(--sg-error,#e94560)">${_esc(name)}</strong>?
                ${this._selectedType === 'folder' ? '<br>This will remove the folder and all its contents.' : ''}
            </div>
            <div class="fo-dialog-actions">
                <button class="fo-dialog-btn" id="dlg-cancel">Cancel</button>
                <button class="fo-dialog-btn fo-dialog-btn-danger" id="dlg-ok">Delete</button>
            </div>
            <div class="fo-dialog-status" id="dlg-status"></div>
        `);
        this.shadowRoot.getElementById('dlg-cancel').addEventListener('click', () => this._hideDialog());
        this.shadowRoot.getElementById('dlg-ok').addEventListener('click', async () => {
            try {
                await deleteFn(this._session, parentPath, name);
                this._hideDialog();
                this._selectedPath = null;
                this._onSelect(null, null);
                this._emit('vault:tree-refresh', {});
            } catch (err) {
                this.shadowRoot.getElementById('dlg-status').textContent = err.message;
            }
        });
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

customElements.define('sg-vault-file-ops', SgVaultFileOps);

function _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
