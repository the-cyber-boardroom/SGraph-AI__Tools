/**
 * <sg-send-receive> — Receive a file from SG/Send using a friendly token.
 *
 * Paste a token (word-word-NNNN), click Receive, and the component handles
 * key derivation, download, decryption, and SGMETA unpacking — delivering
 * the original file as a Blob for download or programmatic use.
 *
 * Programmatic use:
 *   const result = await el.receive('brave-apple-0742');
 *   // result: { filename, blob, objectUrl, token, transferId }
 *
 * Events emitted (all bubble):
 *   sg-receive-start    { token }
 *   sg-receive-progress { percent, stage }
 *   sg-receive-complete { filename, blob, objectUrl, token, transferId }
 *   sg-receive-error    { error, message }
 *
 * Attributes:
 *   send-url    string   Override SG/Send base URL (auto-detected from hostname)
 *   token       string   Pre-fill the token input
 *   placeholder string   Input placeholder text
 *
 * @module sg-send-receive
 * @version 0.1.0
 */

import {
    isFriendlyToken,
    deriveTransferId,
    deriveKey,
} from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-crypto.js';

// ── SGMETA magic bytes: ASCII "SGMETA" ────────────────────────────────────────
const SGMETA_MAGIC = new Uint8Array([0x53, 0x47, 0x4D, 0x45, 0x54, 0x41]);

