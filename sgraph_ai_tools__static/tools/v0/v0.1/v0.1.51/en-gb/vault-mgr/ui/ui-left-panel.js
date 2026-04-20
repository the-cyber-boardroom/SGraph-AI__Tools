/**
 * Vault Manager — left panel: Auth + Drive Store + Vault List.
 * @module ui-left-panel
 * @version 0.1.51
 */

import { getUser, isSignedIn } from '/core/auth-context/v0/v0.1/v0.1.0/sg-auth-context.js';
import { generateVaultKey } from '../api/vault-store.js';
import { removeToken } from '/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';

const CLIENT_ID_KEY = 'sg-auth-google-client-id';

const _CSS = `
* { box-sizing: border-box; }
.panel { height: 100%; overflow-y: auto; background: #080812; font-family: system-ui, sans-serif; }

.section { border-bottom: 1px solid #0d0d1a; }
.section-hdr { display: flex; align-items: center; gap: 6px; padding: 10px 14px 6px; }
.section-label { font-size: 10px; font-weight: 700; color: #4a5568; text-transform: uppercase; letter-spacing: .06em; flex: 1; }
.section-body { padding: 0 14px 12px; }

/* Auth */
.user-row { display: flex; align-items: center; gap: 10px; }
.avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid #4ecdc4; flex-shrink: 0; }
.avatar-ph { width: 36px; height: 36px; border-radius: 50%; background: #1a1a3a; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
.user-info { flex: 1; min-width: 0; }
.user-name { font-size: 13px; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-email { font-size: 11px; color: #718096; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge { font-size: 9px; padding: 1px 5px; border-radius: 8px; background: rgba(78,205,196,.15); color: #4ecdc4; font-weight: 700; text-transform: uppercase; }

/* Drive */
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
.dot-on { background: #4ecdc4; box-shadow: 0 0 5px #4ecdc4; }
.dot-off { background: #2d3748; }
.drive-status { font-size: 12px; color: #a0aec0; }
.drive-note { font-size: 10px; color: #4a5568; margin-top: 4px; line-height: 1.5; }

/* Vault list */
.vault-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 5px; cursor: pointer; margin-bottom: 2px; border: 1px solid transparent; }
.vault-item:hover { background: #111122; }
.vault-item.active { background: rgba(78,205,196,.07); border-color: rgba(78,205,196,.2); }
.vault-icon { font-size: 16px; flex-shrink: 0; }
.vault-info { flex: 1; min-width: 0; }
.vault-name { font-size: 12px; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vault-url { font-size: 10px; color: #4a5568; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vault-new-badge { font-size: 9px; color: #4ecdc4; font-weight: 700; }
.empty-vaults { font-size: 11px; color: #2d3748; padding: 8px 0; }

/* New vault form */
.new-form { margin-top: 10px; border: 1px solid #1a1a3a; border-radius: 5px; padding: 10px; background: #0a0a18; }
.new-form-title { font-size: 11px; font-weight: 600; color: #a0aec0; margin-bottom: 8px; }
.field { margin-bottom: 8px; }
.field label { display: block; font-size: 10px; color: #4a5568; margin-bottom: 3px; }
input[type=text] { width: 100%; background: #111122; border: 1px solid #1a1a3a; border-radius: 4px; padding: 5px 8px; color: #e2e8f0; font-size: 11px; font-family: inherit; }
input[type=text]:focus { outline: none; border-color: #4ecdc4; }
.key-row { display: flex; gap: 4px; }
.key-row input { flex: 1; font-family: "SF Mono", Monaco, monospace; font-size: 10px; }
.form-btns { display: flex; gap: 6px; margin-top: 6px; }

/* Buttons */
.btn { font-size: 11px; padding: 5px 10px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #718096; cursor: pointer; font-family: inherit; }
.btn:hover { border-color: #4ecdc4; color: #4ecdc4; }
.btn-primary { border-color: #4ecdc4; color: #4ecdc4; background: rgba(78,205,196,.06); }
.btn-primary:hover { background: rgba(78,205,196,.12); }
.btn-sm { font-size: 10px; padding: 3px 8px; }
`;

export function buildLeftPanel(el, state, cb) {
    el.innerHTML = `<style>${_CSS}</style><div class="panel" id="left-panel"></div>`;
    const panel = el.querySelector('#left-panel');

    panel.appendChild(_authSection(state));
    if (isSignedIn()) panel.appendChild(_driveSection(state));
    if (state.store)  panel.appendChild(_vaultListSection(state));

    _bindEvents(el, state, cb);
}

// ── Sections ──────────────────────────────────────────────────────────────────

function _authSection(state) {
    const div = document.createElement('div');
    div.className = 'section';

    if (isSignedIn()) {
        const user = getUser();
        div.innerHTML = `
            <div class="section-hdr">
                <span class="section-label">Signed in</span>
                <button class="btn btn-sm" id="signout-btn">Sign out</button>
            </div>
            <div class="section-body">
                <div class="user-row">
                    ${user?.picture
                        ? `<img class="avatar" src="${user.picture}" referrerpolicy="no-referrer" alt="">`
                        : `<div class="avatar-ph">👤</div>`}
                    <div class="user-info">
                        <div class="user-name">${user?.name || 'Google user'}</div>
                        <div class="user-email">${user?.email || ''}</div>
                    </div>
                    <span class="badge">${user?.provider || 'google'}</span>
                </div>
            </div>`;
    } else {
        const clientId = localStorage.getItem(CLIENT_ID_KEY) || '';
        div.innerHTML = `
            <div class="section-hdr"><span class="section-label">Sign in</span></div>
            <div class="section-body">
                <sg-auth-google id="auth-google-comp" style="display:block;"></sg-auth-google>
            </div>`;
        requestAnimationFrame(() => {
            const comp = div.querySelector('#auth-google-comp');
            if (comp && clientId) comp.initialize(clientId);
        });
    }
    return div;
}

