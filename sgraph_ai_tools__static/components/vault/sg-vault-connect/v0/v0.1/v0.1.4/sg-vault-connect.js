/**
 * sg-vault-connect — Vault connection panel with session management.
 *
 * v0.1.4 changes:
 *  - Keys are parsed with vault-client's parseVaultKey() instead of a local
 *    lastIndexOf(':') split, so a key pasted exactly as sgit prints it
 *    (sgit_private_vault_{pass}:{id}) derives the same material as the CLI.
 *    Previously the prefix reached PBKDF2 and the vault was unreachable.
 *  - Re-pinned onto vault-client v1.2.3 / vault-write v1.1.2 /
 *    vault-session v1.0.1. Bare keys and simple tokens are unaffected.
 *
 * Displays a vault key entry form (passphrase:vaultId or simple token) with a
 * server URL input. On connect, derives keys, creates a VaultSession, opens it,
 * and emits vault:connected with the session object. Other components use the
 * session for cached reads, tree model access, and mutations.
 *
 * Bus events emitted:
 *   vault:connected    — { session, vault, vaultId, apiBaseUrl, keys }
 *   vault:disconnected — {}
 *
 * Attributes:
 *   api-url  — default API base URL (default: https://send.sgraph.ai)
 *
 * @module sg-vault-connect
 * @version 0.1.3
 */

import {
    parseVaultKey,
    readFile,
} from '/core/vault-client/v1/v1.2/v1.2.3/sg-vault-client.js';

import {
    deriveWriteKeys,
    deriveWriteKeysFromSimpleToken,
} from '/core/vault-write/v1/v1.1/v1.1.2/sg-vault-write.js';

import {
    createSession,
} from '/core/vault-session/v1/v1.0/v1.0.1/sg-vault-session.js';

