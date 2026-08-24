/**
 * <sg-vault-fetch> — fetch + decrypt a single vault blob.
 *
 * v0.1.1 changes:
 *  - Re-pinned onto vault-client v1.2.3. No API change.
 *
 * Fetches one encrypted blob by object ID from the configured endpoint,
 * decrypts it via the CryptoKey from a sibling <sg-vault-key>, and
 * emits the result with progress events.
 *
 * Attributes:
 *   key-source — ID of an <sg-vault-key> element on the page (required)
 *   object-id  — obj-cas-imm-* blob ID (required)
 *   auto       — bool-attr: when present, fetches on onReady (default: present)
 *
 * Events (all with bubbles: true, composed: true):
 *   sg-vault-fetch:fetch-started     — { vaultId, objectId, url }
 *   sg-vault-fetch:fetch-completed   — { vaultId, objectId, bytesReceived, fetchMs, cacheHit }
 *   sg-vault-fetch:decrypt-started   — { objectId, ciphertextBytes }
 *   sg-vault-fetch:decrypt-completed — { objectId, plaintextBytes, decryptMs }
 *   sg-vault-fetch:content-ready     — { objectId, bytes, contentType, text }
 *   sg-vault-fetch:fetch-error       — { stage, objectId, error }
 *
 * @module sg-vault-fetch
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'
import { SGVK_EVENTS } from '/components/vault-embed/sg-vault-key/v0/v0.1/v0.1.1/events.js'
import { SGVF_EVENTS } from './events.js'
import { sniffContentType } from './sg-vault-fetch-content-type.js'
import { fileIdToPath } from '/core/vault-client/v1/v1.2/v1.2.3/sg-vault-client.js'

const IV_LENGTH = 12

class SgVaultFetch extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-vault-fetch' }

    /** @type {{ bytes: ArrayBuffer, contentType: string, text: string|null }|null} */
    #lastContent = null

    async onReady() {
        const keySourceId = this.getAttribute('key-source')
        const objectId    = this.getAttribute('object-id')
        const auto        = !this.hasAttribute('auto') || this.getAttribute('auto') !== 'false'

        if (!keySourceId || !objectId) {
            this.showError('sg-vault-fetch: key-source and object-id are required')
            return
        }

        if (auto) {
            this.#resolveAndFetch(keySourceId, objectId)
        }
    }

    /**
     * Resolves the key-source element and starts fetch+decrypt.
     * @param {string} keySourceId
     * @param {string} objectId
     */
    #resolveAndFetch(keySourceId, objectId) {
        const keyEl = document.getElementById(keySourceId)
        if (!keyEl) {
            this.#emitError('no-key', objectId, `key-source element "${keySourceId}" not found`)
            return
        }

        // If key is ready, fetch immediately; otherwise wait for key-ready event
        if (keyEl.isReady) {
            keyEl.getKey().then(
                cryptoKey => this.#doFetch(keyEl, objectId, cryptoKey),
                err       => this.#emitError('no-key', objectId, err.message)
            )
        } else {
            const handler = (e) => {
                if (e.detail && e.detail.vaultId === keyEl.getAttribute('vault-id')) {
                    keyEl.getKey().then(
                        cryptoKey => this.#doFetch(keyEl, objectId, cryptoKey),
                        err       => this.#emitError('no-key', objectId, err.message)
                    )
                }
            }
            this.addTrackedListener(keyEl, SGVK_EVENTS.KEY_READY, handler, { once: true })

            // Also handle key error
            const errHandler = (e) => {
                this.#emitError('no-key', objectId, e.detail?.error || 'Key import failed')
            }
            this.addTrackedListener(keyEl, SGVK_EVENTS.KEY_ERROR, errHandler, { once: true })
        }
    }

    /**
     * Fetch the encrypted blob, decrypt it, sniff content type, emit events.
     * @param {HTMLElement} keyEl - the <sg-vault-key> element
     * @param {string} objectId
     * @param {CryptoKey} cryptoKey
     */
    async #doFetch(keyEl, objectId, cryptoKey) {
        const endpoint = keyEl.getEndpoint ? keyEl.getEndpoint() : 'https://send.sgraph.ai'
        const vaultId  = keyEl.getVaultId ? keyEl.getVaultId() : (keyEl.getAttribute('vault-id') || '')
        const path     = fileIdToPath(objectId)
        const url      = `${endpoint}/api/vault/read/${vaultId}/${encodeURIComponent(path)}`

        // ── fetch phase ──────────────────────────────────────────────────
        this.emit(SGVF_EVENTS.FETCH_STARTED, { vaultId, objectId, url })

        let encrypted
        const fetchStart = performance.now()
        try {
            const response = await fetch(url)
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`)
            }
            encrypted        = await response.arrayBuffer()
            const fetchMs    = performance.now() - fetchStart
            const cacheHit   = response.headers.get('x-cache') === 'HIT' ||
                               response.headers.get('cf-cache-status') === 'HIT'

            this.emit(SGVF_EVENTS.FETCH_COMPLETED, {
                vaultId,
                objectId,
                bytesReceived: encrypted.byteLength,
                fetchMs,
                cacheHit,
            })
        } catch (err) {
            this.#emitError('fetch', objectId, err.message)
            return
        }

        // ── decrypt phase ─────────────────────────────────────────────────
        this.emit(SGVF_EVENTS.DECRYPT_STARTED, {
            objectId,
            ciphertextBytes: encrypted.byteLength,
        })

        let plainBuffer
        const decryptStart = performance.now()
        try {
            const data       = new Uint8Array(encrypted)
            const iv         = data.slice(0, IV_LENGTH)
            const ciphertext = data.slice(IV_LENGTH)
            plainBuffer      = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                cryptoKey,
                ciphertext
            )
        } catch (err) {
            this.#emitError('decrypt', objectId, err.message)
            this.showError('Content unavailable')
            return
        }

        const decryptMs = performance.now() - decryptStart
        this.emit(SGVF_EVENTS.DECRYPT_COMPLETED, {
            objectId,
            plaintextBytes: plainBuffer.byteLength,
            decryptMs,
        })

        // ── content-type + emit ───────────────────────────────────────────
        const { contentType, text } = sniffContentType(plainBuffer)
        this.#lastContent = { bytes: plainBuffer, contentType, text }

        this.emit(SGVF_EVENTS.CONTENT_READY, {
            objectId,
            bytes: plainBuffer,
            contentType,
            text,
        })
    }

    /**
     * Emit a fetch-error event and show a user-visible error.
     * @param {'fetch'|'decrypt'|'no-key'} stage
     * @param {string} objectId
     * @param {string} error
     */
    #emitError(stage, objectId, error) {
        this.emit(SGVF_EVENTS.FETCH_ERROR, { stage, objectId, error })
        this.showError('Content unavailable')
    }

    /**
     * Triggers a fetch+decrypt cycle. Used when auto attribute is absent.
     * @returns {Promise<void>}
     */
    async fetch() {
        const keySourceId = this.getAttribute('key-source')
        const objectId    = this.getAttribute('object-id')
        if (!keySourceId || !objectId) return
        this.#resolveAndFetch(keySourceId, objectId)
    }

    /**
     * Returns the last successfully decrypted result, or null if none yet.
     * @returns {{ bytes: ArrayBuffer, contentType: string, text: string|null }|null}
     */
    getCurrentContent() {
        return this.#lastContent
    }
}

if (!customElements.get('sg-vault-fetch')) {
    customElements.define('sg-vault-fetch', SgVaultFetch)
}

export { SgVaultFetch }
