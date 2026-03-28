/**
 * <sg-send-drop> — Share-via-SG/Send Web Component.
 *
 * Drop a file (or pass a blob programmatically) and it handles the full
 * upload flow: generate simple token → SGMETA envelope → encrypt →
 * 3-step API upload → display token + copy/link/open.
 *
 * @module sg-send-drop
 * @version 1.0.0
 */

import { uploadFile } from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-upload.js';
import { isFriendlyToken } from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-crypto.js';

const STATES = Object.freeze({
    IDLE:       'idle',
    READY:      'ready',
    AUTH:       'auth',
    PROCESSING: 'processing',
    COMPLETE:   'complete',
    ERROR:      'error',
});

/** Auto-detect the SG/Send URL based on the current hostname. */
function detectSendUrl() {
    const host = globalThis.location?.hostname ?? '';
    if (host.startsWith('dev.'))  return 'https://dev.send.sgraph.ai';
    if (host.startsWith('main.')) return 'https://main.send.sgraph.ai';
    if (host === 'localhost' || host === '127.0.0.1') return 'https://dev.send.sgraph.ai';
    return 'https://send.sgraph.ai';
}

/** Format bytes to human-readable string. */
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Share-via-SG/Send drop zone component.
 * @export
 */
export class SgSendDrop extends HTMLElement {
    /** @type {string|null} */
    #accessToken = null;

    /** @type {string} */
    #state = STATES.IDLE;

    /** @type {Blob|null} */
    #pendingBlob = null;

    /** @type {string} */
    #pendingFilename = '';

    /** @type {{ token: string, transferId: string, url: string }|null} */
    #result = null;

    /** @type {string|null} */
    #errorMessage = null;

    /** @type {ShadowRoot} */
    #shadow;

    constructor() {
        super();
        this.#shadow = this.attachShadow({ mode: 'open' });
    }

    static get observedAttributes() {
        return ['send-url', 'label', 'auto-upload', 'disabled'];
    }

    connectedCallback() {
        this.#render();
        this.#bindDragDrop();
    }

    attributeChangedCallback() {
        if (this.#shadow.childNodes.length > 0) {
            this.#render();
        }
    }

    /** @returns {string} */
    get sendUrl() {
        return this.getAttribute('send-url') || detectSendUrl();
    }

    /** @returns {string} */
    get label() {
        return this.getAttribute('label') || 'Share via SG/Send';
    }

    /** @returns {boolean} */
    get autoUpload() {
        return this.hasAttribute('auto-upload');
    }

    /**
     * Set the SG/Send access token for API authentication.
     * @param {string} token
     */
    setAccessToken(token) {
        this.#accessToken = token;
    }

    /**
     * Programmatically offer a file for sharing.
     * @param {Blob} blob - The file data
     * @param {string} filename - Display name for the file
     */
    offerFile(blob, filename) {
        this.#pendingBlob = blob;
        this.#pendingFilename = filename;
        if (this.autoUpload) {
            this.#startUpload();
        } else {
            this.#setState(STATES.READY);
        }
    }

    /**
     * Programmatically offer multiple files (will be zipped before upload).
     * @param {Array<{ blob: Blob, filename: string }>} files
     * @param {string} [zipName='files.zip']
     */
    async offerFiles(files, zipName = 'files.zip') {
        if (files.length === 1) {
            this.offerFile(files[0].blob, files[0].filename);
            return;
        }
        // Lazy-load JSZip
        const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
        const zip = new JSZip();
        for (const f of files) {
            zip.file(f.filename, f.blob);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        this.offerFile(blob, zipName);
    }

    /** Reset the component to its initial state. */
    reset() {
        this.#pendingBlob = null;
        this.#pendingFilename = '';
        this.#result = null;
        this.#errorMessage = null;
        this.#setState(STATES.IDLE);
    }

    // ── Internal ──────────────────────────────────────────

    #setState(state) {
        this.#state = state;
        this.#render();
    }

