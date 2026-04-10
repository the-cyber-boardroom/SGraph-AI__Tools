/**
 * OpenRouter connection — shared state, inline custom elements, vault wiring.
 *
 * Exports:
 *   state          — live connection state object (mutated in place)
 *   wireVault()    — bind vault bar UI
 *   registerConnectElements() — define sg-or-user-connect + sg-or-admin-connect
 *
 * The sg-or-user-connect element fires SGL_LLM.CONNECTED on the [data-llm-bus]
 * ancestor — picked up by all sg-openrouter-* panel components.
 * Admin components listen on document for 'or:admin-connected'.
 *
 * @module openrouter/connect
 * @version 0.1.23
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';
import {
    parseVaultKey,
    deriveVaultKeys,
    openVault,
    deriveFileIdForPath,
    readFile,
} from '/core/vault-client/v1/v1.0/v1.0.0/sg-vault-client.js';

// ── Shared connection state ───────────────────────────────────────────────────

/**
 * Live connection state. Read and mutated by both connect.js and openrouter.js.
 * @type {{ userApiKey: string, managementKey: string, userConnected: boolean,
 *          adminConnected: boolean, balance: number|null, limit: number|null,
 *          currency: string }}
 */
export const state = {
    userApiKey:     '',
    managementKey:  '',
    userConnected:  false,
    adminConnected: false,
    balance:        null,
    limit:          null,
    currency:       'USD',
};

// ── CSS shared by both connect Web Components ─────────────────────────────────

const CONNECT_CSS = `
:host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-family: monospace;
    font-size: 12px;
    background: #0d0d1a;
    color: #c8d0e0;
    overflow-y: auto;
}
:host::-webkit-scrollbar { width: 6px; }
:host::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

.cp { padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }

.cp-title { font-size: 10px; letter-spacing: 0.06em; color: #374151;
    text-transform: uppercase; border-bottom: 1px solid #1e2035; padding-bottom: 8px; }

.cp-status { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.cp-dot { font-size: 10px; }
.cp-dot.on  { color: #4ade80; }
.cp-dot.off { color: #374151; }
.cp-label { color: #64748b; }

.cp-field { display: flex; flex-direction: column; gap: 4px; }
.cp-field-label { font-size: 10px; color: #374151; letter-spacing: 0.03em; }
.cp-input {
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    color: #c8d0e0;
    font-family: monospace;
    font-size: 11px;
    padding: 5px 10px;
}
.cp-input:focus { outline: none; border-color: #3b82f6; }
.cp-input::placeholder { color: #1e2035; }
.cp-input.ok  { border-color: #166534; }
.cp-input.err { border-color: #7f1d1d; }

.cp-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.cp-btn {
    background: #12122a; border: 1px solid #1e2035; border-radius: 4px;
    color: #64748b; cursor: pointer; font-family: monospace; font-size: 11px;
    padding: 5px 12px; white-space: nowrap;
}
.cp-btn:hover { border-color: #3b82f6; color: #60a5fa; }
.cp-btn.primary { background: #1e3a6e; border-color: #3b82f6; color: #93c5fd; }
.cp-btn.primary:hover { background: #2a4d8e; }
.cp-btn.danger  { border-color: #7f1d1d; color: #f87171; }
.cp-btn.danger:hover  { background: #3d0a0a; }

.cp-divider { border: none; border-top: 1px solid #1e2035; }

.cp-info { display: flex; flex-direction: column; gap: 6px; }
.cp-info-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.cp-info-key { font-size: 10px; color: #374151; white-space: nowrap; }
.cp-info-val { font-size: 11px; color: #64748b; word-break: break-all; text-align: right; }
.cp-info-val.ok  { color: #4ade80; }
.cp-info-val.err { color: #f87171; }

.cp-path {
    background: #12122a; border: 1px solid #1e2035; border-radius: 4px;
    padding: 6px 10px; color: #60a5fa; font-size: 11px;
}
.cp-path-label { font-size: 10px; color: #374151; margin-bottom: 3px; }
.cp-example { color: #c8d0e0; }
`;

// ── sg-or-user-connect ────────────────────────────────────────────────────────

