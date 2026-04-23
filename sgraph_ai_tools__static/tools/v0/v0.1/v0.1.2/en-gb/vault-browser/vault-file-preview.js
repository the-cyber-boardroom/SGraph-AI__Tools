/**
 * <vault-file-preview> — Displays decrypted file content with download support.
 *
 * Methods:
 *   showFile(name, data)  — Display file content (data = ArrayBuffer)
 *   hide()                — Close the preview
 */
export class VaultFilePreview extends HTMLElement {

    connectedCallback() {
        this._fileData = null
        this._fileName = null

        this.innerHTML = `
            <style>
                vault-file-preview { display: none; }
                vault-file-preview.visible { display: block; }

                vault-file-preview .vfp-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 0.5rem;
                }
                vault-file-preview .vfp-title {
                    font-size: 0.9375rem;
                    font-weight: 600;
                    word-break: break-all;
                }
                vault-file-preview .vfp-size {
                    color: var(--sg-text-dim);
                    font-size: 0.75rem;
                    font-family: var(--sg-font-mono);
                    margin-left: 1rem;
                    white-space: nowrap;
                }
                vault-file-preview .vfp-content {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 1rem;
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                    line-height: 1.6;
                    max-height: 600px;
                    overflow: auto;
                    white-space: pre-wrap;
                    word-break: break-word;
                }
                vault-file-preview .vfp-actions {
                    margin-top: 0.75rem;
                    display: flex;
                    gap: 0.5rem;
                }
            </style>
            <div class="vfp-header">
                <span class="vfp-title" id="vfp-title"></span>
                <span class="vfp-size"  id="vfp-size"></span>
            </div>
            <div class="vfp-content" id="vfp-content"></div>
            <div class="vfp-actions">
                <button class="btn btn--secondary" id="vfp-download">Download</button>
                <button class="btn btn--secondary" id="vfp-close">Close</button>
            </div>`

        this.querySelector('#vfp-download').addEventListener('click', () => this._download())
        this.querySelector('#vfp-close').addEventListener('click', () => this.hide())
    }

    showFile(name, data) {
        this._fileData = data
        this._fileName = name

        this.querySelector('#vfp-title').textContent = name
        this.querySelector('#vfp-size').textContent  = this._formatBytes(data.byteLength)

        const content = this.querySelector('#vfp-content')
        const bytes   = new Uint8Array(data)

        if (this._isText(name, bytes)) {
            content.textContent = new TextDecoder().decode(data)
        } else if (this._isImage(name)) {
            const blob = new Blob([data], { type: this._mimeType(name) })
            const url  = URL.createObjectURL(blob)
            content.innerHTML = `<img src="${url}" style="max-width:100%;border-radius:4px;" alt="${this._esc(name)}">`
        } else {
            content.textContent = `[Binary file — ${this._formatBytes(data.byteLength)}]\nClick "Download" to save.`
        }

        this.classList.add('visible')
    }

    hide() {
        this.classList.remove('visible')
        this._fileData = null
        this._fileName = null
    }

    _download() {
        if (!this._fileData || !this._fileName) return
        const blob = new Blob([this._fileData])
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = this._fileName
        a.click()
        URL.revokeObjectURL(url)
    }

    _formatBytes(n) {
        if (n < 1024) return `${n} B`
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
        return `${(n / (1024 * 1024)).toFixed(1)} MB`
    }

    _isText(name, bytes) {
        const exts = ['.txt','.md','.json','.js','.py','.html','.css','.xml','.csv','.yaml','.yml','.toml','.ini','.cfg','.sh','.bat','.log','.rst','.env']
        if (exts.some(ext => name.toLowerCase().endsWith(ext))) return true
        if (bytes.length > 0 && bytes.length < 500_000) {
            const sample = bytes.slice(0, Math.min(512, bytes.length))
            return sample.every(b => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126) || b >= 128)
        }
        return false
    }

    _isImage(name) {
        return /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(name)
    }

    _mimeType(name) {
        const ext = name.split('.').pop().toLowerCase()
        const map = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp', ico:'image/x-icon' }
        return map[ext] || 'application/octet-stream'
    }

    _esc(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    }
}

customElements.define('vault-file-preview', VaultFilePreview)
