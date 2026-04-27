/**
 * <sg-content-image> — vault-agnostic image renderer.
 *
 * Receives content-ready events and renders the bytes as an image using
 * a Blob URL. Revokes the Blob URL on disconnectedCallback to prevent leaks.
 *
 * This component has ZERO imports from components/vault-embed/ or core/vault-*.
 *
 * Attributes:
 *   content-source — ID of the element that emits *:content-ready (required)
 *
 * @module sg-content-image
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'

class SgContentImage extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-content-image' }

    /** @type {string|null} Current blob URL — revoked on disconnect */
    #blobUrl = null

    onReady() {
        const sourceId = this.getAttribute('content-source')
        if (!sourceId) {
            this.showError('sg-content-image: content-source attribute is required')
            return
        }
        this.#bindContentSource(sourceId)
    }

    disconnectedCallback() {
        this.#revokeBlobUrl()
        super.disconnectedCallback()
    }

    /**
     * @param {string} sourceId
     */
    #bindContentSource(sourceId) {
        const handler = (e) => {
            if (!e.detail || !e.detail.bytes) return
            // Only handle events from the correct source element
            const from = e.target || e.srcElement
            if (from && from.id !== sourceId) return
            this.#renderBytes(e.detail.bytes, e.detail.contentType || 'image/png')
        }

        const sourceEl = document.getElementById(sourceId)
        if (sourceEl) {
            this.addTrackedListener(sourceEl, 'sg-vault-fetch:content-ready', handler)
            this.addTrackedListener(sourceEl, 'demo:content-ready', handler)
        } else {
            this.addTrackedListener(document, 'sg-vault-fetch:content-ready', (e) => {
                if (e.target && e.target.id === sourceId) handler(e)
            })
        }
    }

    /**
     * Create a Blob URL and render the image.
     * @param {ArrayBuffer} bytes
     * @param {string} contentType
     */
    #renderBytes(bytes, contentType) {
        this.#revokeBlobUrl()
        const blob        = new Blob([bytes], { type: contentType })
        this.#blobUrl     = URL.createObjectURL(blob)
        const img         = this.$('#img')
        if (img) {
            img.src = this.#blobUrl
        }
    }

    /**
     * Revoke the current Blob URL if one exists.
     */
    #revokeBlobUrl() {
        if (this.#blobUrl) {
            URL.revokeObjectURL(this.#blobUrl)
            this.#blobUrl = null
        }
    }
}

if (!customElements.get('sg-content-image')) {
    customElements.define('sg-content-image', SgContentImage)
}

export { SgContentImage }
