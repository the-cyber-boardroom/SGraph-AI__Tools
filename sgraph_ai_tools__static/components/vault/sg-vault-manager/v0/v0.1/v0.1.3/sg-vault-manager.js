/**
 * sg-vault-manager — Multi-vault registry and connect UX.
 *
 * v0.1.3 changes:
 *  - Keys are parsed with vault-client's parseVaultKey(), which strips sgit
 *    key prefixes. Same fix as sg-vault-connect v0.1.4.
 *  - Re-pinned onto vault-client v1.2.3 / vault-write v1.1.2.
 *
 * v0.1.1 changes:
 *  - Registry now stores optional vaultKey (raw passphrase:vaultId string) when
 *    the user ticks "Remember key". Pre-fills the key field when a known vault
 *    is selected from the dropdown.
 *  - New "Access Token" field: an optional server-level auth token passed through
 *    to write operations as x-sgraph-access-token header. Stored in registry.
 *    Pre-fills when selecting a known vault.
 *  - vault:connected event detail now includes { …, accessToken }.
 *
 * Platform component. Maintains a registry of known vaults in
 * localStorage['sg-vault-registry']. On connect, derives write keys, verifies
 * vault access, and fires events on a [data-vault-bus] ancestor element.
 *
 * Fires on [data-vault-bus] ancestor (or document as fallback):
 *   vault:connected    { vault, vaultId, displayName, apiBaseUrl, keys, accessToken, isNew }
 *   vault:disconnected { vaultId }
 *
 * Attributes:
 *   api-url — default API base URL (default: https://send.sgraph.ai)
 *
 * @module sg-vault-manager
 * @version 0.1.2
 */

import {
  parseVaultKey,
  readFile,
} from '/core/vault-client/v1/v1.2/v1.2.3/sg-vault-client.js';

import {
  deriveWriteKeys,
  deriveWriteKeysFromSimpleToken,
} from '/core/vault-write/v1/v1.1/v1.1.2/sg-vault-write.js';

// ── Registry helpers (localStorage) ──────────────────────────────────────────

const LS_REGISTRY_KEY = 'sg-vault-registry';

/**
 * @typedef {object} RegistryEntry
 * @property {string} vaultId
 * @property {string} displayName
 * @property {string} apiBaseUrl
 * @property {number} lastUsed
 * @property {string} [vaultKey]    - Raw key string, stored only when user opted in
 * @property {string} [accessToken] - Optional server-level access token
 */

/**
 * @returns {RegistryEntry[]}
 */
function _loadRegistry() {
  try {
    return JSON.parse(localStorage.getItem(LS_REGISTRY_KEY) || '[]');
  } catch (_) {
    return [];
  }
}

/**
 * @param {RegistryEntry[]} registry
 */
function _saveRegistry(registry) {
  try {
    localStorage.setItem(LS_REGISTRY_KEY, JSON.stringify(registry));
  } catch (_) {}
}

/**
 * @param {string} vaultId
 * @param {string} displayName
 * @param {string} apiBaseUrl
 * @param {object} [extra] - { vaultKey?, accessToken? }
 */
function _upsertRegistry(vaultId, displayName, apiBaseUrl, extra = {}) {
  const reg = _loadRegistry();
  const idx = reg.findIndex(r => r.vaultId === vaultId);
  const entry = { vaultId, displayName, apiBaseUrl, lastUsed: Date.now(), ...extra };
  if (idx >= 0) {
    reg[idx] = { ...reg[idx], ...entry };
  } else {
    reg.push(entry);
  }
  _saveRegistry(reg);
}

/**
 * @param {string} vaultId
 */
function _removeFromRegistry(vaultId) {
  const reg = _loadRegistry().filter(r => r.vaultId !== vaultId);
  _saveRegistry(reg);
}

// ── Web Component ─────────────────────────────────────────────────────────────

