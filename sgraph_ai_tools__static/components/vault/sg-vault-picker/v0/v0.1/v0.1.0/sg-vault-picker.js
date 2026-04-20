/**
 * sg-vault-picker — create and open vaults. Stage 1: localStorage backend.
 *
 * Provides a UX for vault creation (with key generation) and opening.
 * Stage 1 stores vault keys in localStorage as a stand-in for the
 * Credential Management API (Stage 2) and real SG/Send vault creation (Stage 3).
 *
 * Vault key format: {24-char hex}:{8-char hex}  (mirrors real SG/Send format)
 *
 * @module sg-vault-picker
 * @version 0.1.0
 * @see Phase 2 plan: team/explorer/dev/plans/v0.1.50__auth-mvp__phase2-vault-pki-integration.md
 */

const VAULTS_KEY = 'sg-vault-picker-vaults';

/** @typedef {{ name: string, vaultKey: string, vaultId: string, createdAt: number }} VaultEntry */

/** @returns {VaultEntry[]} */
function _readVaults() {
    try { return JSON.parse(localStorage.getItem(VAULTS_KEY)) || []; } catch { return []; }
}

function _writeVaults(vaults) {
    localStorage.setItem(VAULTS_KEY, JSON.stringify(vaults));
}

/** Generate a random hex string of a given byte length. */
function _randomHex(bytes) {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
                .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a mock vault key in the SG/Send format ({24hex}:{8hex}).
 * Stage 1 only — Stage 3 will call the real sg-vault-write module.
 * @returns {{ vaultKey: string, vaultId: string }}
 */
function _generateKey() {
    const vaultId  = _randomHex(4);   // 8-char hex (4 bytes)
    const keyPart  = _randomHex(12);  // 24-char hex (12 bytes)
    return { vaultKey: `${keyPart}:${vaultId}`, vaultId };
}

/**
 * Create a new vault and save to localStorage.
 * @param {string} [name='Vault 1']
 * @returns {Promise<VaultEntry>}
 */
async function createVault(name = '') {
    const vaults   = _readVaults();
    const label    = name.trim() || `Vault ${vaults.length + 1}`;
    const { vaultKey, vaultId } = _generateKey();
    const entry    = { name: label, vaultKey, vaultId, createdAt: Date.now() };

    vaults.unshift(entry);
    _writeVaults(vaults);

    window.dispatchEvent(new CustomEvent('vault:created', { detail: entry }));
    window.dispatchEvent(new CustomEvent('vault:opened',  { detail: { ...entry, source: 'created' } }));
    return entry;
}

/**
 * Open an existing vault by name from localStorage.
 * @param {string} name
 * @returns {VaultEntry|null}
 */
function openVaultByName(name) {
    const vault = _readVaults().find(v => v.name === name);
    if (!vault) return null;
    window.dispatchEvent(new CustomEvent('vault:opened', { detail: { ...vault, source: 'opened' } }));
    return vault;
}

/**
 * Save a vault credential to localStorage (Stage 1).
 * Stage 2: will call navigator.credentials.store()
 * @param {string} name
 * @param {string} vaultKey
 * @returns {Promise<VaultEntry>}
 */
async function saveVault(name, vaultKey) {
    const [, vaultId] = vaultKey.split(':');
    const entry = { name, vaultKey, vaultId: vaultId || '', createdAt: Date.now() };
    const vaults = _readVaults().filter(v => v.name !== name);
    vaults.unshift(entry);
    _writeVaults(vaults);
    window.dispatchEvent(new CustomEvent('vault:saved', { detail: entry }));
    return entry;
}

/** @returns {VaultEntry[]} */
function listVaults() { return _readVaults(); }

/**
 * Remove a vault from localStorage by name.
 * @param {string} name
 */
function removeVault(name) {
    _writeVaults(_readVaults().filter(v => v.name !== name));
    window.dispatchEvent(new CustomEvent('vault:removed', { detail: { name } }));
}

const _CSS = `
:host { display: block; font-family: system-ui, sans-serif; }
.picker { background: #0d0d1a; border: 1px solid #1a1a3a; border-radius: 6px; overflow: hidden; }

/* header */
.ph { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #1a1a3a; }
.ph-title { font-size: 13px; font-weight: 600; color: #a0aec0; }
.stage-badge { font-size: 9px; padding: 1px 6px; border-radius: 8px; background: rgba(237,137,54,.15); color: #ed8936; font-weight: 700; text-transform: uppercase; }

/* vault list */
.vlist { }
.ventry { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #111122; cursor: pointer; transition: background 80ms; }
.ventry:last-child { border-bottom: none; }
.ventry:hover { background: #111122; }
.v-icon { font-size: 16px; flex-shrink: 0; }
.v-info { flex: 1; min-width: 0; }
.v-name { font-size: 12px; font-weight: 600; color: #e2e8f0; }
.v-key  { font-size: 10px; color: #4a5568; font-family: 'SF Mono', Monaco, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.v-age  { font-size: 10px; color: #2d3748; flex-shrink: 0; }
.open-btn { font-size: 10px; padding: 2px 7px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #718096; cursor: pointer; font-family: inherit; flex-shrink: 0; }
.open-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }
.del-btn { font-size: 10px; padding: 2px 6px; border-radius: 4px; border: 1px solid transparent; background: none; color: #2d3748; cursor: pointer; font-family: inherit; flex-shrink: 0; }
.del-btn:hover { border-color: #fc8181; color: #fc8181; }

/* empty */
.empty { padding: 20px 12px; text-align: center; font-size: 12px; color: #2d3748; }

/* create form */
.create-section { padding: 10px 12px; border-top: 1px solid #1a1a3a; }
.create-row { display: flex; gap: 6px; }
input { background: #111122; border: 1px solid #1a1a3a; border-radius: 4px; padding: 6px 8px; color: #e2e8f0; font-size: 12px; font-family: inherit; flex: 1; }
input:focus { outline: none; border-color: #4ecdc4; }
.create-btn { font-size: 11px; padding: 6px 12px; border-radius: 4px; border: 1px solid #4ecdc4; background: none; color: #4ecdc4; cursor: pointer; font-family: inherit; white-space: nowrap; }
.create-btn:hover { background: rgba(78,205,196,.08); }

/* import form */
.import-section { padding: 6px 12px 10px; }
.import-row { display: flex; gap: 6px; }
.import-btn { font-size: 11px; padding: 6px 12px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #718096; cursor: pointer; font-family: inherit; white-space: nowrap; }
.import-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }

/* active vault */
.active-vault { padding: 10px 12px; background: rgba(78,205,196,.05); border-bottom: 1px solid #1a1a3a; }
.active-label { font-size: 10px; color: #4ecdc4; text-transform: uppercase; font-weight: 700; letter-spacing: .06em; margin-bottom: 4px; }
.active-name { font-size: 13px; font-weight: 600; color: #e2e8f0; }
.active-key  { font-size: 10px; color: #4a5568; font-family: 'SF Mono', Monaco, monospace; margin-top: 2px; }
.close-btn   { font-size: 10px; padding: 2px 8px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #718096; cursor: pointer; font-family: inherit; float: right; margin-top: -16px; }
.close-btn:hover { border-color: #fc8181; color: #fc8181; }

.note { padding: 6px 12px; font-size: 10px; color: #2d3748; border-top: 1px solid #0d0d1a; }
.msg  { font-size: 11px; margin-top: 6px; padding: 4px 8px; border-radius: 4px; display: none; }
.msg-ok  { background: rgba(78,205,196,.1); color: #4ecdc4; display: block; }
.msg-err { background: rgba(252,129,129,.1); color: #fc8181; display: block; }
`;

function _relTime(ms) {
    const d = Date.now() - ms;
    if (d < 60000)    return 'just now';
    if (d < 3600000)  return `${Math.round(d/60000)}m ago`;
    if (d < 86400000) return `${Math.round(d/3600000)}h ago`;
    return new Date(ms).toLocaleDateString();
}

function _maskKey(k) {
    if (!k || k.length < 8) return k;
    return k.slice(0, 6) + '···' + k.slice(-5);
}

/**
 * SgVaultPicker — create, open, and manage vaults (Stage 1: localStorage).
 *
 * @example
 * <sg-vault-picker></sg-vault-picker>
 *
 * Events (window):
 *   vault:opened  { vaultKey, vaultId, name, source }
 *   vault:created { vaultKey, vaultId, name }
 *   vault:saved   { vaultKey, vaultId, name }
 *   vault:removed { name }
 *   vault:cancelled {}
 */
export class SgVaultPicker extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._activeVault = null;
        this._onVaultEvent = () => this._render();
    }

    connectedCallback() {
        this._render();
        ['vault:opened','vault:created','vault:saved','vault:removed'].forEach(
            e => window.addEventListener(e, this._onVaultEvent)
        );
    }

    disconnectedCallback() {
        ['vault:opened','vault:created','vault:saved','vault:removed'].forEach(
            e => window.removeEventListener(e, this._onVaultEvent)
        );
    }

    async createVault(name)         { return createVault(name); }
    openVaultByName(name)           { return openVaultByName(name); }
    async saveVault(name, vaultKey) { return saveVault(name, vaultKey); }
    listVaults()                    { return listVaults(); }
    removeVault(name)               { removeVault(name); }

    _setActive(entry) {
        this._activeVault = entry;
        this._render();
    }

    _clearActive() {
        this._activeVault = null;
        window.dispatchEvent(new CustomEvent('vault:cancelled'));
        this._render();
    }

    _msg(text, ok) {
        const el = this.shadowRoot.querySelector('.msg');
        if (!el) return;
        el.textContent = text;
        el.className = `msg ${ok ? 'msg-ok' : 'msg-err'}`;
        setTimeout(() => { el.className = 'msg'; el.textContent = ''; }, 4000);
    }

    _render() {
        const vaults = listVaults();
        const sr = this.shadowRoot;
        sr.innerHTML = `<style>${_CSS}</style><div class="picker"></div>`;
        const picker = sr.querySelector('.picker');

        // Active vault banner
        if (this._activeVault) {
            const av = this._activeVault;
            picker.innerHTML += `
                <div class="active-vault">
                    <button class="close-btn" id="close-active">Close</button>
                    <div class="active-label">🔓 Open vault</div>
                    <div class="active-name">${av.name}</div>
                    <div class="active-key">${_maskKey(av.vaultKey)}</div>
                </div>
            `;
        }

        // Header
        picker.innerHTML += `
            <div class="ph">
                <span class="ph-title">🗄 Vaults</span>
                <span class="stage-badge">Stage 1 · localStorage</span>
            </div>
        `;

        // Vault list
        if (vaults.length === 0) {
            picker.innerHTML += `<div class="empty">No vaults yet<br>Create one below</div>`;
        } else {
            picker.innerHTML += `<div class="vlist">` + vaults.map(v => `
                <div class="ventry" data-name="${v.name}">
                    <span class="v-icon">🔐</span>
                    <div class="v-info">
                        <div class="v-name">${v.name}</div>
                        <div class="v-key">${_maskKey(v.vaultKey)}</div>
                    </div>
                    <span class="v-age">${_relTime(v.createdAt)}</span>
                    <button class="open-btn" data-name="${v.name}">Open</button>
                    <button class="del-btn"  data-name="${v.name}">✕</button>
                </div>
            `).join('') + `</div>`;
        }

        // Create section
        picker.innerHTML += `
            <div class="create-section">
                <div class="create-row">
                    <input id="vault-name" type="text" placeholder="Vault name (e.g. My personal vault)">
                    <button class="create-btn" id="create-btn">+ Create</button>
                </div>
                <div class="msg"></div>
            </div>
            <div class="import-section">
                <div class="import-row">
                    <input id="import-key" type="password" placeholder="Paste vault key to import…" autocomplete="off">
                    <input id="import-name" type="text" placeholder="Name" autocomplete="off" style="max-width:100px">
                    <button class="import-btn" id="import-btn">Import</button>
                </div>
            </div>
            <div class="note">Stage 1: keys stored in localStorage. Stage 2 will use the browser's password manager (sync across devices).</div>
        `;

        // Bind events
        sr.querySelector('#close-active')?.addEventListener('click', () => this._clearActive());

        sr.querySelector('#create-btn').addEventListener('click', async () => {
            const nameEl = sr.querySelector('#vault-name');
            const vault  = await createVault(nameEl.value.trim());
            this._setActive(vault);
            nameEl.value = '';
            this._msg(`Created vault "${vault.name}"`, true);
        });

        sr.querySelector('#import-btn').addEventListener('click', async () => {
            const key  = sr.querySelector('#import-key').value.trim();
            const name = sr.querySelector('#import-name').value.trim() || 'Imported vault';
            if (!key) { this._msg('Paste a vault key first', false); return; }
            const vault = await saveVault(name, key);
            this._setActive(vault);
            sr.querySelector('#import-key').value  = '';
            sr.querySelector('#import-name').value = '';
            this._msg(`Imported vault "${name}"`, true);
        });

        sr.querySelectorAll('.open-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const vault = listVaults().find(v => v.name === btn.dataset.name);
                if (vault) this._setActive(vault);
            });
        });

        sr.querySelectorAll('.del-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Remove vault "${btn.dataset.name}" from list?`)) {
                    removeVault(btn.dataset.name);
                    if (this._activeVault?.name === btn.dataset.name) this._activeVault = null;
                    this._render();
                }
            });
        });
    }
}

customElements.define('sg-vault-picker', SgVaultPicker);

export { createVault, openVaultByName, saveVault, listVaults, removeVault };
