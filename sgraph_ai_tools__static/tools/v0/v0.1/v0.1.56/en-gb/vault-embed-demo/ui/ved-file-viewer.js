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

/* ── Metadata bar ── */
.meta-bar {
    flex-shrink: 0;
    background: #1e293b;
    border-bottom: 1px solid rgba(148,163,184,0.15);
    padding: 0.55rem 0.85rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.1rem;
    font-size: 0.72rem;
    font-family: ui-monospace, 'SF Mono', monospace;
    color: #94a3b8;
}

.meta-bar .meta-name {
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-weight: 700;
    font-size: 0.8rem;
    color: #e2e8f0;
    width: 100%;
    margin-bottom: 0.1rem;
}

.meta-bar .meta-pair { display: flex; gap: 0.3em; }
.meta-bar .meta-key { color: #64748b; }
.meta-bar .meta-val { color: #cbd5e1; word-break: break-all; }

.meta-bar .meta-url {
    width: 100%;
    display: flex;
    gap: 0.3em;
}

.badge-ro {
    display: inline-block;
    background: rgba(0,255,170,0.1);
    border: 1px solid rgba(0,255,170,0.3);
    color: #00ffaa;
    border-radius: 3px;
    padding: 0 0.4em;
    font-size: 0.68rem;
    letter-spacing: 0.03em;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    align-self: center;
}

/* ── Full-panel PDF / page-layout containers ── */
.pdf-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}
.pdf-wrap iframe {
    flex: 1;
    border: none;
    display: block;
    width: 100%;
}
.page-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 1rem;
}
`

/** PNG magic bytes */
const PNG_MAGIC  = [0x89, 0x50, 0x4e, 0x47]
/** JPEG magic bytes */
const JPEG_MAGIC = [0xff, 0xd8, 0xff]
/** GIF magic bytes */
const GIF_MAGIC_87 = [0x47, 0x49, 0x46, 0x38, 0x37]
const GIF_MAGIC_89 = [0x47, 0x49, 0x46, 0x38, 0x39]
/** WebP bytes at offset 8 */
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46]
/** PDF magic: %PDF */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]

/**
 * AES-256-GCM decrypt. Used for presigned-URL downloads where we fetch
 * raw encrypted bytes and need to decrypt without going through readObject().
 * Format: first 12 bytes = IV, remainder = ciphertext.
 * @param {CryptoKey} cryptoKey
 * @param {ArrayBuffer} encryptedBuf
 * @returns {Promise<ArrayBuffer>}
 */
/**
 * AES-256-GCM decrypt for presigned-URL downloads.
 * Format: first 12 bytes = IV, remainder = ciphertext.
 * @param {CryptoKey}    cryptoKey
 * @param {ArrayBuffer}  encryptedBuf
 * @returns {Promise<ArrayBuffer>}
 */
async function decryptAesGcm(cryptoKey, encryptedBuf) {
    const enc = new Uint8Array(encryptedBuf)
    const iv  = enc.slice(0, 12)
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, enc.slice(12))
}

/**
 * Returns true when the file name or parsed JSON matches the _page.json schema.
 * @param {string} name filename
 * @param {string} text raw text content
 * @returns {boolean}
 */
function isPageJson(name, text) {
    if (name === '_page.json') return true
    try {
        const o = JSON.parse(text)
        return o && typeof o === 'object' && Array.isArray(o.components) && !!o.theme
    } catch { return false }
}

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
    if (startsWith(PDF_MAGIC))  return 'application/pdf'

    const ext = (name || '').split('.').pop().toLowerCase()
    if (ext === 'pdf')                    return 'application/pdf'
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

    /**
     * Dispatch a vault-fetch trace event on document.
     * @param {string} name event type
     * @param {object} detail
     */
    _emit(name, detail) {
        document.dispatchEvent(new CustomEvent(name, { detail, bubbles: false }))
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

        const { vaultId } = vault.keys
        const blobId      = entry.blob_id
        const storagePath = `bare/data/${blobId}`
        const apiUrl      = `${vault.apiBaseUrl}/api/vault/read/${vaultId}/${encodeURIComponent(storagePath)}`

        this._emit('sg-vault-fetch:fetch-started', { vaultId, objectId: blobId, url: apiUrl })

        const t0 = performance.now()
        try {
            let buf
            try {
                buf = await readObject(vault.apiBaseUrl, vaultId, blobId, vault.keys.readKey)
            } catch (directErr) {
                const isGatewayError = /502|413|504/.test(directErr.message)
                if (!isGatewayError) throw directErr
                // Fallback: presigned URL for large files (bypasses API gateway limits)
                const presignedApiUrl = `${vault.apiBaseUrl}/api/vault/presigned/read-url/${vaultId}/${encodeURIComponent(`bare/data/${blobId}`)}`
                this._emit('sg-vault-fetch:fetch-started', {
                    vaultId, objectId: blobId, url: presignedApiUrl,
                })
                buf = await this._fetchViaPresigned(vault.apiBaseUrl, vaultId, blobId, vault.keys.readKey)
            }

            const fetchMs = performance.now() - t0
            const bytes   = new Uint8Array(buf)

            this._emit('sg-vault-fetch:fetch-completed', {
                vaultId, objectId: blobId, url: apiUrl,
                bytesReceived: bytes.length, fetchMs, cacheHit: false,
            })
            this._emit('sg-vault-fetch:decrypt-completed', {
                vaultId, objectId: blobId,
                plaintextBytes: bytes.length, decryptMs: 0,
            })

            const mime = sniffType(bytes, entry.name || '')
            this._emit('sg-vault-fetch:content-ready', { objectId: blobId, contentType: mime })

            await this._render({ ...entry, _endpoint: vault.apiBaseUrl }, bytes, mime, storagePath, apiUrl, fetchMs)
        } catch (err) {
            this._emit('sg-vault-fetch:fetch-error', {
                vaultId, objectId: blobId, url: apiUrl, error: err.message,
            })
            this._showErr(`Failed to load file: ${err.message}`)
        }
    }

    /**
     * Render metadata bar + file content into shadow DOM.
     * @param {object}     entry
     * @param {Uint8Array} bytes
     * @param {string}     mime
     * @param {string}     storagePath
     * @param {string}     apiUrl
     * @param {number}     loadMs
     */
    async _render(entry, bytes, mime, storagePath, apiUrl, loadMs) {
        this._shadow.innerHTML = `<style>${STYLES}</style>`

        // ── Metadata bar ──────────────────────────────────────────────────────
        const bar = document.createElement('div')
        bar.className = 'meta-bar'

        const mp = (key, val) => {
            const d = document.createElement('div')
            d.className = 'meta-pair'
            d.innerHTML = `<span class="meta-key">${key}:</span><span class="meta-val">${val}</span>`
            return d
        }

        const nameEl = document.createElement('div')
        nameEl.className = 'meta-name'
        nameEl.textContent = entry.name || 'File'
        bar.appendChild(nameEl)

        bar.appendChild(mp('blob_id', entry.blob_id))
        bar.appendChild(mp('storage_path', storagePath))
        bar.appendChild(mp('type', mime))
        bar.appendChild(mp('size', `${bytes.length.toLocaleString()} bytes`))
        bar.appendChild(mp('load', `${loadMs.toFixed(0)}ms`))

        const urlRow = document.createElement('div')
        urlRow.className = 'meta-url'
        urlRow.innerHTML = `<span class="meta-key">api_url:</span><span class="meta-val">${apiUrl}</span>`
        bar.appendChild(urlRow)

        const badge = document.createElement('span')
        badge.className = 'badge-ro'
        badge.textContent = 'read-only'
        bar.appendChild(badge)

        this._shadow.appendChild(bar)

        // ── Content area ──────────────────────────────────────────────────────
        const wrap = document.createElement('div')
        wrap.className = 'viewer-wrap'

        if (mime === 'application/pdf') {
            const blob = new Blob([bytes], { type: 'application/pdf' })
            this._blobUrl = URL.createObjectURL(blob)
            const pdfWrap = document.createElement('div')
            pdfWrap.className = 'pdf-wrap'
            const iframe = document.createElement('iframe')
            iframe.src   = this._blobUrl
            iframe.title = entry.name || 'PDF'
            pdfWrap.appendChild(iframe)
            this._shadow.appendChild(pdfWrap)
            return  // pdf-wrap replaces viewer-wrap

        } else if (mime.startsWith('image/')) {
            const blob = new Blob([bytes], { type: mime })
            this._blobUrl = URL.createObjectURL(blob)
            const img = document.createElement('img')
            img.src = this._blobUrl
            img.alt = entry.name || 'image'
            wrap.appendChild(img)

        } else if (mime === 'application/json') {
            const text = new TextDecoder().decode(bytes)
            if (isPageJson(entry.name || '', text)) {
                const pageWrap = document.createElement('div')
                pageWrap.className = 'page-wrap'
                try {
                    const renderer = await this._loadPageRenderer(entry._endpoint)
                    const json = JSON.parse(text)
                    renderer.render(pageWrap, json, '', null, null)
                } catch (e) {
                    pageWrap.textContent = `_page.json render failed: ${e.message}`
                }
                wrap.appendChild(pageWrap)
            } else {
                const pre  = document.createElement('pre')
                try { pre.textContent = JSON.stringify(JSON.parse(text), null, 2) }
                catch { pre.textContent = text }
                wrap.appendChild(pre)
            }

        } else if (mime === 'text/markdown') {
            const text = new TextDecoder().decode(bytes)
            try {
                const mod = await import('/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js')
                const div = document.createElement('div')
                div.className = 'md-body'
                div.innerHTML = mod.renderMarkdown(text)
                wrap.appendChild(div)
            } catch {
                const pre = document.createElement('pre')
                pre.textContent = text
                wrap.appendChild(pre)
            }

        } else if (mime.startsWith('text/') || mime === 'text/javascript') {
            const text = new TextDecoder().decode(bytes)
            const pre  = document.createElement('pre')
            pre.textContent = text
            wrap.appendChild(pre)

        } else {
            const p = document.createElement('p')
            p.className = 'binary-msg'
            p.textContent = `Binary file (${mime}, ${bytes.length.toLocaleString()} bytes)`
            wrap.appendChild(p)
        }

        this._shadow.appendChild(wrap)
    }

    /**
     * Fetch encrypted bytes via a presigned S3 URL.
     *
     * Step 1: GET /api/vault/presigned/read-url/{vaultId}/{encodedPath}
     *         — no auth headers needed; backend signs the S3 URL itself.
     *         Returns { url, expires_in } (may also use key 'presigned_url').
     * Step 2: Plain GET {url} → raw IV-prepended AES-256-GCM ciphertext.
     * Step 3: Decrypt locally with the read key.
     *
     * @param {string}    apiBaseUrl
     * @param {string}    vaultId
     * @param {string}    blobId
     * @param {CryptoKey} cryptoKey
     * @returns {Promise<ArrayBuffer>} decrypted content
     */
    async _fetchViaPresigned(apiBaseUrl, vaultId, blobId, cryptoKey) {
        const storagePath  = `bare/data/${blobId}`
        const presignedApi = `${apiBaseUrl}/api/vault/presigned/read-url/${vaultId}/${encodeURIComponent(storagePath)}`

        const resp = await fetch(presignedApi)   // no auth headers — URL is self-signed
        if (!resp.ok) throw new Error(`Presigned endpoint returned ${resp.status}`)

        const data = await resp.json()
        const url  = data.url || data.presigned_url
        if (!url) throw new Error('No URL in presigned response')

        const s3 = await fetch(url)              // plain GET to S3, no headers
        if (!s3.ok) throw new Error(`S3 fetch failed: ${s3.status}`)

        return decryptAesGcm(cryptoKey, await s3.arrayBuffer())
    }

    /**
     * Dynamically load PageLayoutRenderer from CDN (idempotent).
     * @param {string} endpoint base URL of the SG/Send server
     * @returns {Promise<object>} the global PageLayoutRenderer
     */
    async _loadPageRenderer(endpoint) {
        if (typeof PageLayoutRenderer !== 'undefined') return PageLayoutRenderer
        const base = (endpoint || 'https://send.sgraph.ai').replace(/\/$/, '')
        await new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = `${base}/_common/js/page-layout-renderer.js`
            s.onload  = resolve
            s.onerror = () => reject(new Error(`Could not load PageLayoutRenderer from ${base}`))
            document.head.appendChild(s)
        })
        if (!document.querySelector('link[href*="page-layout"]')) {
            const link = document.createElement('link')
            link.rel  = 'stylesheet'
            link.href = `${base}/_common/js/components/send-download/send-browse-v031--page-layout.css`
            document.head.appendChild(link)
        }
        return PageLayoutRenderer
    }
}

customElements.define('ved-file-viewer', VedFileViewer)
