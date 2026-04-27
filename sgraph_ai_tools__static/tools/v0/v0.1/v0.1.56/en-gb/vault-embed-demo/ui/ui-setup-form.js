/**
 * ui-setup-form — vault credential entry form.
 *
 * Accepts either a full vault key (passphrase:vaultId, derives read_key via
 * PBKDF2) or manual vault-id + read-key entry. Optional object IDs and
 * manifest URL for configuring the content sections.
 *
 * @module ui-setup-form
 */

import { parseVaultKey, deriveVaultKeys } from '/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js'

/** localStorage key for persisting vault config (never stores passphrase). */
export const STORAGE_KEY = 'sg-vault-embed-demo-v1'

/** @param {Uint8Array} bytes @returns {string} */
function bytesToBase64Url(bytes) {
    const b64 = btoa(String.fromCharCode(...bytes))
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

const FORM_HTML = `
<form id="cred-form" class="ved-setup-form" novalidate>

    <div class="ved-form-section">
        <div class="ved-form-group">
            <label for="inp-vault-key" class="ved-form-label">
                Vault Key
                <span class="ved-form-hint">passphrase:vault_id — derives credentials automatically</span>
            </label>
            <input id="inp-vault-key" type="password" class="ved-form-input"
                   placeholder="your-passphrase:vaultid"
                   autocomplete="off" spellcheck="false">
        </div>

        <div class="ved-form-divider"><span>or enter separately</span></div>

        <div class="ved-form-row">
            <div class="ved-form-group">
                <label for="inp-vault-id" class="ved-form-label">Vault ID</label>
                <input id="inp-vault-id" type="text" class="ved-form-input"
                       placeholder="abc12345" autocomplete="off" spellcheck="false">
            </div>
            <div class="ved-form-group ved-form-group--wide">
                <label for="inp-read-key" class="ved-form-label">
                    Read Key
                    <span class="ved-form-hint">base64url, 32 bytes</span>
                </label>
                <input id="inp-read-key" type="password" class="ved-form-input"
                       placeholder="base64url-encoded-read-key"
                       autocomplete="off" spellcheck="false">
            </div>
        </div>

        <div class="ved-form-group">
            <label for="inp-endpoint" class="ved-form-label">API Endpoint</label>
            <input id="inp-endpoint" type="url" class="ved-form-input"
                   value="https://send.sgraph.ai"
                   autocomplete="off" spellcheck="false">
        </div>
    </div>

    <details class="ved-form-advanced">
        <summary class="ved-form-advanced-toggle">Object IDs (optional)</summary>
        <div class="ved-form-advanced-body">
            <p class="ved-form-hint-block">
                Leave blank to skip that content section. Object IDs start with
                <code>obj-cas-imm-</code>.
            </p>
            <div class="ved-form-group">
                <label for="inp-obj-hero" class="ved-form-label">Hero object ID (markdown)</label>
                <input id="inp-obj-hero" type="text" class="ved-form-input"
                       placeholder="obj-cas-imm-..." autocomplete="off" spellcheck="false">
            </div>
            <div class="ved-form-group">
                <label for="inp-obj-image" class="ved-form-label">Image object ID</label>
                <input id="inp-obj-image" type="text" class="ved-form-input"
                       placeholder="obj-cas-imm-..." autocomplete="off" spellcheck="false">
            </div>
            <div class="ved-form-group">
                <label for="inp-obj-json" class="ved-form-label">JSON object ID</label>
                <input id="inp-obj-json" type="text" class="ved-form-input"
                       placeholder="obj-cas-imm-..." autocomplete="off" spellcheck="false">
            </div>
            <div class="ved-form-group">
                <label for="inp-manifest" class="ved-form-label">Manifest URL</label>
                <input id="inp-manifest" type="url" class="ved-form-input"
                       placeholder="https://send.sgraph.ai/..." autocomplete="off" spellcheck="false">
            </div>
        </div>
    </details>

    <div class="ved-form-error" id="form-error" hidden></div>
    <button type="submit" class="ved-form-btn" id="form-submit-btn">Load Vault</button>
    <p class="ved-form-privacy">
        Credentials stay in this tab only — nothing is sent to any server.
    </p>
</form>
`

/**
 * Mount the credential setup form into a container element.
 *
 * @param {{ container: HTMLElement, onConfig: (config: object) => void, savedConfig?: object|null }} opts
 */
export function mountSetupForm({ container, onConfig, savedConfig = null }) {
    container.innerHTML = FORM_HTML

    const form      = container.querySelector('#cred-form')
    const errorEl   = container.querySelector('#form-error')
    const submitBtn = container.querySelector('#form-submit-btn')

    // Pre-fill inputs from saved config (but never vault key / passphrase)
    if (savedConfig) {
        if (savedConfig.vaultId)  form.querySelector('#inp-vault-id').value  = savedConfig.vaultId
        if (savedConfig.readKey)  form.querySelector('#inp-read-key').value  = savedConfig.readKey
        if (savedConfig.endpoint) form.querySelector('#inp-endpoint').value  = savedConfig.endpoint
        if (savedConfig.objectIds) {
            const oi = savedConfig.objectIds
            if (oi.hero)  form.querySelector('#inp-obj-hero').value  = oi.hero
            if (oi.image) form.querySelector('#inp-obj-image').value = oi.image
            if (oi.json)  form.querySelector('#inp-obj-json').value  = oi.json
        }
        if (savedConfig.manifestUrl) form.querySelector('#inp-manifest').value = savedConfig.manifestUrl
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault()
        errorEl.hidden = true
        submitBtn.disabled = true
        submitBtn.textContent = 'Deriving keys…'

        const vaultKeyVal = form.querySelector('#inp-vault-key').value.trim()
        const vaultIdVal  = form.querySelector('#inp-vault-id').value.trim()
        const readKeyVal  = form.querySelector('#inp-read-key').value.trim()
        const endpoint    = form.querySelector('#inp-endpoint').value.trim() || 'https://send.sgraph.ai'

        const objectIds = {
            hero:  form.querySelector('#inp-obj-hero').value.trim()  || null,
            image: form.querySelector('#inp-obj-image').value.trim() || null,
            json:  form.querySelector('#inp-obj-json').value.trim()  || null,
        }
        const manifestUrl = form.querySelector('#inp-manifest').value.trim() || null

        try {
            let vaultId, readKey

            if (vaultKeyVal) {
                const { passphrase, vaultId: vid } = parseVaultKey(vaultKeyVal)
                submitBtn.textContent = 'Running PBKDF2…'
                const keys = await deriveVaultKeys(passphrase, vid)
                vaultId = vid
                readKey = bytesToBase64Url(keys.readKeyBytes)
            } else if (vaultIdVal && readKeyVal) {
                vaultId = vaultIdVal
                readKey = readKeyVal
            } else {
                throw new Error('Enter a vault key, or both vault ID and read key.')
            }

            container.innerHTML = ''
            onConfig({ vaultId, readKey, endpoint, objectIds, manifestUrl })
        } catch (err) {
            errorEl.textContent = err.message
            errorEl.hidden = false
            submitBtn.disabled = false
            submitBtn.textContent = 'Load Vault'
        }
    })
}
