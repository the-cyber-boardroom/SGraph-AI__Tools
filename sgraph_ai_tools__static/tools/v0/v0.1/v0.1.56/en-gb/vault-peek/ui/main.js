/**
 * vault-embed-demo — entry point.
 *
 * Full-screen two-column layout:
 *  - Left sidebar: config form / credentials + vault tree
 *  - Right: sg-layout with tabbed panels (Trace + dynamic file viewers)
 *
 * localStorage is used to restore the last config so the form can be
 * skipped on repeat visits. Passphrase / vault key are NEVER persisted.
 */

import '/core/sg-layout/v0.1.0/sg-layout.js'
import { mountSetupForm }        from './ui-setup-form.js'
import { mountCredentialsPanel } from './ui-credentials-panel.js'
import { mountTracePanel }       from './ui-trace-panel.js'
import { buildVaultHandle }      from './ui-vault-keys.js'
import { initLayout }            from './ui-layout.js'
import './ved-cred-panel.js'
import './ved-vault-tree.js'
import './ved-file-viewer.js'

const STORAGE_KEY = 'sg-vault-embed-demo-v1'

/**
 * Load saved config from localStorage.
 * @returns {object|null}
 */
function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null } catch { return null }
}

/**
 * Persist safe config fields (never passphrase / vault key).
 * @param {object} cfg
 */
function saveCfg(cfg) {
    const safe = {
        vaultId:     cfg.vaultId,
        readKey:     cfg.readKey,
        endpoint:    cfg.endpoint,
        objectIds:   cfg.objectIds,
        manifestUrl: cfg.manifestUrl,
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(safe)) } catch {}
}

/**
 * Show the credential setup form — used on first load and when switching vaults.
 */
function showSetupForm() {
    const formEl    = document.getElementById('setup-form-container')
    const credsEl   = document.getElementById('creds-display')
    const switchBtn = document.getElementById('switch-vault-btn')
    if (credsEl)   credsEl.hidden   = true
    if (switchBtn) switchBtn.hidden = true
    if (formEl) {
        formEl.hidden = false
        mountSetupForm({ container: formEl, savedConfig: loadSaved(), onConfig: activate })
    }
}

/**
 * Activate the demo: persist config, populate credential panel, open vault,
 * and fire `ved:vault-ready` so tree + trace pick it up.
 * @param {object} config
 */
async function activate(config) {
    saveCfg(config)

    mountCredentialsPanel({
        vaultIdEl:  document.getElementById('cred-vault-id'),
        readKeyEl:  document.getElementById('cred-read-key'),
        endpointEl: document.getElementById('cred-endpoint'),
        config,
    })

    const switchBtn = document.getElementById('switch-vault-btn')
    if (switchBtn) {
        switchBtn.hidden  = false
        switchBtn.onclick = showSetupForm
    }

    try {
        const vault = await buildVaultHandle(config)
        document.dispatchEvent(new CustomEvent('sg-vault-key:key-ready', {
            detail: { vaultId: vault.keys.vaultId, url: config.endpoint || 'https://send.sgraph.ai' },
        }))
        document.dispatchEvent(new CustomEvent('ved:vault-ready', {
            detail: { vault, config },
        }))
    } catch (err) {
        document.dispatchEvent(new CustomEvent('sg-vault-key:key-error', {
            detail: { error: err.message },
        }))
        console.error('[vault-embed-demo] vault handle error', err)
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

initLayout()

// ved-cred-panel connects inside sg-layout's setLayout() which runs in a
// whenDefined microtask — wait for it before touching DOM inside the panel.
document.addEventListener('ved:cred-panel-ready', () => {
    const saved = loadSaved()
    if (saved && saved.vaultId && saved.readKey) {
        const formEl = document.getElementById('setup-form-container')
        if (formEl) formEl.hidden = true
        activate(saved)
    } else {
        mountSetupForm({
            container:   document.getElementById('setup-form-container'),
            savedConfig: null,
            onConfig:    activate,
        })
    }
}, { once: true })

// Register SgToolApi (non-blocking)
import('../api/vault-peek-api.js')