class SgOrUserConnect extends HTMLElement {
    constructor() {
        super();
        this._shadow = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._render();
        this._onVaultLoaded = e => {
            const { apiKey, userFileId, userStatus } = e.detail;
            this._setFileId(userFileId);
            if (apiKey) {
                this._shadow.querySelector('.cp-input').value = apiKey;
                this._shadow.querySelector('.cp-input').classList.add('ok');
                this._setVaultStatus('loaded from vault', 'ok');
                this._connect(apiKey);
            } else {
                this._setVaultStatus(userStatus || 'not found in vault', 'err');
            }
        };
        document.addEventListener('or:vault-loaded', this._onVaultLoaded);
    }

    disconnectedCallback() {
        document.removeEventListener('or:vault-loaded', this._onVaultLoaded);
    }

    /**
     * Programmatic connect — called by SgToolApi.connect().
     * @param {string} apiKey
     */
    connect(apiKey) { this._connect(apiKey); }

    /**
     * Programmatic disconnect — called by SgToolApi.disconnect().
     */
    disconnect() { this._disconnect(); }

    _render() {
        this._shadow.innerHTML = `<style>${CONNECT_CSS}</style>
<div class="cp">
    <div class="cp-title">User Connection</div>
    <div class="cp-status">
        <span class="cp-dot off" id="dot">\u2b24</span>
        <span class="cp-label" id="lbl">disconnected</span>
    </div>
    <div class="cp-field">
        <span class="cp-field-label">API KEY</span>
        <input class="cp-input" type="password"
            placeholder="sk-or-v1-\u2026 or load from vault" autocomplete="off" spellcheck="false">
    </div>
    <div class="cp-row">
        <button class="cp-btn primary" id="conn-btn">Connect</button>
        <button class="cp-btn danger"  id="disc-btn">Disconnect</button>
    </div>
    <hr class="cp-divider">
    <div class="cp-path-label">VAULT PATH</div>
    <div class="cp-path">openrouter/user/config.json</div>
    <div class="cp-path-label" style="margin-top:8px">EXPECTED FORMAT</div>
    <div class="cp-path cp-example">{ "apiKey": "sk-or-v1-\u2026" }</div>
    <div class="cp-info">
        <div class="cp-info-row">
            <span class="cp-info-key">vault file id</span>
            <span class="cp-info-val" id="file-id">\u2014</span>
        </div>
        <div class="cp-info-row">
            <span class="cp-info-key">vault status</span>
            <span class="cp-info-val" id="vault-st">waiting</span>
        </div>
    </div>
</div>`;

        const input  = this._shadow.querySelector('.cp-input');
        const cached = localStorage.getItem('or-user-api-key');
        if (cached) { input.value = cached; }

        this._shadow.querySelector('#conn-btn').addEventListener('click', () => {
            this._connect(input.value.trim());
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') this._connect(input.value.trim());
        });
        this._shadow.querySelector('#disc-btn').addEventListener('click', () => {
            this._disconnect();
        });
    }

    _connect(apiKey) {
        if (!apiKey) { this._setStatus('API key required', 'err'); return; }
        state.userApiKey    = apiKey;
        state.userConnected = true;
        localStorage.setItem('or-user-api-key', apiKey);
        this._shadow.querySelector('#dot').className = 'cp-dot on';
        this._shadow.querySelector('#lbl').textContent = 'connected';
        const input = this._shadow.querySelector('.cp-input');
        if (input) { input.value = apiKey; input.classList.add('ok'); input.classList.remove('err'); }
        const bus = this._bus();
        bus.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
            bubbles: true,
            detail:  { provider: 'openrouter', apiKey },
        }));
    }

    _disconnect() {
        if (!state.userConnected) return;
        state.userApiKey    = '';
        state.userConnected = false;
        this._shadow.querySelector('#dot').className = 'cp-dot off';
        this._shadow.querySelector('#lbl').textContent = 'disconnected';
        const input = this._shadow.querySelector('.cp-input');
        if (input) { input.classList.remove('ok', 'err'); }
        this._bus().dispatchEvent(new CustomEvent(SGL_LLM.DISCONNECTED, { bubbles: true }));
        document.dispatchEvent(new CustomEvent('tool:disconnected'));
    }

    _setFileId(id) {
        const el = this._shadow.querySelector('#file-id');
        if (el) el.textContent = id || '\u2014';
    }

    _setVaultStatus(msg, type) {
        const el = this._shadow.querySelector('#vault-st');
        if (!el) return;
        el.textContent = msg;
        el.className   = `cp-info-val ${type}`;
    }

    _setStatus(msg, type) { this._setVaultStatus(msg, type); }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return document;
    }
}

// ── sg-or-admin-connect ───────────────────────────────────────────────────────