export class SgVaultManager extends HTMLElement {

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    /** @type {object|null} Active vault handle */
    this._vault       = null;
    /** @type {string} Active display name */
    this._displayName = '';
    this._connecting  = false;
  }

  get apiUrl() {
    return this.getAttribute('api-url') || 'https://send.sgraph.ai';
  }

  connectedCallback() {
    this._render();
    this._bindEvents();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  _render() {
    const registry = _loadRegistry();
    const hasKnown = registry.length > 0;
    const sortedReg = [...registry].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));

    this.shadowRoot.innerHTML = `
<style>
  :host { display: block; font-family: inherit; }
  .vm {
    padding: 0.75rem;
    border: 1px solid var(--sg-border, #2a3a5c);
    border-radius: var(--sg-radius, 6px);
    background: var(--sg-surface, #0f1a2e);
  }
  label {
    display: block;
    font-size: 0.72rem;
    color: var(--sg-muted, #8899aa);
    margin-bottom: 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  input, select {
    width: 100%;
    box-sizing: border-box;
    padding: 0.4rem 0.55rem;
    background: var(--sg-input-bg, #0a0f1a);
    border: 1px solid var(--sg-border, #2a3a5c);
    border-radius: 4px;
    color: var(--sg-text, #ccd6f6);
    font-size: 0.82rem;
    margin-bottom: 0.5rem;
    font-family: inherit;
  }
  input:focus, select:focus {
    outline: none;
    border-color: var(--sg-teal, #4ECDC4);
  }
  input[type="password"] { font-family: monospace; letter-spacing: 0.05em; }
  input[type="checkbox"] {
    width: auto;
    margin: 0;
    margin-bottom: 0;
    cursor: pointer;
    accent-color: var(--sg-teal, #4ECDC4);
  }
  .row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center; }
  .row input, .row select { margin-bottom: 0; }
  .check-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }
  .check-row label {
    font-size: 0.74rem;
    color: var(--sg-muted, #8899aa);
    text-transform: none;
    letter-spacing: normal;
    margin: 0;
    cursor: pointer;
  }
  button {
    padding: 0.38rem 0.9rem;
    border: 1px solid var(--sg-teal, #4ECDC4);
    border-radius: 4px;
    background: var(--sg-teal, #4ECDC4);
    color: #0d1b2a;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    font-family: inherit;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-ghost {
    background: transparent;
    border-color: var(--sg-border, #2a3a5c);
    color: var(--sg-muted, #8899aa);
  }
  .btn-ghost:hover:not(:disabled) { border-color: var(--sg-muted, #8899aa); color: var(--sg-text, #ccd6f6); }
  .status { font-size: 0.78rem; color: var(--sg-muted, #8899aa); min-height: 1.3em; margin-top: 0.35rem; }
  .status.ok  { color: #6ee7b7; }
  .status.err { color: #ff6b6b; }
  .connected-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.45rem 0.65rem;
    background: rgba(78,205,196,0.07);
    border: 1px solid rgba(78,205,196,0.28);
    border-radius: 4px;
  }
  .connected-bar .lbl { font-size: 0.82rem; color: #6ee7b7; }
  .connected-bar .disc {
    background: transparent;
    border: 1px solid var(--sg-border, #2a3a5c);
    color: var(--sg-muted, #8899aa);
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
  }
  .hidden { display: none !important; }
  .field { margin-bottom: 0.5rem; }
  .field > label { margin-bottom: 0.2rem; }
  .divider {
    border: none;
    border-top: 1px solid var(--sg-border, #2a3a5c);
    margin: 0.6rem 0;
  }
  .section-label {
    font-size: 0.68rem;
    color: #4a6080;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 0.4rem;
  }
</style>
<div class="vm">
  <div id="connected-bar" class="connected-bar hidden">
    <span class="lbl" id="connected-label">Connected</span>
    <button class="disc" id="disconnect-btn">Disconnect</button>
  </div>
  <div id="connect-form">
    ${hasKnown ? `
    <div class="field">
      <label>Known vault</label>
      <select id="known-select">
        <option value="">— new vault —</option>
        ${sortedReg.map(r => `<option value="${_esc(r.vaultId)}"
          data-api="${_esc(r.apiBaseUrl)}"
          data-name="${_esc(r.displayName || r.vaultId)}"
          data-key="${_esc(r.vaultKey || '')}"
          data-token="${_esc(r.accessToken || '')}"
        >${_esc(r.displayName || r.vaultId)}</option>`).join('')}
      </select>
    </div>
    ` : ''}
    <div class="field">
      <label>Vault key</label>
      <input type="password" id="vault-key" placeholder="passphrase:vaultId" autocomplete="off" spellcheck="false" />
    </div>
    <div class="check-row">
      <input type="checkbox" id="remember-key" />
      <label for="remember-key">Remember key in browser (stored in localStorage)</label>
    </div>
    <hr class="divider" />
    <div class="field">
      <label>Access token <span style="color:#4a6080;text-transform:none;letter-spacing:normal;">(optional — required by some servers)</span></label>
      <input type="password" id="access-token" placeholder="Server access token" autocomplete="off" spellcheck="false" />
    </div>
    <hr class="divider" />
    <div class="field">
      <label>Display name (optional)</label>
      <input type="text" id="display-name" placeholder="e.g. Personal Vault" />
    </div>
    <div class="field">
      <label>Server URL</label>
      <input type="text" id="api-url-input" value="${_esc(this.apiUrl)}" />
    </div>
    <div class="row">
      <button id="connect-btn">Connect</button>
      ${hasKnown ? `<button class="btn-ghost" id="forget-btn" title="Remove selected vault from list">Forget</button>` : ''}
    </div>
    <div class="status" id="status"></div>
  </div>
</div>`;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  _bindEvents() {
    const sr = this.shadowRoot;

    sr.getElementById('connect-btn')?.addEventListener('click', () => this._connect());
    sr.getElementById('disconnect-btn')?.addEventListener('click', () => this._disconnect());

    sr.getElementById('vault-key')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._connect();
    });

    const knownSel = sr.getElementById('known-select');
    if (knownSel) {
      knownSel.addEventListener('change', () => {
        const opt = knownSel.selectedOptions[0];
        if (opt?.value) {
          // Pre-fill all fields from stored registry data
          sr.getElementById('api-url-input').value = opt.dataset.api || this.apiUrl;
          sr.getElementById('display-name').value  = opt.dataset.name || '';

          const storedKey = opt.dataset.key || '';
          if (storedKey) {
            sr.getElementById('vault-key').value = storedKey;
            sr.getElementById('remember-key').checked = true;
          } else {
            sr.getElementById('vault-key').value = '';
            sr.getElementById('vault-key').focus();
          }

          const storedToken = opt.dataset.token || '';
          sr.getElementById('access-token').value = storedToken;
        } else {
          // "— new vault —" selected: clear fields
          sr.getElementById('vault-key').value    = '';
          sr.getElementById('access-token').value = '';
          sr.getElementById('display-name').value = '';
          sr.getElementById('api-url-input').value = this.apiUrl;
          sr.getElementById('remember-key').checked = false;
        }
      });
    }

    sr.getElementById('forget-btn')?.addEventListener('click', () => {
      const sel = sr.getElementById('known-select');
      const vaultId = sel?.value;
      if (vaultId) {
        _removeFromRegistry(vaultId);
        this._render();
        this._bindEvents();
      }
    });
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  async _connect() {
    if (this._connecting) return;
    const sr = this.shadowRoot;

    const rawKey      = sr.getElementById('vault-key')?.value?.trim() || '';
    const apiBaseUrl  = (sr.getElementById('api-url-input')?.value?.trim() || this.apiUrl).replace(/\/$/, '');
    const rememberKey = sr.getElementById('remember-key')?.checked ?? false;
    const accessToken = sr.getElementById('access-token')?.value?.trim() || '';
    let   displayName = sr.getElementById('display-name')?.value?.trim() || '';

    if (!rawKey) {
      this._setStatus('Vault key is required.', 'err');
      sr.getElementById('vault-key')?.focus();
      return;
    }

    this._connecting = true;
    const btn = sr.getElementById('connect-btn');
    if (btn) btn.disabled = true;
    this._setStatus('Deriving keys…', '');

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

      if (!displayName) {
        const knownSel = sr.getElementById('known-select');
        const opt = knownSel?.selectedOptions[0];
        displayName = (opt?.dataset.name && opt.value === keys.vaultId)
          ? opt.dataset.name
          : `Vault ${keys.vaultId.slice(0, 8)}`;
      }

      const vault = { keys, apiBaseUrl, vaultId: keys.vaultId, accessToken: accessToken || undefined };

      this._setStatus('Verifying vault…', '');
      let isNew = false;
      try {
        await readFile(vault, keys.refFileId);
      } catch (e) {
        if (String(e.message).includes('404') || String(e.message).includes('not found')) {
          isNew = true;
        } else {
          throw e;
        }
      }

      this._vault       = vault;
      this._displayName = displayName;

      // Persist to registry — store key only if user opted in
      _upsertRegistry(keys.vaultId, displayName, apiBaseUrl, {
        vaultKey:    rememberKey ? rawKey : undefined,
        accessToken: accessToken || undefined,
      });

      this._setStatus(isNew ? 'Ready — vault created on first save' : 'Connected', 'ok');
      this._showConnected(displayName, keys.vaultId);

      this._emit('vault:connected', {
        vault,
        vaultId:     keys.vaultId,
        displayName,
        apiBaseUrl,
        keys,
        accessToken: accessToken || undefined,
        isNew,
      });

    } catch (err) {
      this._setStatus(`Error: ${err.message}`, 'err');
    } finally {
      this._connecting = false;
      const b = this.shadowRoot.getElementById('connect-btn');
      if (b) b.disabled = false;
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  _disconnect() {
    const vaultId = this._vault?.vaultId;
    this._vault       = null;
    this._displayName = '';
    this._render();
    this._bindEvents();
    if (vaultId) {
      this._emit('vault:disconnected', { vaultId });
    }
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  /**
   * @param {string} msg
   * @param {string} cls — '' | 'ok' | 'err'
   */
  _setStatus(msg, cls) {
    const el = this.shadowRoot.getElementById('status');
    if (!el) return;
    el.textContent = msg;
    el.className   = `status ${cls}`.trim();
  }

  /**
   * @param {string} displayName
   * @param {string} vaultId
   */
  _showConnected(displayName, vaultId) {
    const form = this.shadowRoot.getElementById('connect-form');
    const bar  = this.shadowRoot.getElementById('connected-bar');
    const lbl  = this.shadowRoot.getElementById('connected-label');
    if (form) form.classList.add('hidden');
    if (bar)  bar.classList.remove('hidden');
    if (lbl)  lbl.textContent = `${displayName} (${vaultId.slice(0, 8)}\u2026) ✓`;
  }

  // ── Event bus ─────────────────────────────────────────────────────────────

  /**
   * @param {string} name
   * @param {object} detail
   */
  _emit(name, detail) {
    let el = this.parentElement || this.parentNode?.host;
    while (el) {
      if (el.hasAttribute?.('data-vault-bus')) {
        el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
        return;
      }
      el = el.parentElement || el.parentNode?.host;
    }
    document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }
}

function _esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

customElements.define('sg-vault-manager', SgVaultManager);
