/**
 * <vault-manager> — Manages saved vaults in localStorage.
 *
 * Stores vault entries as { label, vaultKey, apiBaseUrl, savedAt }.
 * Vault keys are stored — this is a convenience feature; the user
 * understands the security trade-off of localStorage.
 *
 * Events emitted:
 *   vault-open-request  — { detail: { vaultKey, apiBaseUrl } }
 *     Fired when user selects a saved vault or enters a new one.
 *
 * Methods:
 *   setConnected(label)  — Show which vault is connected
 *   setDisconnected()    — Reset to entry mode
 */
const STORAGE_KEY = 'sg-vault-browser-vaults'

export class VaultManager extends HTMLElement {

    connectedCallback() {
        this._defaultApiUrl = this.getAttribute('api-url') || 'https://send.sgraph.ai'

        this.innerHTML = `
            <style>
                vault-manager { display: block; }
                vault-manager .vm-wrap {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 1rem 1.25rem;
                }

                /* Saved vaults list */
                vault-manager .vm-saved {
                    margin-bottom: 1rem;
                }
                vault-manager .vm-saved-label {
                    font-size: 0.75rem;
                    color: var(--sg-text-dim);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 0.5rem;
                }
                vault-manager .vm-vault-list {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.375rem;
                }
                vault-manager .vm-vault-chip {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.375rem;
                    padding: 0.3rem 0.625rem;
                    background: rgba(78,205,196,0.08);
                    border: 1px solid var(--sg-border);
                    border-radius: 9999px;
                    font-size: 0.8125rem;
                    cursor: pointer;
                    transition: background 0.15s, border-color 0.15s;
                }
                vault-manager .vm-vault-chip:hover {
                    background: rgba(78,205,196,0.15);
                    border-color: var(--sg-accent);
                }
                vault-manager .vm-vault-chip.active {
                    background: rgba(78,205,196,0.2);
                    border-color: var(--sg-accent);
                    color: var(--sg-accent);
                }
                vault-manager .vm-chip-label { pointer-events: none; }
                vault-manager .vm-chip-id {
                    font-family: var(--sg-font-mono);
                    font-size: 0.6875rem;
                    color: var(--sg-text-dim);
                    pointer-events: none;
                }
                vault-manager .vm-chip-del {
                    font-size: 0.75rem;
                    color: var(--sg-text-dim);
                    cursor: pointer;
                    padding: 0 0.125rem;
                    line-height: 1;
                }
                vault-manager .vm-chip-del:hover { color: var(--sg-error, #e94560); }

                /* Input row */
                vault-manager .vm-input-row {
                    display: flex;
                    gap: 0.5rem;
                    align-items: flex-end;
                }
                vault-manager .vm-field {
                    flex: 1;
                    min-width: 0;
                }
                vault-manager .vm-field label {
                    display: block;
                    font-size: 0.75rem;
                    font-weight: 500;
                    color: var(--sg-text-dim);
                    margin-bottom: 0.25rem;
                }
                vault-manager .vm-field input {
                    width: 100%;
                    padding: 0.5rem 0.625rem;
                    background: var(--sg-bg-secondary, #16213E);
                    color: var(--sg-text);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                    outline: none;
                    box-sizing: border-box;
                }
                vault-manager .vm-field input:focus { border-color: var(--sg-accent); }
                vault-manager .vm-field input::placeholder { color: var(--sg-text-dim); }
                vault-manager .vm-field.vm-api { max-width: 280px; }
                vault-manager .vm-btn-group {
                    display: flex;
                    gap: 0.375rem;
                    flex-shrink: 0;
                }

                /* No saved vaults */
                vault-manager .vm-empty {
                    color: var(--sg-text-dim);
                    font-size: 0.8125rem;
                    font-style: italic;
                    margin-bottom: 0.75rem;
                }
            </style>
            <div class="vm-wrap">
                <div class="vm-saved" id="vm-saved"></div>
                <div class="vm-input-row">
                    <div class="vm-field" style="flex:2;">
                        <label>Vault Key</label>
                        <input type="password" id="vm-key" placeholder="passphrase:vault_id" autocomplete="off">
                    </div>
                    <div class="vm-field vm-api">
                        <label>API URL</label>
                        <input type="text" id="vm-url" value="${this._esc(this._defaultApiUrl)}">
                    </div>
                    <div class="vm-btn-group" style="padding-bottom:1px;">
                        <button class="btn" id="vm-open">Open</button>
                        <button class="btn btn--secondary" id="vm-save" title="Save vault for next time">Save</button>
                    </div>
                </div>
            </div>`

        this._keyInput  = this.querySelector('#vm-key')
        this._urlInput  = this.querySelector('#vm-url')
        this._openBtn   = this.querySelector('#vm-open')
        this._saveBtn   = this.querySelector('#vm-save')
        this._savedDiv  = this.querySelector('#vm-saved')

        this._openBtn.addEventListener('click', () => this._open())
        this._saveBtn.addEventListener('click', () => this._save())
        this._keyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._open()
        })

        this._renderSaved()
    }

    setLoading(loading) {
        this._openBtn.disabled    = loading
        this._openBtn.textContent = loading ? 'Opening…' : 'Open'
    }

    setConnected(label) {
        // Highlight the active chip
        for (const chip of this._savedDiv.querySelectorAll('.vm-vault-chip')) {
            chip.classList.toggle('active', chip.dataset.label === label)
        }
    }

    setDisconnected() {
        for (const chip of this._savedDiv.querySelectorAll('.vm-vault-chip')) {
            chip.classList.remove('active')
        }
    }

    _open() {
        const vaultKey   = this._keyInput.value.trim()
        const apiBaseUrl = this._urlInput.value.trim()
        if (!vaultKey) return

        this.dispatchEvent(new CustomEvent('vault-open-request', {
            bubbles: true,
            detail: { vaultKey, apiBaseUrl }
        }))
    }

    _save() {
        const vaultKey   = this._keyInput.value.trim()
        const apiBaseUrl = this._urlInput.value.trim()
        if (!vaultKey) return

        // Extract vault ID for display
        const lastColon = vaultKey.lastIndexOf(':')
        const vaultId   = lastColon > 0 ? vaultKey.slice(lastColon + 1) : vaultKey.slice(0, 8)

        const vaults = this._load()
        // Avoid duplicates by vault ID
        const existing = vaults.findIndex(v => v.vaultId === vaultId)
        const entry = {
            label:     vaultId,
            vaultId,
            vaultKey,
            apiBaseUrl,
            savedAt:   Date.now()
        }
        if (existing >= 0) {
            vaults[existing] = entry
        } else {
            vaults.push(entry)
        }
        this._store(vaults)
        this._renderSaved()
    }

    _delete(vaultId) {
        const vaults = this._load().filter(v => v.vaultId !== vaultId)
        this._store(vaults)
        this._renderSaved()
    }

    _selectSaved(entry) {
        this._keyInput.value = entry.vaultKey
        this._urlInput.value = entry.apiBaseUrl || this._defaultApiUrl

        this.dispatchEvent(new CustomEvent('vault-open-request', {
            bubbles: true,
            detail: { vaultKey: entry.vaultKey, apiBaseUrl: entry.apiBaseUrl || this._defaultApiUrl }
        }))
    }

    _renderSaved() {
        const vaults = this._load()
        this._savedDiv.innerHTML = ''

        if (vaults.length === 0) return

        const label = document.createElement('div')
        label.className = 'vm-saved-label'
        label.textContent = 'Saved Vaults'
        this._savedDiv.appendChild(label)

        const list = document.createElement('div')
        list.className = 'vm-vault-list'

        for (const v of vaults) {
            const chip = document.createElement('div')
            chip.className = 'vm-vault-chip'
            chip.dataset.label = v.label

            const lbl = document.createElement('span')
            lbl.className = 'vm-chip-label'
            lbl.textContent = v.label

            const id = document.createElement('span')
            id.className = 'vm-chip-id'
            const host = this._hostLabel(v.apiBaseUrl)
            if (host) id.textContent = host

            const del = document.createElement('span')
            del.className = 'vm-chip-del'
            del.textContent = '\u00d7'
            del.title = 'Remove'
            del.addEventListener('click', (e) => {
                e.stopPropagation()
                this._delete(v.vaultId)
            })

            chip.appendChild(lbl)
            if (host) chip.appendChild(id)
            chip.appendChild(del)
            chip.addEventListener('click', () => this._selectSaved(v))
            list.appendChild(chip)
        }

        this._savedDiv.appendChild(list)
    }

    _hostLabel(url) {
        if (!url) return ''
        try {
            const h = new URL(url).hostname
            if (h === 'send.sgraph.ai') return ''
            return h.replace('send.sgraph.ai', '').replace(/^\./, '')
        } catch { return '' }
    }

    _load() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
        } catch { return [] }
    }

    _store(vaults) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(vaults))
    }

    _esc(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    }
}

customElements.define('vault-manager', VaultManager)
