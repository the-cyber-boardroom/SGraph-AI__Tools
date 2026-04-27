/**
 * <sg-vault-content> — one-line page surface for vault-embedded content.
 *
 * Convenience wrapper that internally composes <sg-vault-key>, <sg-vault-fetch>,
 * and a renderer from components/content/. Page authors use this surface
 * instead of wiring the primitives by hand.
 *
 * Usage:
 *   <sg-vault-content
 *       vault-id="abc12345"
 *       read-key="J3kRP7QyL..."
 *       object-id="obj-cas-imm-xyz999..."
 *       render="markdown">
 *   </sg-vault-content>
 *
 * Attributes:
 *   vault-id  — Vault ID (required)
 *   read-key  — base64url read key (required)
 *   object-id — obj-cas-imm-* ID (required)
 *   render    — "markdown" | "image" | "json" (required)
 *   endpoint  — API endpoint override (optional)
 *   inspect   — bool-attr: if present, renders an <sg-vault-trace> alongside
 *
 * @module sg-vault-content
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'

/** Auto-incrementing counter for generating unique internal element IDs */
let _counter = 0

const RENDERER_MAP = {
    markdown: '/components/content/sg-content-markdown/v0/v0.1/v0.1.0/sg-content-markdown.js',
    image:    '/components/content/sg-content-image/v0/v0.1/v0.1.0/sg-content-image.js',
    json:     '/components/content/sg-content-json/v0/v0.1/v0.1.0/sg-content-json.js',
}

const RENDERER_TAGS = {
    markdown: 'sg-content-markdown',
    image:    'sg-content-image',
    json:     'sg-content-json',
}

class SgVaultContent extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-vault-content' }

    async onReady() {
        const vaultId  = this.getAttribute('vault-id')
        const readKey  = this.getAttribute('read-key')
        const objectId = this.getAttribute('object-id')
        const render   = this.getAttribute('render') || 'markdown'
        const endpoint = this.getAttribute('endpoint') || ''
        const inspect  = this.hasAttribute('inspect')

        if (!vaultId || !readKey || !objectId) {
            this.showError('sg-vault-content: vault-id, read-key, and object-id are required')
            return
        }

        const rendererTag = RENDERER_TAGS[render]
        if (!rendererTag) {
            this.showError(`sg-vault-content: unknown render mode "${render}". Use markdown, image, or json.`)
            return
        }

        const n      = ++_counter
        const keyId  = `__sgvc-key-${n}`
        const fetchId = `__sgvc-fetch-${n}`

        // ── Load component modules ─────────────────────────────────────────
        await Promise.all([
            import('/components/vault-embed/sg-vault-key/v0/v0.1/v0.1.0/sg-vault-key.js'),
            import('/components/vault-embed/sg-vault-fetch/v0/v0.1/v0.1.0/sg-vault-fetch.js'),
            import(RENDERER_MAP[render]),
            inspect ? import('/components/vault-embed/sg-vault-trace/v0/v0.1/v0.1.0/sg-vault-trace.js') : Promise.resolve(),
        ])

        // ── Build shadow DOM ───────────────────────────────────────────────
        // Components are inserted into the host document (not shadow root)
        // so that document.getElementById resolves key-source and content-source.
        // The renderer and optional trace are placed in the shadow root for visual output.

        const keyEl = document.createElement('sg-vault-key')
        keyEl.id = keyId
        keyEl.setAttribute('vault-id', vaultId)
        keyEl.setAttribute('read-key', readKey)
        if (endpoint) keyEl.setAttribute('endpoint', endpoint)

        const fetchEl = document.createElement('sg-vault-fetch')
        fetchEl.id = fetchId
        fetchEl.setAttribute('key-source', keyId)
        fetchEl.setAttribute('object-id', objectId)

        // Append logical elements to host (invisible)
        this.appendChild(keyEl)
        this.appendChild(fetchEl)

        // Renderer goes in shadow root
        const rendererEl = document.createElement(rendererTag)
        rendererEl.setAttribute('content-source', fetchId)
        this.shadowRoot.appendChild(rendererEl)

        if (inspect) {
            const traceEl = document.createElement('sg-vault-trace')
            this.shadowRoot.appendChild(traceEl)
        }
    }
}

if (!customElements.get('sg-vault-content')) {
    customElements.define('sg-vault-content', SgVaultContent)
}

export { SgVaultContent }