export class SgVaultConnect extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._vault   = null;
        this._session = null;
    }

    static LS_KEY   = 'sg-vault:last-key';
    static LS_API   = 'sg-vault:last-api';
    static LS_TOKEN = 'sg-vault:last-token';

    connectedCallback() {
        this._render();
        this._bindEvents();
        this._restoreFromStorage();
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
      font-family: inherit;
  }
  .vc-input:focus { outline: none; border-color: var(--sg-accent, #4ecdc4); }
  .vc-input[type="password"] { font-family: monospace; letter-spacing: 0.05em; }
  .vc-btn {
      width: 100%;
      padding: 0.4rem 0.75rem;
      border-radius: var(--sg-radius, 6px);
      border: none;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
  }
  .vc-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .vc-btn-connect {
      background: var(--sg-accent, #4ecdc4);
      color: #0d1b2a;
  }
  .vc-btn-connect:hover:not(:disabled) { opacity: 0.85; }
  .vc-btn-disconnect {
      background: transparent;
      border: 1px solid var(--sg-error, #e94560);
      color: var(--sg-error, #e94560);
  }
  .vc-btn-disconnect:hover { background: rgba(233,69,96,0.1); }
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
  .vc-connected-info {
      font-size: 0.75rem;
      color: var(--sg-text-muted, #8892b0);
      margin-bottom: 0.5rem;
      word-break: break-all;
  }
  .vc-connected-info strong { color: #6ee7b7; }
</style>

<div class="vc-panel">
  <div class="vc-title">Vault Connection</div>

  <div id="form-area">
    <div class="vc-field">
      <label class="vc-label" for="vault-key">Vault Key</label>
      <input id="vault-key" class="vc-input" type="password"
             placeholder="passphrase:vaultId  or  word-word-0000" autocomplete="off" spellcheck="false">
    </div>
    <div class="vc-field">
      <label class="vc-label" for="api-url">Server URL</label>
      <input id="api-url" class="vc-input" type="text"
             placeholder="https://send.sgraph.ai" spellcheck="false">
    </div>
    <div class="vc-field">
      <label class="vc-label" for="access-token">Access Token (optional — needed for push)</label>
      <input id="access-token" class="vc-input" type="password" autocomplete="off" spellcheck="false"
             placeholder="Server access token">
    </div>
    <button id="btn-connect" class="vc-btn vc-btn-connect">Connect</button>
  </div>

  <div id="connected-area" style="display:none">
    <div class="vc-connected-info" id="connected-info"></div>
    <button id="btn-disconnect" class="vc-btn vc-btn-disconnect">Disconnect</button>
  </div>

  <div id="status" class="vc-status"></div>
</div>
`;
        const apiInput = this.shadowRoot.getElementById('api-url');
        if (apiInput) apiInput.value = this.apiUrl;
    }

    // ── LocalStorage ───────────────────────────────────────────────────────

    _restoreFromStorage() {
        try {
            const savedKey   = localStorage.getItem(SgVaultConnect.LS_KEY);
            const savedApi   = localStorage.getItem(SgVaultConnect.LS_API);
            const savedToken = localStorage.getItem(SgVaultConnect.LS_TOKEN);
            if (savedKey)   this.shadowRoot.getElementById('vault-key').value     = savedKey;
            if (savedApi)   this.shadowRoot.getElementById('api-url').value       = savedApi;
            if (savedToken) this.shadowRoot.getElementById('access-token').value  = savedToken;
        } catch { /* localStorage unavailable */ }
    }

    _saveToStorage(vaultKey, apiUrl, accessToken) {
        try {
            localStorage.setItem(SgVaultConnect.LS_KEY, vaultKey);
            localStorage.setItem(SgVaultConnect.LS_API, apiUrl);
            if (accessToken) {
                localStorage.setItem(SgVaultConnect.LS_TOKEN, accessToken);
            } else {
                localStorage.removeItem(SgVaultConnect.LS_TOKEN);
            }
        } catch { /* localStorage unavailable */ }
    }

    // ── Events ─────────────────────────────────────────────────────────────

    _bindEvents() {
        const btn = this.shadowRoot.getElementById('btn-connect');
        const dis = this.shadowRoot.getElementById('btn-disconnect');
        const key = this.shadowRoot.getElementById('vault-key');

        btn.addEventListener('click', () => this._connect());
        dis.addEventListener('click', () => this._disconnect());
        key.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._connect();
        });
    }

    // ── Connect / Disconnect ───────────────────────────────────────────────

    async _connect() {
        const keyInput   = this.shadowRoot.getElementById('vault-key');
        const urlInput   = this.shadowRoot.getElementById('api-url');
        const tokenInput = this.shadowRoot.getElementById('access-token');
        const btn        = this.shadowRoot.getElementById('btn-connect');

        const rawKey      = keyInput.value.trim();
        const apiBase     = (urlInput.value.trim() || this.apiUrl).replace(/\/$/, '');
        const accessToken = tokenInput.value.trim() || null;

        if (!rawKey) {
            this._showStatus('Enter a vault key or simple token.', 'error');
            return;
        }

        btn.disabled = true;
        this._showStatus('<span class="spinner"></span>Deriving vault keys…', 'info');

        try {
            let keys;
            const isSimpleToken = !rawKey.includes(':') || /^[a-z]+-[a-z]+-\d{4}$/.test(rawKey);
            if (isSimpleToken) {
                keys = await deriveWriteKeysFromSimpleToken(rawKey);
            } else {
                // parseVaultKey strips any sgit_* key prefix, so a key pasted
                // exactly as sgit prints it derives the same material as the CLI.
                const { passphrase, vaultId } = parseVaultKey(rawKey);
                keys = await deriveWriteKeys(passphrase, vaultId);
            }

            const vault = {
                keys,
                apiBaseUrl: apiBase,
                vaultId:    keys.vaultId,
            };

            // Create and open a VaultSession
            this._showStatus('<span class="spinner"></span>Opening vault session…', 'info');
            const session = createSession({
                apiBaseUrl: apiBase,
                vaultId:    keys.vaultId,
                keys,
                accessToken,
            });

            try {
                await session.open();
            } catch (e) {
                if (e.message.includes('404') || e.message.includes('not found')) {
                    if (isSimpleToken) {
                        this._showStatus(
                            `Vault not found for token "${_esc(rawKey)}". ` +
                            'This may be a share token — try <code>sgit clone ' + _esc(rawKey) + '</code> first, ' +
                            'then use the vault key from <code>.sg_vault/local/vault_key</code>.',
                            'error'
                        );
                        btn.disabled = false;
                        return;
                    }
                    // For full vault keys, allow connecting to new/empty vaults
                    // but session won't be fully open — tree model will be empty
                }
                if (!e.message.includes('404') && !e.message.includes('not found')) {
                    throw e;
                }
            }

            this._vault   = vault;
            this._session = session;
            this._saveToStorage(rawKey, apiBase, accessToken);

            const treeStats = session.treeModel.getStats();
            this._showConnected(keys.vaultId, apiBase, keys.derivationTimeMs || 0, treeStats);
            this._emit('vault:connected', {
                session,
                vault,
                vaultId: keys.vaultId,
                apiBaseUrl: apiBase,
                keys,
            });

        } catch (err) {
            this._showStatus(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    _disconnect() {
        this._vault   = null;
        this._session = null;
        this.shadowRoot.getElementById('form-area').style.display = '';
        this.shadowRoot.getElementById('connected-area').style.display = 'none';
        this.shadowRoot.getElementById('vault-key').value = '';
        this._showStatus('Disconnected.', 'info');
        this._emit('vault:disconnected', {});
    }

    _showConnected(vaultId, apiBase, ms, stats) {
        this.shadowRoot.getElementById('form-area').style.display = 'none';
        const area = this.shadowRoot.getElementById('connected-area');
        area.style.display = '';

        const filesInfo = stats
            ? ` · ${stats.totalFiles} files, ${stats.totalFolders} folders`
            : '';
        this.shadowRoot.getElementById('connected-info').innerHTML =
            `Connected to <strong>${vaultId}</strong><br>${apiBase}<br>` +
            `Keys derived in ${ms} ms${filesInfo}`;
        this._showStatus('Vault session open.', 'success');
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

customElements.define('sg-vault-connect', SgVaultConnect);

function _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