// ── States ────────────────────────────────────────────────────────────────────
const STATES = Object.freeze({
    IDLE:       'idle',
    PROCESSING: 'processing',
    COMPLETE:   'complete',
    ERROR:      'error',
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @returns {string} SG/Send base URL for current hostname */
function detectSendUrl() {
    const host = globalThis.location?.hostname ?? '';
    if (host.startsWith('dev.'))  return 'https://dev.send.sgraph.ai';
    if (host.startsWith('main.')) return 'https://main.send.sgraph.ai';
    if (host === 'localhost' || host === '127.0.0.1') return 'https://dev.send.sgraph.ai';
    return 'https://send.sgraph.ai';
}

/**
 * Decrypt AES-256-GCM ciphertext. Layout: IV (12 bytes) || ciphertext.
 * @param {ArrayBuffer} ciphertext
 * @param {CryptoKey}   key
 * @returns {Promise<Uint8Array>}
 */
async function decryptBytes(ciphertext, key) {
    const bytes   = new Uint8Array(ciphertext);
    const iv      = bytes.slice(0, 12);
    const data    = bytes.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new Uint8Array(plainBuf);
}

/**
 * Parse an SGMETA envelope and return the embedded filename + file bytes.
 *
 * Layout:
 *   [SGMETA magic — 6 bytes]
 *   [metadata-length — 4 bytes big-endian uint32]
 *   [JSON metadata — variable]
 *   [file bytes — remainder]
 *
 * @param {Uint8Array} plaintext
 * @returns {{ filename: string, fileBytes: Uint8Array }}
 */
function parseSgmeta(plaintext) {
    for (let i = 0; i < 6; i++) {
        if (plaintext[i] !== SGMETA_MAGIC[i]) throw new Error('Invalid SGMETA header — wrong token?');
    }
    const view    = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
    const metaLen = view.getUint32(6, false); // big-endian
    const metaJson = new TextDecoder().decode(plaintext.slice(10, 10 + metaLen));
    const meta     = JSON.parse(metaJson);
    const fileBytes = plaintext.slice(10 + metaLen);
    return { filename: meta.filename ?? 'received-file', fileBytes };
}

/** @param {number} bytes */
function formatSize(bytes) {
    if (bytes < 1024)              return `${bytes} B`;
    if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
    return String(s).replace(/"/g, '&quot;');
}

// ── Web Component ─────────────────────────────────────────────────────────────

/**
 * Receive side of the SG/Send workflow.
 * @export
 */
export class SgSendReceive extends HTMLElement {
    /** @type {string} */
    #state = STATES.IDLE;

    /** @type {ShadowRoot} */
    #shadow;

    /** @type {{ filename: string, blob: Blob, objectUrl: string, token: string, transferId: string }|null} */
    #result = null;

    /** @type {string|null} */
    #errorMessage = null;

    /** @type {string} */
    #token = '';

    constructor() {
        super();
        this.#shadow = this.attachShadow({ mode: 'open' });
    }

    static get observedAttributes() {
        return ['send-url', 'token', 'placeholder'];
    }

    connectedCallback() {
        this.#render();
    }

    disconnectedCallback() {
        if (this.#result?.objectUrl) URL.revokeObjectURL(this.#result.objectUrl);
    }

    attributeChangedCallback(name, _old, val) {
        if (name === 'token') this.#token = val || '';
        if (this.#shadow.childNodes.length > 0) this.#render();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** @returns {string} */
    get sendUrl() {
        return this.getAttribute('send-url') || detectSendUrl();
    }

    /** @returns {string} */
    get placeholder() {
        return this.getAttribute('placeholder') || 'word-word-0000';
    }

    /**
     * Programmatically receive a file by token.
     * Returns the same shape as the sg-receive-complete event detail.
     *
     * @param {string} [token]  Friendly token. Falls back to current input value.
     * @returns {Promise<{ filename: string, blob: Blob, objectUrl: string, token: string, transferId: string }>}
     */
    async receive(token) {
        const t = token
            || this.#shadow.querySelector('.sg-sr-input')?.value?.trim()
            || this.#token;

        if (!isFriendlyToken(t)) {
            throw new Error('Invalid token format. Expected word-word-NNNN');
        }
        await this.#startReceive(t);
        if (this.#state === STATES.ERROR) throw new Error(this.#errorMessage);
        return this.#result;
    }

    /**
     * Pre-fill the token input without triggering a receive.
     * @param {string} token
     */
    setToken(token) {
        this.#token = token;
        const input = this.#shadow.querySelector('.sg-sr-input');
        if (input) {
            input.value = token;
            this.#enableReceiveBtn();
        } else {
            this.#render();
        }
    }

    /** Reset to idle state. Revokes any object URL. */
    reset() {
        if (this.#result?.objectUrl) URL.revokeObjectURL(this.#result.objectUrl);
        this.#result       = null;
        this.#errorMessage = null;
        this.#token        = '';
        this.#state        = STATES.IDLE;
        this.#render();
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    #setState(s) {
        this.#state = s;
        this.#render();
    }

    #updateProgress(percent, stage) {
        const bar   = this.#shadow.querySelector('.sg-sr-progress-fill');
        const label = this.#shadow.querySelector('.sg-sr-progress-label');
        if (bar)   bar.style.width    = `${percent}%`;
        if (label) label.textContent  = stage;
    }

    #enableReceiveBtn() {
        const input = this.#shadow.querySelector('.sg-sr-input');
        const btn   = this.#shadow.querySelector('[data-action="receive"]');
        if (input && btn) btn.disabled = !isFriendlyToken(input.value.trim());
    }

    async #startReceive(token) {
        this.#setState(STATES.PROCESSING);

        const _progress = (percent, stage) => {
            this.#updateProgress(percent, stage);
            this.dispatchEvent(new CustomEvent('sg-receive-progress', {
                bubbles: true,
                detail:  { percent, stage },
            }));
        };

        this.dispatchEvent(new CustomEvent('sg-receive-start', {
            bubbles: true,
            detail:  { token },
        }));

        try {
            _progress(5, 'Deriving keys…');
            const [transferId, key] = await Promise.all([
                deriveTransferId(token),
                deriveKey(token),
            ]);

            _progress(20, 'Fetching encrypted file…');
            const res = await fetch(`${this.sendUrl}/api/transfers/download/${transferId}`);
            if (!res.ok) {
                throw new Error(`Server returned ${res.status} ${res.statusText}`);
            }

            _progress(55, 'Decrypting…');
            const ciphertext = await res.arrayBuffer();
            const plaintext  = await decryptBytes(ciphertext, key);

            _progress(85, 'Unpacking…');
            const { filename, fileBytes } = parseSgmeta(plaintext);
            const blob      = new Blob([fileBytes]);
            const objectUrl = URL.createObjectURL(blob);

            this.#result = { filename, blob, objectUrl, token, transferId };
            _progress(100, 'Complete!');

            this.#setState(STATES.COMPLETE);
            this.dispatchEvent(new CustomEvent('sg-receive-complete', {
                bubbles: true,
                detail:  this.#result,
            }));
        } catch (err) {
            this.#errorMessage = err.message || 'Receive failed';
            this.#setState(STATES.ERROR);
            this.dispatchEvent(new CustomEvent('sg-receive-error', {
                bubbles: true,
                detail:  { error: err, message: this.#errorMessage },
            }));
        }
    }

    #render() {
        const css     = `<link rel="stylesheet" href="/components/send-receive/v0/v0.1/v0.1.0/sg-send-receive.css">`;
        let   content = '';

        switch (this.#state) {
            case STATES.IDLE:       content = this.#renderIdle();       break;
            case STATES.PROCESSING: content = this.#renderProcessing(); break;
            case STATES.COMPLETE:   content = this.#renderComplete();   break;
            case STATES.ERROR:      content = this.#renderError();      break;
        }

        this.#shadow.innerHTML = `${css}<div class="sg-sr-container">${content}</div>`;
        this.#bindEvents();
    }

    #renderIdle() {
        const val = this.#token ? ` value="${escAttr(this.#token)}"` : '';
        return `
            <div class="sg-sr-label">Paste your token to receive the file</div>
            <input class="sg-sr-input" type="text"
                   placeholder="${escAttr(this.placeholder)}"
                   autocomplete="off" spellcheck="false"${val}>
            <button class="sg-sr-btn sg-sr-btn-primary" data-action="receive" disabled>
                📥 Receive File
            </button>
        `;
    }

    #renderProcessing() {
        return `
            <div class="sg-sr-progress">
                <div class="sg-sr-progress-label">Starting…</div>
                <div class="sg-sr-progress-bar">
                    <div class="sg-sr-progress-fill" style="width:0%"></div>
                </div>
            </div>
        `;
    }

    #renderComplete() {
        const r    = this.#result;
        const size = formatSize(r.blob.size);
        const isText = /\.(txt|md|json|csv|xml|html|js|ts|css|yaml|yml|toml|log|sh|py|rb|rs|go|java|c|h|cpp)$/i.test(r.filename);
        return `
            <div class="sg-sr-success">✓ Received</div>
            <div class="sg-sr-filename">
                ${escHtml(r.filename)}<span class="sg-sr-size">${size}</span>
            </div>
            <div class="sg-sr-btn-row">
                <a class="sg-sr-btn sg-sr-btn-primary"
                   href="${escAttr(r.objectUrl)}"
                   download="${escAttr(r.filename)}">⬇ Download</a>
                ${isText ? `<button class="sg-sr-btn" data-action="preview">👁 Preview</button>` : ''}
                <button class="sg-sr-btn" data-action="reset">Receive Another</button>
            </div>
        `;
    }

    #renderError() {
        return `
            <div class="sg-sr-error">Receive failed</div>
            <div class="sg-sr-error-msg">${escHtml(this.#errorMessage)}</div>
            <div class="sg-sr-btn-row">
                <button class="sg-sr-btn sg-sr-btn-primary" data-action="retry">Retry</button>
                <button class="sg-sr-btn" data-action="reset">Cancel</button>
            </div>
        `;
    }

    #bindEvents() {
        const input = this.#shadow.querySelector('.sg-sr-input');
        const btn   = this.#shadow.querySelector('[data-action="receive"]');

        if (input && btn) {
            const check = () => { btn.disabled = !isFriendlyToken(input.value.trim()); };
            input.addEventListener('input', check);
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') { check(); if (!btn.disabled) btn.click(); }
            });
            check();
        }

        this.#shadow.querySelectorAll('[data-action]').forEach(el => {
            el.addEventListener('click', async (e) => {
                const action = e.currentTarget.dataset.action;
                switch (action) {
                    case 'receive': {
                        const token = input?.value?.trim();
                        if (token) await this.#startReceive(token);
                        break;
                    }
                    case 'retry':
                        if (this.#result?.token) {
                            await this.#startReceive(this.#result.token);
                        } else {
                            this.#setState(STATES.IDLE);
                        }
                        break;
                    case 'reset':
                        this.reset();
                        break;
                    case 'preview':
                        if (this.#result?.objectUrl) {
                            window.open(this.#result.objectUrl, '_blank', 'noopener');
                        }
                        break;
                }
            });
        });
    }
}

customElements.define('sg-send-receive', SgSendReceive);
