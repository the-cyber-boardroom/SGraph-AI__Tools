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
import { loadHistory, pushHistory, formatAgo } from './ui-vault-history.js'

/** localStorage key for persisting vault config (never stores passphrase). */
export const STORAGE_KEY = 'sg-vault-embed-demo-v1'

/** @param {Uint8Array} bytes @returns {string} */
function bytesToBase64Url(bytes) {
    const b64 = btoa(String.fromCharCode(...bytes))
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

const FORM_HTML = `
<form id="cred-form" class="ved-setup-form" novalidate>

    <div class="ved-form-group">
        <label for="inp-vault-key" class="ved-form-label">
            Vault Key
            <span class="ved-form-hint">passphrase:vault_id</span>
        </label>
        <input id="inp-vault-key" type="password" class="ved-form-input ved-form-input--primary"
               placeholder="your-passphrase:vaultid"
               autocomplete="off" spellcheck="false" autofocus>
    </div>

    <div class="ved-form-error" id="form-error" hidden></div>
    <button type="submit" class="ved-form-btn" id="form-submit-btn">Load Vault</button>

    <details class="ved-form-advanced" id="manual-entry">
        <summary class="ved-form-advanced-toggle">or enter credentials separately</summary>
        <div class="ved-form-advanced-body">
            <div class="ved-form-row">
                <div class="ved-form-group">
                    <label for="inp-vault-id" class="ved-form-label">Vault ID</label>
                    <input id="inp-vault-id" type="text" class="ved-form-input"
                           placeholder="abc12345" autocomplete="off" spellcheck="false">
                </div>
                <div class="ved-form-group ved-form-group--wide">
                    <label for="inp-read-key" class="ved-form-label">
                        Read Key <span class="ved-form-hint">base64url</span>
                    </label>
                    <input id="inp-read-key" type="password" class="ved-form-input"
                           placeholder="base64url read key"
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
    </details>

    <p class="ved-form-privacy">
        Credentials stay in this tab only — nothing is sent to any server.
    </p>
</form>
`

/**
 * Inject a history picker above the form. Clicking an entry pre-fills the form.
 * @param {HTMLElement} container
 * @param {HTMLElement} form
 */
function mountHistoryPicker(container, form) {
    const history = loadHistory()
    if (history.length === 0) return

    const wrap = document.createElement('div')
    wrap.className = 'ved-hist-picker'

    const title = document.createElement('p')
    title.className = 'ved-hist-title'
    title.textContent = 'Recent Vaults'
    wrap.appendChild(title)

    const list = document.createElement('ul')
    list.className = 'ved-hist-list'

    for (const entry of history) {
        const li = document.createElement('li')
        li.className = 'ved-hist-item'
        const hostname = (() => { try { return new URL(entry.endpoint).hostname } catch { return entry.endpoint } })()
        li.innerHTML = `<span class="ved-hist-id">${entry.vaultId}</span><span class="ved-hist-meta">${hostname} · ${formatAgo(entry.lastUsed)}</span>`
        li.addEventListener('click', () => {
            form.querySelector('#inp-vault-id').value = entry.vaultId
            form.querySelector('#inp-read-key').value = entry.readKey
            form.querySelector('#inp-endpoint').value = entry.endpoint
        })
        list.appendChild(li)
    }

    wrap.appendChild(list)
    container.insertBefore(wrap, container.firstChild)
}

/**
 * Mount the credential setup form into a container element.
 * History picker (if any) is injected above the form automatically.
 *
 * @param {{ container: HTMLElement, onConfig: (config: object) => void }} opts
 */
export function mountSetupForm({ container, onConfig }) {
    container.innerHTML = FORM_HTML

    const form      = container.querySelector('#cred-form')
    const errorEl   = container.querySelector('#form-error')
    const submitBtn = container.querySelector('#form-submit-btn')

    mountHistoryPicker(container, form)

    form.addEventListener('submit', async (e) => {
        e.preventDefault()
        errorEl.hidden = true
        submitBtn.disabled = true
        submitBtn.textContent = 'Deriving keys…'

        const vaultKeyVal = form.querySelector('#inp-vault-key').value.trim()
        const vaultIdVal  = form.querySelector('#inp-vault-id').value.trim()
        const readKeyVal  = form.querySelector('#inp-read-key').value.trim()
        const endpoint    = (form.querySelector('#inp-endpoint').value.trim()) || 'https://send.sgraph.ai'

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

            pushHistory({ vaultId, readKey, endpoint })
            container.innerHTML = ''
            onConfig({ vaultId, readKey, endpoint })
        } catch (err) {
            errorEl.textContent = err.message
            errorEl.hidden = false
            submitBtn.disabled = false
            submitBtn.textContent = 'Load Vault'
        }
    })
}