class SgOrAdminConnect extends HTMLElement {
    constructor() {
        super();
        this._shadow = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._render();
        this._onVaultLoaded = e => {
            const { managementKey, adminFileId, adminStatus } = e.detail;
            this._setFileId(adminFileId);
            if (managementKey) {
                this._shadow.querySelector('.cp-input').value = managementKey;
                this._shadow.querySelector('.cp-input').classList.add('ok');
                this._setVaultStatus('loaded from vault', 'ok');
                this._connect(managementKey);
            } else {
                this._setVaultStatus(adminStatus || 'not found in vault', 'err');
            }
        };
        document.addEventListener('or:vault-loaded', this._onVaultLoaded);
    }

    disconnectedCallback() {
        document.removeEventListener('or:vault-loaded', this._onVaultLoaded);
    }

    _render() {
        this._shadow.innerHTML = `<style>${CONNECT_CSS}</style>
<div class="cp">
    <div class="cp-title">Admin Connection</div>
    <div class="cp-status">
        <span class="cp-dot off" id="dot">\u2b24</span>
        <span class="cp-label" id="lbl">disconnected</span>
    </div>
    <div class="cp-field">
        <span class="cp-field-label">MANAGEMENT KEY</span>
        <input class="cp-input" type="password"
            placeholder="sk-or-v1-mgmt-\u2026 or load from vault" autocomplete="off" spellcheck="false">
    </div>
    <div class="cp-row">
        <button class="cp-btn primary" id="conn-btn">Connect</button>
        <button class="cp-btn danger"  id="disc-btn">Disconnect</button>
    </div>
    <hr class="cp-divider">
    <div class="cp-path-label">VAULT PATH</div>
    <div class="cp-path">openrouter/admin/config.json</div>
    <div class="cp-path-label" style="margin-top:8px">EXPECTED FORMAT</div>
    <div class="cp-path cp-example">{ "managementKey": "sk-or-v1-mgmt-\u2026" }</div>
    <div class="cp-info">
        <div class="cp-info-row">
            <span class="cp-info-key">vault file id</span>
            <span class="cp-info-val" id="file-id">\u2014</span>
        </div>
        <div class="cp-info-row">
            <span class="cp-info-key">vault status</span>
            <span class="cp-info-val" id="vault-st">waiting</span>
        </div>
    </div>
</div>`;

        const input  = this._shadow.querySelector('.cp-input');
        const cached = localStorage.getItem('or-admin-mgmt-key');
        if (cached) { input.value = cached; }

        this._shadow.querySelector('#conn-btn').addEventListener('click', () => {
            this._connect(input.value.trim());
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') this._connect(input.value.trim());
        });
        this._shadow.querySelector('#disc-btn').addEventListener('click', () => {
            this._disconnect();
        });
    }

    _connect(mgmtKey) {
        if (!mgmtKey) { this._setVaultStatus('Management key required', 'err'); return; }
        state.managementKey  = mgmtKey;
        state.adminConnected = true;
        localStorage.setItem('or-admin-mgmt-key', mgmtKey);
        this._shadow.querySelector('#dot').className = 'cp-dot on';
        this._shadow.querySelector('#lbl').textContent = 'connected';
        const input = this._shadow.querySelector('.cp-input');
        if (input) { input.classList.add('ok'); input.classList.remove('err'); }
        // Dispatch on document — sg-layout shadow DOM blocks parentElement walk
        document.dispatchEvent(new CustomEvent('or:admin-connected', {
            detail: { managementKey: mgmtKey },
        }));
        // Drive key-manager component via shadow DOM ref
        customElements.whenDefined('sg-openrouter-key-manager').then(() => {
            const km  = document.querySelector('sg-openrouter-key-manager');
            const inp = km?.shadowRoot?.querySelector('.km-auth-input');
            const btn = km?.shadowRoot?.querySelector('#km-connect-btn');
            if (inp && btn) { inp.value = mgmtKey; btn.click(); }
        });
    }

    _disconnect() {
        if (!state.adminConnected) return;
        state.managementKey  = '';
        state.adminConnected = false;
        this._shadow.querySelector('#dot').className = 'cp-dot off';
        this._shadow.querySelector('#lbl').textContent = 'disconnected';
        document.dispatchEvent(new CustomEvent('or:admin-disconnected'));
    }

    _setFileId(id) {
        const el = this._shadow.querySelector('#file-id');
        if (el) el.textContent = id || '\u2014';
    }

