/**
 * sg-infographic-export — Download / copy-to-clipboard / share controls for
 * a generated infographic image.
 *
 * Hidden until setSource() is called with a valid image src.
 *
 * API:
 *   setSource(imgSrc: string, filename?: string)
 *     — Reveal the controls and associate them with the given image.
 *
 * Attributes:
 *   filename — default download filename (default: 'infographic.png')
 *
 * @module sg-infographic-export
 * @version 0.1.0
 */

import '/components/send-drop/v1/v1.0/v1.0.0/sg-send-drop.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Convert any image src (data: URL or https: URL) to a PNG Blob via Canvas.
 * @param {string} src
 * @returns {Promise<Blob>}
 */
async function imgSrcToBlob(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width  = img.naturalWidth  || img.width;
            canvas.height = img.naturalHeight || img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);
            canvas.toBlob(
                b => b ? resolve(b) : reject(new Error('Canvas toBlob failed')),
                'image/png',
            );
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = src;
    });
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const STYLES = `
:host {
    display: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
:host([active]) { display: block; }

.actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 6px;
}

button {
    width: 100%;
    border-radius: 4px;
    padding: 7px 0;
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.15s;
}
button:hover { opacity: 0.85; }
button:disabled { opacity: 0.5; cursor: default; }

.btn-download {
    background: #1a1a3a;
    color: #4ECDC4;
    border: 1px solid #4ECDC4;
}
.btn-copy, .btn-share {
    background: #1a1a3a;
    color: #a0aec0;
    border: 1px solid #2a2a4a;
}

#send-drop-wrap {
    display: none;
    width: 100%;
    margin-bottom: 6px;
}
#send-drop-wrap.visible { display: block; }
`;

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * <sg-infographic-export> — Export controls for a generated infographic.
 */
export class SgInfographicExport extends HTMLElement {

    static jsUrl = import.meta.url;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._src      = null;
        this._filename = 'infographic.png';
    }

    connectedCallback() {
        this._render();
    }

    _render() {
        this.shadowRoot.innerHTML = `<style>${STYLES}</style>
<div class="actions">
  <button class="btn-download" id="download-btn">⬇ Download PNG</button>
  <button class="btn-copy"     id="copy-btn">⎘ Copy to Clipboard</button>
  <button class="btn-share"    id="share-btn">↗ Share via SG/Send</button>
</div>
<div id="send-drop-wrap">
  <sg-send-drop id="send-drop"></sg-send-drop>
</div>`;

        this._downloadBtn  = this.shadowRoot.getElementById('download-btn');
        this._copyBtn      = this.shadowRoot.getElementById('copy-btn');
        this._shareBtn     = this.shadowRoot.getElementById('share-btn');
        this._sendDropWrap = this.shadowRoot.getElementById('send-drop-wrap');
        this._sendDrop     = this.shadowRoot.getElementById('send-drop');

        this._downloadBtn.addEventListener('click', () => this._onDownload());
        this._copyBtn.addEventListener('click',     () => this._onCopy());
        this._shareBtn.addEventListener('click',    () => this._onShare());
    }

    // ── Public API ───────────────────────────────────────────────────────────────

    /**
     * Activate the export controls and associate them with an image.
     * @param {string} imgSrc   - data: URL or https: URL of the infographic
     * @param {string} [filename] - Optional filename override for download/share
     */
    setSource(imgSrc, filename) {
        this._src      = imgSrc;
        this._filename = filename || this.getAttribute('filename') || 'infographic.png';

        const isSvg = this._filename.endsWith('.svg');
        this._downloadBtn.textContent = isSvg ? '⬇ Download SVG' : '⬇ Download PNG';

        // Reset share state each time a new image arrives
        this._sendDropWrap.classList.remove('visible');
        this._shareBtn.style.display = '';

        this.setAttribute('active', '');
    }

    // ── Private handlers ─────────────────────────────────────────────────────────

    _onDownload() {
        if (!this._src) return;
        const a      = document.createElement('a');
        a.href       = this._src;
        a.download   = this._filename;
        a.click();
    }

    async _onCopy() {
        if (!this._src) return;
        const btn = this._copyBtn;
        btn.textContent = '…';
        btn.disabled    = true;
        try {
            const blob = await imgSrcToBlob(this._src);
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            btn.textContent = '✓ Copied!';
            setTimeout(() => { btn.textContent = '⎘ Copy to Clipboard'; btn.disabled = false; }, 2000);
        } catch {
            btn.textContent = 'Copy failed';
            setTimeout(() => { btn.textContent = '⎘ Copy to Clipboard'; btn.disabled = false; }, 2000);
        }
    }

    async _onShare() {
        if (!this._src) return;
        this._sendDropWrap.classList.add('visible');
        this._shareBtn.style.display = 'none';
        try {
            const blob = await imgSrcToBlob(this._src);
            this._sendDrop.offerFile(blob, this._filename);
        } catch {
            this._sendDropWrap.classList.remove('visible');
            this._shareBtn.style.display = '';
        }
    }
}

customElements.define('sg-infographic-export', SgInfographicExport);
