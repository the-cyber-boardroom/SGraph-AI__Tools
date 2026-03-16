/**
 * <vault-key-input> — Vault key entry form.
 *
 * Attributes:
 *   api-url  — default API base URL (default: https://send.sgraph.ai)
 *
 * Events emitted:
 *   vault-open-request  — { detail: { vaultKey, apiBaseUrl } }
 *     Fired when the user clicks Open or presses Enter.
 *
 * Methods:
 *   setLoading(bool)  — toggle the button into a loading state
 */
export class VaultKeyInput extends HTMLElement {

    connectedCallback() {
        const apiUrl = this.getAttribute('api-url') || 'https://send.sgraph.ai'

        this.innerHTML = `
            <style>
                vault-key-input { display: block; }
                vault-key-input .vki-wrap {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 1.5rem;
                }
                vault-key-input label {
                    display: block;
                    font-size: 0.875rem;
                    font-weight: 600;
                    margin-bottom: 0.5rem;
                }
                vault-key-input .vki-hint {
                    color: var(--sg-text-dim);
                    font-size: 0.75rem;
                    margin-bottom: 0.75rem;
                }
                vault-key-input .vki-row {
                    display: flex;
                    gap: 0.5rem;
                }
                vault-key-input .vki-row input {
                    flex: 1;
                    padding: 0.625rem 0.75rem;
                    background: var(--sg-bg-secondary, #16213E);
                    color: var(--sg-text);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                    outline: none;
                }
                vault-key-input .vki-row input:focus {
                    border-color: var(--sg-accent);
                }
                vault-key-input .vki-row input::placeholder {
                    color: var(--sg-text-dim);
                }
                vault-key-input .vki-api {
                    margin-top: 1rem;
                }
                vault-key-input .vki-api label {
                    font-size: 0.8125rem;
                    font-weight: 500;
                }
                vault-key-input .vki-api input {
                    width: 100%;
                    padding: 0.5rem 0.75rem;
                    background: var(--sg-bg-secondary, #16213E);
                    color: var(--sg-text-muted);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    font-family: var(--sg-font-mono);
                    font-size: 0.75rem;
                    outline: none;
                    margin-top: 0.25rem;
                    box-sizing: border-box;
                }
            </style>
            <div class="vki-wrap">
                <label for="vki-key">Vault Key</label>
                <p class="vki-hint">Format: passphrase:vault_id (e.g. my-secret-phrase:a1b2c3d4)</p>
                <div class="vki-row">
                    <input type="password" id="vki-key" placeholder="Enter your vault key…" autocomplete="off">
                    <button class="btn" id="vki-btn">Open Vault</button>
                </div>
                <div class="vki-api">
                    <label for="vki-url">API Base URL</label>
                    <input type="text" id="vki-url" value="${apiUrl}" placeholder="https://send.sgraph.ai">
                </div>
            </div>`

        this._keyInput = this.querySelector('#vki-key')
        this._urlInput = this.querySelector('#vki-url')
        this._btn      = this.querySelector('#vki-btn')

        this._btn.addEventListener('click', () => this._submit())
        this._keyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._submit()
        })
    }

    _submit() {
        const vaultKey   = this._keyInput.value.trim()
        const apiBaseUrl = this._urlInput.value.trim()
        if (!vaultKey) return

        this.dispatchEvent(new CustomEvent('vault-open-request', {
            bubbles: true,
            detail: { vaultKey, apiBaseUrl }
        }))
    }

    setLoading(loading) {
        this._btn.disabled    = loading
        this._btn.textContent = loading ? 'Deriving keys…' : 'Open Vault'
    }
}

customElements.define('vault-key-input', VaultKeyInput)