function _driveSection(state) {
    const div = document.createElement('div');
    div.className = 'section';

    if (state.drive) {
        const count = state.vaults.length;
        div.innerHTML = `
            <div class="section-hdr"><span class="section-label">Drive Store</span></div>
            <div class="section-body">
                <div class="drive-status">
                    <span class="dot dot-on"></span>
                    <strong style="color:#4ecdc4;">Connected</strong>
                    · vaults.json · ${count} vault${count !== 1 ? 's' : ''}
                </div>
                <div class="drive-note">Registry stored in your Google Drive App Data — private, per-app, cross-device.</div>
            </div>`;
    } else {
        div.innerHTML = `
            <div class="section-hdr"><span class="section-label">Drive Store</span></div>
            <div class="section-body">
                <div class="drive-status"><span class="dot dot-off"></span>Not connected</div>
                <div class="drive-note">Connect Drive to load and sync your vault registry.</div>
                <button class="btn btn-primary" id="drive-connect-btn" style="margin-top:8px;width:100%;">☁ Connect Drive</button>
            </div>`;
    }
    return div;
}

function _vaultListSection(state) {
    const div = document.createElement('div');
    div.className = 'section';

    const vaultItems = state.vaults.length === 0
        ? `<div class="empty-vaults">No vaults yet — create your first below</div>`
        : state.vaults.map(v => `
            <div class="vault-item ${v.vaultId === state.selectedId ? 'active' : ''}" data-vault-id="${v.vaultId}">
                <span class="vault-icon">🏛</span>
                <div class="vault-info">
                    <div class="vault-name">${v.displayName}</div>
                    <div class="vault-url">${v.apiBaseUrl}</div>
                </div>
                ${v.vaultId === state.selectedId ? '<span class="vault-new-badge">▶</span>' : ''}
            </div>`).join('');

    div.innerHTML = `
        <div class="section-hdr">
            <span class="section-label">My Vaults</span>
            <button class="btn btn-sm" id="new-vault-toggle">+ New</button>
        </div>
        <div class="section-body">
            <div id="vault-list">${vaultItems}</div>
            <div id="new-vault-form" style="display:none;">
                <div class="new-form">
                    <div class="new-form-title">New Vault</div>
                    <div class="field">
                        <label>Display name</label>
                        <input type="text" id="nv-name" placeholder="e.g. Personal Vault">
                    </div>
                    <div class="field">
                        <label>Vault server URL</label>
                        <input type="text" id="nv-url" placeholder="https://vault.sgraph.ai" value="https://vault.sgraph.ai">
                    </div>
                    <div class="field">
                        <label>Master key</label>
                        <div class="key-row">
                            <input type="text" id="nv-key" placeholder="Auto-generated" readonly>
                            <button class="btn btn-sm" id="nv-gen-key">↺ New</button>
                        </div>
                    </div>
                    <div class="form-btns">
                        <button class="btn btn-primary" id="nv-create">Create Vault</button>
                        <button class="btn" id="nv-cancel">Cancel</button>
                    </div>
                </div>
            </div>
        </div>`;

    // Generate a key immediately for the form
    requestAnimationFrame(() => {
        const keyInput = div.querySelector('#nv-key');
        if (keyInput && !keyInput.value) keyInput.value = generateVaultKey();
    });

    return div;
}

// ── Event binding ─────────────────────────────────────────────────────────────

function _bindEvents(el, state, cb) {
    // Sign out
    el.querySelector('#signout-btn')?.addEventListener('click', () => {
        removeToken('google');
        if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
        window.dispatchEvent(new CustomEvent('sg-auth:signed-out', { detail: { provider: 'google' } }));
    });

    // Drive connect
    el.querySelector('#drive-connect-btn')?.addEventListener('click', () => cb.connectDrive());

    // Vault selection
    el.querySelectorAll('[data-vault-id]').forEach(item => {
        item.addEventListener('click', () => cb.selectVault(item.dataset.vaultId));
    });

    // New vault form toggle
    el.querySelector('#new-vault-toggle')?.addEventListener('click', () => {
        const form = el.querySelector('#new-vault-form');
        if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    // Generate new key
    el.querySelector('#nv-gen-key')?.addEventListener('click', () => {
        const input = el.querySelector('#nv-key');
        if (input) input.value = generateVaultKey();
    });

    // Cancel new vault
    el.querySelector('#nv-cancel')?.addEventListener('click', () => {
        const form = el.querySelector('#new-vault-form');
        if (form) form.style.display = 'none';
    });

    // Create vault
    el.querySelector('#nv-create')?.addEventListener('click', async () => {
        const name = el.querySelector('#nv-name')?.value.trim();
        const url  = el.querySelector('#nv-url')?.value.trim();
        const key  = el.querySelector('#nv-key')?.value.trim();
        if (!name || !url) return;
        await cb.createVault({ displayName: name, apiBaseUrl: url, vaultKey: key });
    });
}
