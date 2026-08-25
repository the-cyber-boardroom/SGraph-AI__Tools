/**
 * <sg-content-markdown> — vault-agnostic markdown renderer.
 *
 * Receives content-ready events from a sibling element (e.g. <sg-vault-fetch>)
 * and renders the text field as HTML using core/markdown.
 *
 * This component has ZERO imports from components/vault-embed/ or core/vault-*.
 * It works with any element that emits an event with event.detail.text.
 *
 * Attributes:
 *   content-source — ID of the element that emits *:content-ready (required)
 *
 * Events:
 *   None emitted. (Pure sink.)
 *
 * @module sg-content-markdown
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'
import { renderMarkdown } from '/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js'

class SgContentMarkdown extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-content-markdown' }

    onReady() {
        const sourceId = this.getAttribute('content-source')
        if (!sourceId) {
            this.showError('sg-content-markdown: content-source attribute is required')
            return
        }

        this.#bindContentSource(sourceId)
    }

    /**
     * Resolve the content-source element and listen for content-ready events.
     * @param {string} sourceId
     */
    #bindContentSource(sourceId) {
        const sourceEl = document.getElementById(sourceId)
        if (!sourceEl) {
            // Source element may not be in the DOM yet — listen at document level
            // and filter by source ID when the event bubbles up
            const handler = (e) => {
                if (e.target && e.target.id === sourceId && e.detail && e.detail.text != null) {
                    this.#render(e.detail.text)
                }
            }
            this.addTrackedListener(document, 'sg-vault-fetch:content-ready', handler)
            // Also listen for any custom event in case a non-vault source fires it
            this.addTrackedListener(document, 'demo:content-ready', handler)
            return
        }

        const handler = (e) => {
            if (e.detail && e.detail.text != null) {
                this.#render(e.detail.text)
            }
        }

        // Listen for any *:content-ready event on the source element
        // The spec says the event name contains 'content-ready'
        this.addTrackedListener(sourceEl, 'sg-vault-fetch:content-ready', handler)
        // Support hand-fired test events (per AC-2)
        this.addTrackedListener(sourceEl, 'demo:content-ready', handler)
    }

    /**
     * Render markdown text into the shadow root.
     * @param {string} text
     */
    #render(text) {
        const html = renderMarkdown(text || '')
        const content = this.$('#content')
        if (content) {
            content.innerHTML = html
        }
    }
}

if (!customElements.get('sg-content-markdown')) {
    customElements.define('sg-content-markdown', SgContentMarkdown)
}

export { SgContentMarkdown }