    async #startUpload() {
        if (!this.#pendingBlob) return;

        // Check for access token
        if (!this.#accessToken) {
            // Try localStorage (same-origin only)
            const stored = globalThis.localStorage?.getItem('sgraph-send-token');
            if (stored) {
                this.#accessToken = stored;
            } else {
                this.#setState(STATES.AUTH);
                this.dispatchEvent(new CustomEvent('sg-send-auth-required', { bubbles: true }));
                return;
            }
        }

        this.#setState(STATES.PROCESSING);
        this.dispatchEvent(new CustomEvent('sg-send-start', {
            bubbles: true,
            detail: { filename: this.#pendingFilename, size: this.#pendingBlob.size },
        }));

        try {
            this.#result = await uploadFile(
                this.#pendingBlob,
                this.#pendingFilename,
                this.sendUrl,
                this.#accessToken,
                (progress) => {
                    this.#updateProgress(progress);
                    this.dispatchEvent(new CustomEvent('sg-send-progress', {
                        bubbles: true,
                        detail: progress,
                    }));
                },
            );

            this.#setState(STATES.COMPLETE);
            this.dispatchEvent(new CustomEvent('sg-send-complete', {
                bubbles: true,
                detail: this.#result,
            }));
        } catch (err) {
            this.#errorMessage = err.message || 'Upload failed';
            this.#setState(STATES.ERROR);
            this.dispatchEvent(new CustomEvent('sg-send-error', {
                bubbles: true,
                detail: { error: err, message: this.#errorMessage },
            }));
        }
    }

    #updateProgress({ percent, stage }) {
        const fill = this.#shadow.querySelector('.sg-sd-progress-fill');
        const label = this.#shadow.querySelector('.sg-sd-progress-label');
        if (fill) fill.style.width = `${percent}%`;
        if (label) {
            const labels = {
                generating: 'Generating token...',
                packaging:  'Packaging file...',
                encrypting: 'Encrypting...',
                uploading:  'Uploading...',
                complete:   'Complete!',
            };
            label.textContent = labels[stage] || stage;
        }
    }

