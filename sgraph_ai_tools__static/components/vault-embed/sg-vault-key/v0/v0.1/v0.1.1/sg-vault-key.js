/**
 * <sg-vault-key> — credential holder for the vault embed stack.
 *
 * v0.1.1 changes:
 *  - The read-key attribute now also accepts the form sgit emits: 64-char
 *    hex, with or without a sgit_public_read_ / sgit_private_read_ prefix.
 *    base64url keys keep working unchanged (vault-client v1.2.3).
 *
 * Holds a vault's read_key, derives the AES-GCM CryptoKey once on
 * connectedCallback, and makes it available to other components via element-ID
 * reference. Renders nothing (empty shadow root).
 *
 * Attributes:
 *   id        — Element ID referenced by other components via key-source (required)
 *   vault-id  — 4–24 char vault ID (required)
 *   read-key  — base64url-encoded read key (32 bytes) (required)
 *   endpoint  — API endpoint (default: https://send.sgraph.ai)
 *
 * Events:
 *   sg-vault-key:key-ready — { vaultId, cryptoKey, endpoint, derivationMs }
 *   sg-vault-key:key-error — { vaultId, error }
 *
 * @module sg-vault-key
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'
import { importReadKey } from '/core/vault-client/v1/v1.2/v1.2.3/sg-vault-client.js'
import { SGVK_EVENTS } from './events.js'

const DEFAULT_ENDPOINT = 'https://send.sgraph.ai'

class SgVaultKey extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-vault-key' }

    /** @type {CryptoKey|null} */
    #cryptoKey = null

    /** @type {Promise<CryptoKey>|null} */
    #keyPromise = null

    /** @type {string} */
    #vaultId = ''

    /** @type {string} */
    #endpoint = DEFAULT_ENDPOINT

    async onReady() {
        this.#vaultId  = this.getAttribute('vault-id') || ''
        this.#endpoint = (this.getAttribute('endpoint') || DEFAULT_ENDPOINT).replace(/\/$/, '')
        const readKey  = this.getAttribute('read-key') || ''

        if (!this.#vaultId) {
            const msg = 'sg-vault-key: vault-id attribute is required'
            this.emit(SGVK_EVENTS.KEY_ERROR, { vaultId: this.#vaultId, error: msg })
            this.showError(msg)
            return
        }

        if (!readKey) {
            const msg = 'sg-vault-key: read-key attribute is required'
            this.emit(SGVK_EVENTS.KEY_ERROR, { vaultId: this.#vaultId, error: msg })
            this.showError(msg)
            return
        }

        this.#keyPromise = this.#importKey(readKey)
    }

    /**
     * Import the read key and emit key-ready or key-error.
     * @param {string} readKey - base64url-encoded key
     * @returns {Promise<CryptoKey>}
     */
    async #importKey(readKey) {
        const t0 = performance.now()
        try {
            const cryptoKey    = await importReadKey(readKey)
            const derivationMs = performance.now() - t0
            this.#cryptoKey    = cryptoKey
            this.emit(SGVK_EVENTS.KEY_READY, {
                vaultId:      this.#vaultId,
                cryptoKey,
                endpoint:     this.#endpoint,
                derivationMs,
            })
            return cryptoKey
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            this.emit(SGVK_EVENTS.KEY_ERROR, { vaultId: this.#vaultId, error: msg })
            this.showError('Key import failed')
            throw err
        }
    }

    /**
     * Returns a Promise resolving to the imported CryptoKey.
     * Resolves immediately if already imported, joins the in-flight Promise
     * if import is pending, rejects with the underlying error if import failed.
     * @returns {Promise<CryptoKey>}
     */
    async getKey() {
        if (this.#cryptoKey) return this.#cryptoKey
        if (this.#keyPromise) return this.#keyPromise
        return Promise.reject(new Error('sg-vault-key: not yet initialised'))
    }

    /**
     * Returns the configured endpoint URL.
     * @returns {string}
     */
    getEndpoint() {
        return this.#endpoint
    }

    /**
     * Returns the vault ID.
     * @returns {string}
     */
    getVaultId() {
        return this.#vaultId
    }
}

if (!customElements.get('sg-vault-key')) {
    customElements.define('sg-vault-key', SgVaultKey)
}

export { SgVaultKey }
