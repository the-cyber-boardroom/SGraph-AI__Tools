/**
 * ved-file-viewer — custom element that renders a vault file's content.
 *
 * Receives `state: { entry, vault }` via `setLayoutState()` (called by sg-layout
 * when the panel is instantiated). Fetches + decrypts the blob, sniffs content
 * type, and renders appropriately.
 *
 * @module ved-file-viewer
 */

import { readObject } from '/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js'

const STYLES = `
:host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: #0f172a;
    color: #e2e8f0;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 0.85rem;
}

.viewer-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 1rem;
}

.msg {
    color: #64748b;
    font-style: italic;
    font-size: 0.85rem;
    margin: 0;
}

.err {
    color: #fca5a5;
    background: rgba(239,68,68,0.08);
    border: 1px solid rgba(239,68,68,0.25);
    border-radius: 4px;
    padding: 0.6rem 0.85rem;
    font-size: 0.82rem;
}

pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 0.78rem;
    line-height: 1.6;
    color: #cbd5e1;
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(148,163,184,0.12);
    border-radius: 6px;
    padding: 1rem;
}

img {
    max-width: 100%;
    border-radius: 4px;
    display: block;
}

.md-body {
    line-height: 1.7;
    color: #e2e8f0;
}

.md-body h1, .md-body h2, .md-body h3 {
    color: #f1f5f9;
    margin: 1.2em 0 0.5em;
}

.md-body code {
    background: rgba(255,255,255,0.07);
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    font-size: 0.88em;
}

.md-body pre {
    background: rgba(0,0,0,0.35);
}

.md-body a { color: #00ffaa; }

.binary-msg {
    color: #94a3b8;
    font-size: 0.85rem;
}
`

/** PNG magic bytes */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]
/** JPEG magic bytes */
const JPEG_MAGIC = [0xff, 0xd8, 0xff]
/** GIF magic bytes */
const GIF_MAGIC_87 = [0x47, 0x49, 0x46, 0x38, 0x37]
const GIF_MAGIC_89 = [0x47, 0x49, 0x46, 0x38, 0x39]
/** WebP bytes at offset 8 */
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46]

/**
 * @param {Uint8Array} bytes
 * @param {string} name filename for extension sniff
 * @returns {string} MIME type
 */
function sniffType(bytes, name) {
    const startsWith = (magic, off = 0) => magic.every((b, i) => bytes[off + i] === b)

    if (startsWith(PNG_MAGIC))  return 'image/png'
    if (startsWith(JPEG_MAGIC)) return 'image/jpeg'
    if (startsWith(GIF_MAGIC_87) || startsWith(GIF_MAGIC_89)) return 'image/gif'
    if (startsWith(WEBP_RIFF) && bytes.length > 12 && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'

    const ext = (name || '').split('.').pop().toLowerCase()
    if (ext === 'md' || ext === 'markdown') return 'text/markdown'
    if (ext === 'json') return 'application/json'
    if (ext === 'js') return 'text/javascript'
    if (ext === 'html' || ext === 'htm') return 'text/html'
    if (ext === 'css') return 'text/css'
    if (ext === 'sh' || ext === 'bash') return 'text/x-sh'
    if (ext === 'txt') return 'text/plain'

    // Try UTF-8 decode to detect JSON
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, 512))
        const trimmed = text.trimStart()
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'application/json'
        return 'text/plain'
    } catch {
        return 'application/octet-stream'
    }
}

class VedFileViewer extends HTMLElement {
    constructor() {
        super()
        this._shadow = this.attachShadow({ mode: 'open' })
        /** @type {string|null} */
        this._blobUrl = null
    }

    connectedCallback() {
        this._showMsg('No file loaded.')
    }

    disconnectedCallback() {
        this._revokeBlobUrl()
    }

    /**
     * Called by sg-layout when this panel is activated with state.
     * @param {{ entry: object, vault: object }} state
     */
    setLayoutState({ entry, vault }) {
        this._load(entry, vault)
    }

    /** @param {string} text */
    _showMsg(text) {
        this._shadow.innerHTML = `<style>${STYLES}</style><div class="viewer-wrap"><p class="msg">${text}</p></div>`
    }

    /** @param {string} text */
    _showErr(text) {
        this._shadow.innerHTML = `<style>${STYLES}</style><div class="viewer-wrap"><p class="err">${text}</p></div>`
    }

    _revokeBlobUrl() {
        if (this._blobUrl) {
            URL.revokeObjectURL(this._blobUrl)
            this._blobUrl = null
        }
    }

    /**
     * @param {object} entry vault tree entry with blob_id + name
     * @param {object} vault vault handle
     */
    async _load(entry, vault) {
        this._revokeBlobUrl()
        this._showMsg('Fetching…')

        try {
            const buf = await readObject(vault.apiBaseUrl, vault.keys.vaultId, entry.blob_id, vault.keys.readKey)
            const bytes = new Uint8Array(buf)
            const mime = sniffType(bytes, entry.name || '')

            this._shadow.innerHTML = `<style>${STYLES}</style>`
            const wrap = document.createElement('div')
            wrap.className = 'viewer-wrap'

            if (mime.startsWith('image/')) {
                const blob = new Blob([bytes], { type: mime })
                this._blobUrl = URL.createObjectURL(blob)
                const img = document.createElement('img')
                img.src = this._blobUrl
                img.alt = entry.name || 'image'
                wrap.appendChild(img)

            } else if (mime === 'application/json') {
                const text = new TextDecoder().decode(bytes)
                const pre = document.createElement('pre')
                try {
                    pre.textContent = JSON.stringify(JSON.parse(text), null, 2)
                } catch {
                    pre.textContent = text
                }
                wrap.appendChild(pre)

            } else if (mime === 'text/markdown') {
                const text = new TextDecoder().decode(bytes)
                try {
                    const mod = await import('/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js')
                    const div = document.createElement('div')
                    div.className = 'md-body'
                    div.innerHTML = mod.renderMarkdown(text)
                    wrap.appendChild(div)
                } catch {
                    // Fallback to plain text if markdown module unavailable
                    const pre = document.createElement('pre')
                    pre.textContent = text
                    wrap.appendChild(pre)
                }

            } else if (mime.startsWith('text/') || mime === 'text/javascript') {
                const text = new TextDecoder().decode(bytes)
                const pre = document.createElement('pre')
                pre.textContent = text
                wrap.appendChild(pre)

            } else {
                const p = document.createElement('p')
                p.className = 'binary-msg'
                p.textContent = `Binary file (${mime}, ${bytes.length} bytes)`
                wrap.appendChild(p)
            }

            this._shadow.appendChild(wrap)
        } catch (err) {
            this._showErr(`Failed to load file: ${err.message}`)
        }
    }
}

customElements.define('ved-file-viewer', VedFileViewer)
