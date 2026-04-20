/**
 * sg-vault-create — Vault creation panel.
 *
 * UI for bootstrapping a brand-new vault from scratch. Generates a passphrase
 * and vaultId (or accepts user input), derives keys, writes the empty tree +
 * initial commit + named HEAD ref to the server, and emits vault:created with
 * the new vault key for the user to save.
 *
 * After successful creation, also emits vault:connected with a fully open
 * VaultSession so other components automatically pick up the new vault.
 *
 * Bus events emitted:
 *   vault:created   — { vaultId, vaultKey, passphrase, keys, commitId, treeId }
 *   vault:connected — { session, vault, vaultId, apiBaseUrl, keys }
 *
 * Attributes:
 *   api-url  — default API base URL (default: https://send.sgraph.ai)
 *
 * @module sg-vault-create
 * @version 0.1.0
 */

import {
    createVault, generateVaultId, generateMemorablePassphrase,
} from '/core/vault-init/v1/v1.0/v1.0.0/sg-vault-init.js';

import {
    createSession,
} from '/core/vault-session/v1/v1.0/v1.0.0/sg-vault-session.js';

export class SgVaultCreate extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._created = null;
    }

    connectedCallback() {
        this._render();
        this._bindEvents();
        this._regenerate();
    }

    get apiUrl() {
        return this.getAttribute('api-url') || 'https://send.sgraph.ai';
    }

    // ── Render ─────────────────────────────────────────────────────────────

    _render() {
        this.shadowRoot.innerHTML = `
<style>
  :host { display: block; font-family: inherit; }
  .vc-panel {
      padding: 0.75rem;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: var(--sg-radius, 6px);
      background: var(--sg-bg-secondary, #16213e);
  }
  .vc-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--sg-text-muted, #8892b0);
      margin: 0 0 0.625rem 0;
  }
  .vc-field { margin-bottom: 0.5rem; }
  .vc-label {
      display: block;
      font-size: 0.6875rem;
      color: var(--sg-text-muted, #8892b0);
      margin-bottom: 0.2rem;
  }
  .vc-input {
      width: 100%;
      box-sizing: border-box;
      background: var(--sg-bg-primary, #0d1b2a);
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: var(--sg-radius, 6px);
      color: var(--sg-text, #ccd6f6);
      font-size: 0.8125rem;
      padding: 0.35rem 0.5rem;
      font-family: monospace;
  }
  .vc-input:focus { outline: none; border-color: var(--sg-accent, #4ecdc4); }
  .vc-row { display: flex; gap: 0.35rem; }
  .vc-row .vc-input { flex: 1; }
  .vc-btn-icon {
      background: transparent;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: 4px;
      color: var(--sg-text-muted, #8892b0);
      font-size: 0.7rem;
      padding: 0 0.5rem;
      cursor: pointer;
      flex-shrink: 0;
  }
  .vc-btn-icon:hover { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }
  .vc-btn {
      width: 100%;
      padding: 0.4rem 0.75rem;
      border-radius: var(--sg-radius, 6px);
      border: none;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
      background: var(--sg-accent, #4ecdc4);
      color: #0d1b2a;
      margin-top: 0.5rem;
  }
  .vc-btn:hover:not(:disabled) { opacity: 0.85; }
  .vc-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .vc-status {
      margin-top: 0.5rem;
      font-size: 0.75rem;
      padding: 0.3rem 0.5rem;
      border-radius: 4px;
      display: none;
  }
  .vc-status.visible { display: block; }
  .vc-status.info    { color: var(--sg-accent, #4ecdc4); background: rgba(78,205,196,0.08); border: 1px solid rgba(78,205,196,0.2); }
  .vc-status.error   { color: var(--sg-error, #e94560);  background: rgba(233,69,96,0.08);  border: 1px solid rgba(233,69,96,0.2); }
  .vc-status.success { color: #6ee7b7; background: rgba(110,231,183,0.08); border: 1px solid rgba(110,231,183,0.2); }
  .spinner {
      display: inline-block;
      width: 12px; height: 12px;
      border: 2px solid var(--sg-border, #2a3a5c);
      border-top-color: var(--sg-accent, #4ecdc4);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 0.35rem;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .vc-result {
      margin-top: 0.75rem;
      padding: 0.75rem;
      background: rgba(110,231,183,0.06);
      border: 1px solid rgba(110,231,183,0.25);
      border-radius: 4px;
      font-size: 0.75rem;
  }
  .vc-result-title {
      color: #6ee7b7;
      font-weight: 600;
      margin-bottom: 0.5rem;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
  }
  .vc-key-display {
      background: var(--sg-bg-primary, #0d1b2a);
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: 3px;
      padding: 0.4rem 0.5rem;
      font-family: monospace;
      font-size: 0.75rem;
      word-break: break-all;
      color: var(--sg-text, #ccd6f6);
      margin-bottom: 0.4rem;
  }
  .vc-warn {
      color: #fbbf24;
      font-size: 0.7rem;
      margin-top: 0.4rem;
      line-height: 1.4;
  }
  .vc-copy-btn {
      background: transparent;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: 3px;
      color: var(--sg-text-muted, #8892b0);
      font-size: 0.65rem;
      padding: 0.15rem 0.5rem;
      cursor: pointer;
      margin-right: 0.35rem;
  }
  .vc-copy-btn:hover { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }
</style>

<div class="vc-panel">
  <div class="vc-title">Create New Vault</div>

  <div id="form-area">
    <div class="vc-field">
      <label class="vc-label" for="passphrase">Passphrase</label>
      <div class="vc-row">
        <input id="passphrase" class="vc-input" type="text" spellcheck="false">
        <button id="btn-regen-pass" class="vc-btn-icon" title="Generate new">↻</button>
      </div>
    </div>

    <div class="vc-field">
      <label class="vc-label" for="vault-id">Vault ID (lowercase hex)</label>
      <div class="vc-row">
        <input id="vault-id" class="vc-input" type="text" spellcheck="false" maxlength="24">
        <button id="btn-regen-id" class="vc-btn-icon" title="Generate new">↻</button>
      </div>
    </div>

    <div class="vc-field">
      <label class="vc-label" for="api-url">Server URL</label>
      <input id="api-url" class="vc-input" type="text" spellcheck="false">
    </div>

    <div class="vc-field">
      <label class="vc-label" for="access-token">Access Token (required for write access)</label>
      <input id="access-token" class="vc-input" type="password" autocomplete="off" spellcheck="false"
             placeholder="Server access token">
    </div>

    <button id="btn-create" class="vc-btn">Create Vault</button>
  </div>

  <div id="result-area" style="display:none"></div>
  <div id="status" class="vc-status"></div>
</div>
`;
        const apiInput = this.shadowRoot.getElementById('api-url');
        if (apiInput) apiInput.value = this.apiUrl;
    }

    // ── Events ─────────────────────────────────────────────────────────────

    _bindEvents() {
        this.shadowRoot.getElementById('btn-create').addEventListener('click', () => this._create());
        this.shadowRoot.getElementById('btn-regen-pass').addEventListener('click', () => this._regeneratePassphrase());
        this.shadowRoot.getElementById('btn-regen-id').addEventListener('click', () => this._regenerateVaultId());
    }

    _regenerate() {
        this._regeneratePassphrase();
        this._regenerateVaultId();
    }

    _regeneratePassphrase() {
        this.shadowRoot.getElementById('passphrase').value = generateMemorablePassphrase();
    }

    _regenerateVaultId() {
        this.shadowRoot.getElementById('vault-id').value = generateVaultId();
    }

    // ── Create flow ────────────────────────────────────────────────────────

    async _create() {
        const passphrase  = this.shadowRoot.getElementById('passphrase').value.trim();
        const vaultId     = this.shadowRoot.getElementById('vault-id').value.trim().toLowerCase();
        const apiBase     = (this.shadowRoot.getElementById('api-url').value.trim() || this.apiUrl).replace(/\/$/, '');
        const accessToken = this.shadowRoot.getElementById('access-token').value.trim() || null;
        const btn         = this.shadowRoot.getElementById('btn-create');

        if (!passphrase) {
            this._showStatus('Passphrase required.', 'error');
            return;
        }
        if (!/^[0-9a-z]{4,24}$/.test(vaultId)) {
            this._showStatus('Vault ID must be 4-24 lowercase hex characters.', 'error');
            return;
        }
        if (!accessToken) {
            this._showStatus('Access token required to create a vault on the server.', 'error');
            return;
        }

        btn.disabled = true;
        this._showStatus('<span class="spinner"></span>Deriving keys + writing initial commit…', 'info');

        try {
            const result = await createVault({
                apiBaseUrl: apiBase,
                passphrase,
                vaultId,
                accessToken,
            });

            this._created = result;
            this._showResult(result, apiBase);
            this._showStatus('Vault created.', 'success');

            // Auto-open a session for the newly created vault and emit vault:connected
            const session = createSession({
                apiBaseUrl:  apiBase,
                vaultId:     result.vaultId,
                keys:        result.keys,
                accessToken,
            });
            await session.open();

            this._emit('vault:created', {
                vaultId:    result.vaultId,
                vaultKey:   result.vaultKey,
                passphrase: result.passphrase,
                keys:       result.keys,
                commitId:   result.commitId,
                treeId:     result.treeId,
            });
            this._emit('vault:connected', {
                session,
                vault: { keys: result.keys, apiBaseUrl: apiBase, vaultId: result.vaultId },
                vaultId:    result.vaultId,
                apiBaseUrl: apiBase,
                keys:       result.keys,
            });

        } catch (err) {
            this._showStatus(`Create failed: ${_esc(err.message)}`, 'error');
            btn.disabled = false;
        }
    }

    _showResult(result, apiBase) {
        this.shadowRoot.getElementById('form-area').style.display = 'none';
        const area = this.shadowRoot.getElementById('result-area');
        area.style.display = '';

        area.innerHTML = `
<div class="vc-result">
  <div class="vc-result-title">✓ Vault Created</div>

  <div class="vc-label" style="margin-top:0.5rem">Vault Key (save this!)</div>
  <div class="vc-key-display" id="key-display">${_esc(result.vaultKey)}</div>
  <div>
    <button class="vc-copy-btn" id="btn-copy-key">Copy Key</button>
    <button class="vc-copy-btn" id="btn-copy-id">Copy ID</button>
  </div>

  <div class="vc-warn">
    ⚠️ This is the only time the vault key will be shown. Save it now —
    without it, the vault contents are unrecoverable.
  </div>

  <div class="vc-label" style="margin-top:0.5rem">Server</div>
  <div class="vc-key-display">${_esc(apiBase)}</div>

  <div class="vc-label" style="margin-top:0.5rem">Initial Commit</div>
  <div class="vc-key-display" style="font-size:0.65rem">${_esc(result.commitId)}</div>
</div>
`;

        area.querySelector('#btn-copy-key').addEventListener('click', () => {
            navigator.clipboard?.writeText(result.vaultKey)
                .then(() => this._showStatus('Key copied to clipboard.', 'success'))
                .catch(() => this._showStatus('Copy failed — select manually.', 'error'));
        });
        area.querySelector('#btn-copy-id').addEventListener('click', () => {
            navigator.clipboard?.writeText(result.vaultId)
                .then(() => this._showStatus('Vault ID copied.', 'success'))
                .catch(() => this._showStatus('Copy failed.', 'error'));
        });
    }

    _showStatus(msg, type) {
        const el = this.shadowRoot.getElementById('status');
        el.innerHTML = msg;
        el.className = `vc-status visible ${type}`;
    }

    // ── Bus ────────────────────────────────────────────────────────────────

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

customElements.define('sg-vault-create', SgVaultCreate);

function _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
