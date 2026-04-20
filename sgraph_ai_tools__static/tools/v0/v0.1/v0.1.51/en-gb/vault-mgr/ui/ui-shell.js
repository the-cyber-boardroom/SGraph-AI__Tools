/**
 * Vault Manager — layout bootstrap and state management.
 * @module ui-shell
 * @version 0.1.51
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { onAuthChange, isSignedIn, getUser } from '/core/auth-context/v0/v0.1/v0.1.0/sg-auth-context.js';
import { requestAccess, DriveAppData } from '/core/drive-appdata/v0/v0.1/v0.1.0/sg-drive-appdata.js';
import { VaultStore } from '../api/vault-store.js';
import { buildLeftPanel } from './ui-left-panel.js';
import { buildRightPanel } from './ui-right-panel.js';

const CLIENT_ID_KEY = 'sg-auth-google-client-id';

export async function init(config = {}) {
    if (config.googleClientId && !localStorage.getItem(CLIENT_ID_KEY)) {
        localStorage.setItem(CLIENT_ID_KEY, config.googleClientId);
    }

    const layoutWrap = document.getElementById('layout-wrap');
    layoutWrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'display:block;width:100%;height:100%;';
    layoutWrap.appendChild(layout);

    const layoutReady = new Promise(resolve => layout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
    layout.setLayout({
        type: 'row', id: 'main', sizes: [0.38, 0.62],
        children: [
            {
                type: 'stack', id: 's-left', activeTab: 0,
                tabs: [{ type: 'tab', id: 't-left', title: '🏛 Vaults', tag: 'div', locked: true, closable: false }],
            },
            {
                type: 'stack', id: 's-right', activeTab: 0,
                tabs: [{ type: 'tab', id: 't-right', title: '🔑 Vault Detail', tag: 'div', locked: true, closable: false }],
            },
        ],
    });
    await layoutReady;

    const leftEl  = layout.getPanelElement('t-left');
    const rightEl = layout.getPanelElement('t-right');

    // ── Shared state ──────────────────────────────────────────────────────────
    const state = {
        drive:      null,   // DriveAppData instance
        store:      null,   // VaultStore instance
        vaults:     [],     // current vault list
        selectedId: null,   // selected vault ID
    };

    // ── Callbacks ─────────────────────────────────────────────────────────────
    const cb = {
        connectDrive: async (opts = {}) => {
            const clientId = localStorage.getItem(CLIENT_ID_KEY) || '';
            if (!clientId) return;
            const token = await requestAccess(clientId, opts);
            state.drive = new DriveAppData(token);
            state.store = new VaultStore(state.drive);
            state.vaults = await state.store.load();
            renderLeft();
            renderRight();
        },

        selectVault: async (vaultId) => {
            state.selectedId = vaultId;
            if (vaultId) await state.store?.touchLastUsed(vaultId);
            renderRight();
            renderLeft(); // update active highlight
        },

        createVault: async ({ displayName, apiBaseUrl, vaultKey }) => {
            const vault = await state.store.create({ displayName, apiBaseUrl, vaultKey });
            state.vaults = state.store.list();
            state.selectedId = vault.vaultId;
            renderLeft();
            renderRight();
        },

        deleteVault: async (vaultId) => {
            await state.store.remove(vaultId);
            state.vaults = state.store.list();
            if (state.selectedId === vaultId) state.selectedId = null;
            renderLeft();
            renderRight();
        },
    };

    function renderLeft()  { buildLeftPanel(leftEl,   state, cb); }
    function renderRight() { buildRightPanel(rightEl, state, cb); }

    // Initial render
    renderLeft();
    renderRight();

    // Re-render on auth changes (sign in / sign out)
    onAuthChange(() => {
        if (!isSignedIn()) {
            state.drive      = null;
            state.store      = null;
            state.vaults     = [];
            state.selectedId = null;
            renderLeft();
            renderRight();
        } else {
            renderLeft();
            renderRight();
            if (!state.drive) {
                // Attempt silent Drive connect — skips account chooser for returning users
                const user = getUser();
                cb.connectDrive({ hint: user?.email || '', prompt: '' }).catch(() => {
                    // Silent failed (first-time consent needed) — show Connect Drive button
                    renderLeft();
                    renderRight();
                });
            }
        }
    });
}