    #bindDragDrop() {
        const container = this.#shadow.querySelector('.sg-sd-container');
        if (!container) return;

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            container.classList.add('drag-over');
        });

        container.addEventListener('dragleave', () => {
            container.classList.remove('drag-over');
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            container.classList.remove('drag-over');
            if (this.hasAttribute('disabled')) return;
            if (this.#state !== STATES.IDLE && this.#state !== STATES.READY) return;

            const file = e.dataTransfer?.files?.[0];
            if (file) {
                this.offerFile(file, file.name);
            }
        });
    }

    #render() {
        const css = this.#shadow.adoptedStyleSheets?.length
            ? ''
            : `<link rel="stylesheet" href="/components/send-drop/v1/v1.0/v1.0.0/sg-send-drop.css">`;

        let content = '';

        switch (this.#state) {
            case STATES.IDLE:
                content = this.#renderIdle();
                break;
            case STATES.READY:
                content = this.#renderReady();
                break;
            case STATES.AUTH:
                content = this.#renderAuth();
                break;
            case STATES.PROCESSING:
                content = this.#renderProcessing();
                break;
            case STATES.COMPLETE:
                content = this.#renderComplete();
                break;
            case STATES.ERROR:
                content = this.#renderError();
                break;
        }

        const disabledClass = this.hasAttribute('disabled') ? ' disabled' : '';
        this.#shadow.innerHTML = `
            ${css}
            <div class="sg-sd-container${disabledClass}">
                ${content}
            </div>
        `;

        this.#bindDragDrop();
        this.#bindEvents();
    }

    #renderIdle() {
        return `<div class="sg-sd-idle-label">${this.label}</div>`;
    }

    #renderReady() {
        const size = this.#pendingBlob ? formatSize(this.#pendingBlob.size) : '';
        return `
            <div class="sg-sd-file-info">
                ${this.#pendingFilename}<span class="sg-sd-file-size">${size}</span>
            </div>
            <button class="sg-sd-btn sg-sd-btn-primary" data-action="upload">${this.label}</button>
        `;
    }

    #renderAuth() {
        return `
            <div class="sg-sd-auth-label">
                To share via SG/Send, enter your access token.<br>
                <a href="${this.sendUrl}" target="_blank" rel="noopener">Get one at ${this.sendUrl.replace('https://', '')}</a>
            </div>
            <input class="sg-sd-auth-input" type="text" placeholder="Access token" data-input="token">
            <div class="sg-sd-btn-row">
                <button class="sg-sd-btn sg-sd-btn-primary" data-action="auth-continue">Continue</button>
                <button class="sg-sd-btn" data-action="cancel">Cancel</button>
            </div>
        `;
    }

    #renderProcessing() {
        return `
            <div class="sg-sd-progress">
                <div class="sg-sd-progress-label">Starting...</div>
                <div class="sg-sd-progress-bar">
                    <div class="sg-sd-progress-fill" style="width: 0%"></div>
                </div>
            </div>
        `;
    }

    #renderComplete() {
        const r = this.#result;
        return `
            <div class="sg-sd-success-label">Shared!</div>
            <div class="sg-sd-token">${r.token}</div>
            <div class="sg-sd-url">${r.url}</div>
            <div class="sg-sd-btn-row">
                <button class="sg-sd-btn" data-action="copy-token" title="Copy token to clipboard">Copy Token</button>
                <button class="sg-sd-btn" data-action="copy-link" title="Copy full URL to clipboard">Copy Link</button>
                <button class="sg-sd-btn sg-sd-btn-primary" data-action="open" title="Open in SG/Send">Open in SG/Send</button>
            </div>
            <div class="sg-sd-btn-row" style="margin-top: 0.5rem">
                <button class="sg-sd-btn" data-action="reset">Share Another</button>
            </div>
        `;
    }

    #renderError() {
        return `
            <div class="sg-sd-error-label">Upload failed</div>
            <div class="sg-sd-error-msg">${this.#errorMessage}</div>
            <div class="sg-sd-btn-row">
                <button class="sg-sd-btn sg-sd-btn-primary" data-action="retry">Retry</button>
                <button class="sg-sd-btn" data-action="reset">Cancel</button>
            </div>
        `;
    }

    #bindEvents() {
        this.#shadow.querySelectorAll('[data-action]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                switch (action) {
                    case 'upload':
                        this.#startUpload();
                        break;
                    case 'auth-continue': {
                        const input = this.#shadow.querySelector('[data-input="token"]');
                        const val = input?.value?.trim();
                        if (val) {
                            this.#accessToken = val;
                            this.#startUpload();
                        }
                        break;
                    }
                    case 'copy-token':
                        if (this.#result) {
                            navigator.clipboard.writeText(this.#result.token).catch(() => {});
                            e.currentTarget.textContent = 'Copied!';
                            setTimeout(() => { e.currentTarget.textContent = 'Copy Token'; }, 1500);
                        }
                        break;
                    case 'copy-link':
                        if (this.#result) {
                            navigator.clipboard.writeText(this.#result.url).catch(() => {});
                            e.currentTarget.textContent = 'Copied!';
                            setTimeout(() => { e.currentTarget.textContent = 'Copy Link'; }, 1500);
                        }
                        break;
                    case 'open':
                        if (this.#result) {
                            globalThis.open(this.#result.url, '_blank', 'noopener');
                        }
                        break;
                    case 'retry':
                        this.#startUpload();
                        break;
                    case 'reset':
                        this.reset();
                        break;
                    case 'cancel':
                        this.#setState(STATES.READY);
                        break;
                }
            });
        });
    }
}

customElements.define('sg-send-drop', SgSendDrop);