    _setVaultStatus(msg, type) {
        const el = this._shadow.querySelector('#vault-st');
        if (!el) return;
        el.textContent = msg;
        el.className   = `cp-info-val ${type}`;
    }
}

// ── Register custom elements (idempotent) ─────────────────────────────────────

/**
 * Register the two connect Web Components. Safe to call multiple times.
 */
export function registerConnectElements() {
    if (!customElements.get('sg-or-user-connect'))  customElements.define('sg-or-user-connect',  SgOrUserConnect);
    if (!customElements.get('sg-or-admin-connect')) customElements.define('sg-or-admin-connect', SgOrAdminConnect);
}

// ── Vault bar wiring ──────────────────────────────────────────────────────────

/**
 * Wire vault bar UI — listens for button click, loads credentials, broadcasts
 * 'or:vault-loaded' on document.
 *
 * @param {{ vaultKeyInput: HTMLInputElement, vaultApiInput: HTMLInputElement,
 *           vaultLoadBtn: HTMLButtonElement,
 *           vaultUserPill: HTMLElement, vaultAdminPill: HTMLElement }} els
 */
export function wireVault({ vaultKeyInput, vaultApiInput, vaultLoadBtn, vaultUserPill, vaultAdminPill }) {
    function setPill(el, text, cls) {
        el.textContent = text;
        el.className   = `or-vault-pill ${cls}`;
    }

    async function loadFromVault() {
        const rawKey     = vaultKeyInput.value.trim();
        const apiBaseUrl = (vaultApiInput.value.trim()) || 'https://send.sgraph.ai';
        if (!rawKey) { vaultKeyInput.classList.add('err'); return; }
        vaultKeyInput.classList.remove('ok', 'err');
        vaultLoadBtn.disabled = true;
        setPill(vaultUserPill,  'user: \u2026',  'idle');
        setPill(vaultAdminPill, 'admin: \u2026', 'idle');

        let vault;
        try {
            const { passphrase, vaultId } = parseVaultKey(rawKey);
            const keys = await deriveVaultKeys(passphrase, vaultId);
            vault = await openVault(keys, { apiBaseUrl });
            vaultKeyInput.classList.add('ok');
        } catch (err) {
            vaultKeyInput.classList.add('err');
            setPill(vaultUserPill,  `user: ${_short(err)}`,  'err');
            setPill(vaultAdminPill, `admin: ${_short(err)}`, 'err');
            vaultLoadBtn.disabled = false;
            return;
        }

        const [userResult, adminResult] = await Promise.allSettled([
            _readPath(vault, 'openrouter/user/config.json'),
            _readPath(vault, 'openrouter/admin/config.json'),
        ]);

        const userOk  = userResult.status  === 'fulfilled';
        const adminOk = adminResult.status === 'fulfilled';
        const { config: userConfig,  fileId: userFileId  } = userOk  ? userResult.value  : {};
        const { config: adminConfig, fileId: adminFileId } = adminOk ? adminResult.value : {};

        setPill(vaultUserPill,  userOk  ? 'user: \u2713'  : `user: ${_short(userResult.reason)}`,   userOk  ? 'ok' : 'warn');
        setPill(vaultAdminPill, adminOk ? 'admin: \u2713' : `admin: ${_short(adminResult.reason)}`, adminOk ? 'ok' : 'warn');

        document.dispatchEvent(new CustomEvent('or:vault-loaded', {
            detail: {
                apiKey:        userConfig?.apiKey        ?? null,
                managementKey: adminConfig?.managementKey ?? null,
                userFileId,
                adminFileId,
                userStatus:    userOk  ? 'loaded \u2713' : _short(userResult.reason),
                adminStatus:   adminOk ? 'loaded \u2713' : _short(adminResult.reason),
            },
        }));

        vaultLoadBtn.disabled = false;
    }

    vaultLoadBtn.addEventListener('click', loadFromVault);
    vaultKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadFromVault(); });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _readPath(vault, path) {
    const fileId = await deriveFileIdForPath(vault, path);
    const raw    = await readFile(vault, fileId);
    const config = JSON.parse(new TextDecoder().decode(raw));
    return { config, fileId };
}

function _short(err) {
    const m = String(err?.message ?? err);
    if (m.includes('404') || m.toLowerCase().includes('not found')) return 'not in vault';
    if (m.includes('decrypt') || m.includes('401') || m.includes('403')) return 'wrong key';
    return m.slice(0, 20);
}
