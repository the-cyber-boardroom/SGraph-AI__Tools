/**
 * sg-vault-viewer — Vault file viewer and editor panel.
 *
 * Listens for vault:file-select on [data-vault-bus], fetches and decrypts the
 * file, and displays it for viewing/editing. For text/JSON files, provides a
 * textarea editor and a Save button that calls the write module to commit the
 * change and update the branch ref. Emits vault:file-saved when a write
 * completes.
 *
 * Bus events consumed:
 *   vault:connected    — { vault, keys }
 *   vault:file-select  — { path, fileId, size }
 *
 * Bus events emitted:
 *   vault:file-saved   — { path }
 *   vault:tree-refresh — {} (after a save)
 *
 * @module sg-vault-viewer
 * @version 0.1.1
 */

import {
    readFile,
} from '/core/vault-client/v1/v1.2/v1.2.0/sg-vault-client.js';

import {
    writeVaultFile,
} from '/core/vault-write/v1/v1.1/v1.1.0/sg-vault-write.js';

export class SgVaultViewer extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._vault    = null;
        this._keys     = null;
        this._path     = null;
        this._handlers = {};
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
  .vv-panel {
      height: 100%;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: var(--sg-radius, 6px);
      background: var(--sg-bg-secondary, #16213e);
      overflow: hidden;
  }
  .vv-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--sg-border, #2a3a5c);
      flex-shrink: 0;
      gap: 0.5rem;
      min-height: 36px;
  }
  .vv-path {
      font-size: 0.75rem;
      color: var(--sg-text-muted, #8892b0);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      font-family: monospace;
  }
  .vv-header-actions { display: flex; gap: 0.35rem; flex-shrink: 0; }
  .vv-btn {
      background: transparent;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: 4px;
      color: var(--sg-text-muted, #8892b0);
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      cursor: pointer;
  }
  .vv-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .vv-btn-save {
      border-color: var(--sg-accent, #4ecdc4);
      color: var(--sg-accent, #4ecdc4);
  }
  .vv-btn-save:hover:not(:disabled) { background: rgba(78,205,196,0.1); }
  .vv-btn-edit:hover:not(:disabled) { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }
  .vv-body {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
  }
  .vv-placeholder {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
      color: var(--sg-text-muted, #8892b0);
      padding: 1rem;
      text-align: center;
  }
  .vv-loading {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--sg-text-muted, #8892b0);
  }
  .spinner {
      flex-shrink: 0;
      width: 14px; height: 14px;
      border: 2px solid var(--sg-border, #2a3a5c);
      border-top-color: var(--sg-accent, #4ecdc4);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .vv-content {
      flex: 1;
      overflow: auto;
      padding: 0.5rem 0.75rem;
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.8125rem;
      color: var(--sg-text, #ccd6f6);
      white-space: pre-wrap;
      word-break: break-all;
  }
  .vv-editor {
      flex: 1;
      resize: none;
      border: none;
      background: var(--sg-bg-primary, #0d1b2a);
      color: var(--sg-text, #ccd6f6);
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.8125rem;
      padding: 0.5rem 0.75rem;
      outline: none;
      line-height: 1.5;
      width: 100%;
      box-sizing: border-box;
  }
  .vv-footer {
      flex-shrink: 0;
      border-top: 1px solid var(--sg-border, #2a3a5c);
      padding: 0.35rem 0.75rem;
      font-size: 0.7rem;
      color: var(--sg-text-muted, #8892b0);
      display: flex;
      align-items: center;
      gap: 0.75rem;
  }
  .vv-footer-status { flex: 1; }
  .vv-footer-status.ok     { color: #6ee7b7; }
  .vv-footer-status.error  { color: var(--sg-error, #e94560); }
  .vv-binary-notice {
      flex: 1;
      padding: 1rem;
      font-size: 0.8rem;
      color: var(--sg-text-muted, #8892b0);
      text-align: center;
  }
</style>

<div class="vv-panel">
  <div class="vv-header">
    <span class="vv-path" id="file-path">No file selected</span>
    <div class="vv-header-actions">
      <button class="vv-btn vv-btn-edit"  id="btn-edit"  style="display:none">Edit</button>
      <button class="vv-btn vv-btn-save"  id="btn-save"  style="display:none">Save</button>
      <button class="vv-btn"              id="btn-cancel" style="display:none">Cancel</button>
    </div>
  </div>
  <div class="vv-body" id="body">
    <div class="vv-placeholder">Select a file from the tree to view its contents.</div>
  </div>
  <div class="vv-footer" id="footer" style="display:none">
    <span class="vv-footer-status" id="footer-status"></span>
    <span id="footer-meta"></span>
  </div>
</div>
`;
        const btnEdit   = this.shadowRoot.getElementById('btn-edit');
        const btnSave   = this.shadowRoot.getElementById('btn-save');
        const btnCancel = this.shadowRoot.getElementById('btn-cancel');

        btnEdit.addEventListener('click',   () => this._startEdit());
        btnSave.addEventListener('click',   () => this._save());
        btnCancel.addEventListener('click', () => this._cancelEdit());
    }

    // ── Bus ────────────────────────────────────────────────────────────────

    _bindBusEvents() {
        const bus = this._bus();
        const on = (evt, fn) => {
            const bound = fn.bind(this);
            this._handlers[evt] = bound;
            bus.addEventListener(evt, bound);
        };
        on('vault:connected',    (e) => { this._vault = e.detail.vault; this._keys = e.detail.keys; });
        on('vault:disconnected', ()  => { this._vault = null; this._keys = null; this._reset(); });
        on('vault:file-select',  (e) => this._loadFile(e.detail));
    }

    // ── File loading ───────────────────────────────────────────────────────

    async _loadFile({ path, fileId, size }) {
        if (!this._vault || !fileId) return;

        this._path = path;
        this._currentFileId = fileId;
        this._cancelEdit();

        this.shadowRoot.getElementById('file-path').textContent = path;
        this._setBody('<div class="vv-loading"><div class="spinner"></div>Decrypting…</div>');
        this.shadowRoot.getElementById('footer').style.display = 'none';

        try {
            const data = await readFile(this._vault, fileId);
            const bytes = new Uint8Array(data);

            // Detect binary
            const isBinary = _isBinaryBytes(bytes);
            if (isBinary) {
                this._setBody(`<div class="vv-binary-notice">Binary file (${_formatBytes(bytes.length)}) — preview not supported.</div>`);
                this.shadowRoot.getElementById('btn-edit').style.display = 'none';
            } else {
                const text = new TextDecoder().decode(data);
                this._rawText = text;
                this._showContent(text);
                this.shadowRoot.getElementById('btn-edit').style.display = '';
            }

            const footer = this.shadowRoot.getElementById('footer');
            footer.style.display = '';
            this.shadowRoot.getElementById('footer-meta').textContent =
                `${_formatBytes(bytes.length)} · ${path.split('.').pop().toLowerCase()}`;
            this._setFooterStatus('');
        } catch (err) {
            this._setBody(`<div class="vv-binary-notice" style="color:var(--sg-error,#e94560)">Error: ${_esc(err.message)}</div>`);
        }
    }

    _showContent(text) {
        const body = this.shadowRoot.getElementById('body');
        body.innerHTML = `<div class="vv-content" id="view-content"></div>`;
        body.querySelector('#view-content').textContent = text;
    }

    _startEdit() {
        const body = this.shadowRoot.getElementById('body');
        body.innerHTML = `<textarea class="vv-editor" id="editor" spellcheck="false"></textarea>`;
        body.querySelector('#editor').value = this._rawText || '';
        this.shadowRoot.getElementById('btn-edit').style.display   = 'none';
        this.shadowRoot.getElementById('btn-save').style.display   = '';
        this.shadowRoot.getElementById('btn-cancel').style.display = '';
        body.querySelector('#editor').focus();
    }

    _cancelEdit() {
        if (this._rawText !== undefined && this._path) {
            this._showContent(this._rawText);
        }
        this.shadowRoot.getElementById('btn-edit').style.display   = this._path ? '' : 'none';
        this.shadowRoot.getElementById('btn-save').style.display   = 'none';
        this.shadowRoot.getElementById('btn-cancel').style.display = 'none';
        this._setFooterStatus('');
    }

    async _save() {
        const editor = this.shadowRoot.querySelector('#editor');
        if (!editor || !this._vault || !this._path) return;

        const newText  = editor.value;
        const saveBtn  = this.shadowRoot.getElementById('btn-save');
        saveBtn.disabled = true;
        this._setFooterStatus('Saving…');

        try {
            await writeVaultFile(this._vault, this._path, newText);
            this._rawText = newText;
            this._setFooterStatus('Saved.', 'ok');
            this._cancelEdit();
            this._emit('vault:file-saved', { path: this._path });
            this._emit('vault:tree-refresh', {});
        } catch (err) {
            this._setFooterStatus(`Save failed: ${err.message}`, 'error');
        } finally {
            saveBtn.disabled = false;
        }
    }

    _reset() {
        this._path    = null;
        this._rawText = undefined;
        this._setBody('<div class="vv-placeholder">Select a file from the tree to view its contents.</div>');
        this.shadowRoot.getElementById('file-path').textContent = 'No file selected';
        this.shadowRoot.getElementById('btn-edit').style.display   = 'none';
        this.shadowRoot.getElementById('btn-save').style.display   = 'none';
        this.shadowRoot.getElementById('btn-cancel').style.display = 'none';
        this.shadowRoot.getElementById('footer').style.display = 'none';
    }

    _setBody(html) {
        this.shadowRoot.getElementById('body').innerHTML = html;
    }

    _setFooterStatus(msg, type = '') {
        const el = this.shadowRoot.getElementById('footer-status');
        el.textContent = msg;
        el.className = `vv-footer-status ${type}`;
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

customElements.define('sg-vault-viewer', SgVaultViewer);

function _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function _isBinaryBytes(bytes) {
    // Check first 512 bytes for null bytes or high concentration of non-printable
    const sample = bytes.slice(0, 512);
    let nonPrintable = 0;
    for (const b of sample) {
        if (b === 0) return true;
        if (b < 9 || (b > 13 && b < 32)) nonPrintable++;
    }
    return nonPrintable / sample.length > 0.3;
}
