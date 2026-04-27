/**
 * <sg-content-json> — vault-agnostic JSON renderer.
 *
 * Receives content-ready events, parses the text as JSON, then either
 * renders it as a formatted <pre> block (mode="render") or emits it as
 * a parsed event (mode="emit") for downstream consumers.
 *
 * This component has ZERO imports from components/vault-embed/ or core/vault-*.
 *
 * Attributes:
 *   content-source — ID of the element that emits *:content-ready (required)
 *   mode           — "render" (default) or "emit"
 *
 * Events:
 *   sg-content-json:json-parsed — { objectId, data } (only in mode="emit")
 *
 * @module sg-content-json
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'
import { SGCJ_EVENTS } from './events.js'

class SgContentJson extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-content-json' }

    onReady() {
        const sourceId = this.getAttribute('content-source')
        if (!sourceId) {
            this.showError('sg-content-json: content-source attribute is required')
            return
        }
        this.#bindContentSource(sourceId)
    }

    /**
     * @param {string} sourceId
     */
    #bindContentSource(sourceId) {
        const handler = (e) => {
            if (!e.detail || e.detail.text == null) return
            const from = e.target || e.srcElement
            if (from && from.id !== sourceId) return
            const mode     = this.getAttribute('mode') || 'render'
            const objectId = e.detail.objectId || ''
            this.#processText(e.detail.text, objectId, mode)
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
     * Parse JSON text and render or emit.
     * @param {string} text
     * @param {string} objectId
     * @param {string} mode
     */
    #processText(text, objectId, mode) {
        let data
        try {
            data = JSON.parse(text)
        } catch (err) {
            this.showError(`JSON parse error: ${err.message}`)
            return
        }

        if (mode === 'emit') {
            this.emit(SGCJ_EVENTS.JSON_PARSED, { objectId, data })
        } else {
            // mode="render" — formatted <pre> block
            const pre = this.$('#pre')
            if (pre) {
                pre.textContent = JSON.stringify(data, null, 2)
            }
        }
    }
}

if (!customElements.get('sg-content-json')) {
    customElements.define('sg-content-json', SgContentJson)
}

export { SgContentJson }
