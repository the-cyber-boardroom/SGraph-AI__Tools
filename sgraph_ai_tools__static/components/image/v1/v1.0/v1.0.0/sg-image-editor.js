/**
 * sg-image-editor — Main image editor Web Component (orchestrator)
 *
 * Composes sg-image core functions with crop, redact, and text sub-components
 * to provide a full non-destructive image editing workflow.
 *
 * @module sg-image-editor
 * @version 1.0.0
 */

import { getImageInfo, supportsAvif, renderOperations, exportImage, flattenTransparency }
    from '/core/image/v1/v1.0/v1.0.0/sg-image.js';

import './sg-image-crop.js';
import './sg-image-redact.js';
import './sg-image-text.js';

const COMPONENT_URL = new URL(import.meta.url);
const CSS_URL = new URL('./sg-image-editor.css', COMPONENT_URL).href;

/** Format display names and MIME types */
const FORMATS = [
    { key: 'png',  label: 'PNG',  mime: 'image/png',  lossy: false },
    { key: 'jpg',  label: 'JPG',  mime: 'image/jpeg', lossy: true },
    { key: 'webp', label: 'WebP', mime: 'image/webp', lossy: true },
    { key: 'avif', label: 'AVIF', mime: 'image/avif', lossy: true },
];

/** Resize presets */
const RESIZE_PRESETS = [
    { label: 'HD',     w: 1920, h: 1080 },
    { label: 'Thumb',  w: 150,  h: 150 },
    { label: 'Social', w: 1200, h: 630 },
    { label: '50%',    pct: 50 },
    { label: '25%',    pct: 25 },
];

/**
 * Format a byte count as a human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Derive a sensible output filename from the original name and target format.
 *
 * @param {string} originalName
 * @param {string} formatKey — 'png', 'jpg', 'webp', 'avif'
 * @returns {string}
 */
function deriveFilename(originalName, formatKey) {
    const base = originalName.replace(/\.[^.]+$/, '') || 'image';
    const ext = formatKey === 'jpg' ? 'jpg' : formatKey;
    return `${base}.${ext}`;
}

/**
 * <sg-image-editor> — Full image editor with toolbar, preview, and operations pipeline.
 *
 * Usage:
 *   const editor = document.createElement('sg-image-editor');
 *   document.body.appendChild(editor);
 *   editor.loadImage(fileFromInput);
 *
 * @fires sg-image-export — { blob, filename }
 * @fires sg-image-change — emitted when operations change
 */
export class SgImageEditor extends HTMLElement {
    /** @type {HTMLImageElement|null} Original loaded image */
    #original = null;

    /** @type {string} Original filename */
    #filename = '';

    /** @type {{ width: number, height: number, format: string, size: number }} */
    #imageInfo = null;

    /** @type {Array<{ type: string, [key: string]: any }>} */
    #operations = [];

    /** @type {string} Output format key */
    #outputFormat = 'png';

    /** @type {number} Output quality 0-1 */
    #outputQuality = 0.92;

    /** @type {string|null} Active tool name */
    #activeTool = null;

    /** @type {boolean} Aspect ratio locked for resize */
    #resizeLocked = true;

    /** @type {boolean} AVIF support flag */
    #avifSupported = false;

    /** DOM references */
    #containerEl = null;
    #previewWrapper = null;
    #previewCanvas = null;
    #toolbarEl = null;
    #panelEl = null;
    #opsEl = null;
    #exportEl = null;
    #infoEl = null;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.#avifSupported = supportsAvif();
    }

    connectedCallback() {
        this.#renderShell();
    }

    /**
     * Load a File, display preview, and show the toolbar.
     *
     * @param {File} file
     * @returns {Promise<void>}
     */
    async loadImage(file) {
        const info = await getImageInfo(file);
        this.#original = info.image;
        this.#filename = file.name || 'image';
        this.#imageInfo = {
            width: info.width,
            height: info.height,
            format: info.format,
            size: info.size,
        };
        this.#operations = [];
        this.#activeTool = null;

        // Auto-detect output format from input
        const mimeMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' };
        this.#outputFormat = mimeMap[info.format] || 'png';

        this.#renderShell();
        await this.#updatePreview();
    }

    /**
     * Reset to initial empty state.
     */
    reset() {
        this.#original = null;
        this.#filename = '';
        this.#imageInfo = null;
        this.#operations = [];
        this.#activeTool = null;
        this.#renderShell();
    }

    /** Render the main shell (called once and on state changes). */
    #renderShell() {
        const hasImage = this.#original !== null;

        this.shadowRoot.innerHTML = `
            <link rel="stylesheet" href="${CSS_URL}">
            <div class="sg-editor-container">
                ${hasImage ? this.#renderInfoBar() : ''}
                ${hasImage ? this.#renderToolbar() : ''}
                <div class="sg-editor-preview">
                    ${hasImage
                        ? '<div class="sg-preview-wrapper"><canvas></canvas></div>'
                        : '<div class="sg-editor-empty">Load an image to begin editing</div>'
                    }
                </div>
                ${hasImage ? `<div class="sg-editor-panel hidden"></div>` : ''}
                ${hasImage ? this.#renderOps() : ''}
                ${hasImage ? this.#renderExport() : ''}
            </div>
        `;

        this.#containerEl = this.shadowRoot.querySelector('.sg-editor-container');
        this.#previewWrapper = this.shadowRoot.querySelector('.sg-preview-wrapper');
        this.#previewCanvas = this.shadowRoot.querySelector('.sg-editor-preview canvas');
        this.#toolbarEl = this.shadowRoot.querySelector('.sg-editor-toolbar');
        this.#panelEl = this.shadowRoot.querySelector('.sg-editor-panel');
        this.#opsEl = this.shadowRoot.querySelector('.sg-editor-operations');
        this.#exportEl = this.shadowRoot.querySelector('.sg-editor-export');
        this.#infoEl = this.shadowRoot.querySelector('.sg-editor-info');

        if (hasImage) {
            this.#bindToolbar();
            this.#bindOps();
            this.#bindExport();
        }
    }

    /** @returns {string} HTML for the info bar */
    #renderInfoBar() {
        const info = this.#imageInfo;
        const currentDims = this.#getCurrentDimensions();
        return `
            <div class="sg-editor-info">
                <span><span class="sg-info-label">File</span> ${this.#escapeHtml(this.#filename)}</span>
                <span><span class="sg-info-label">Original</span> ${info.width} x ${info.height}</span>
                <span><span class="sg-info-label">Current</span> ${currentDims.width} x ${currentDims.height}</span>
                <span><span class="sg-info-label">Size</span> ${formatSize(info.size)}</span>
                <span><span class="sg-info-label">Format</span> ${info.format}</span>
            </div>
        `;
    }

    /** @returns {string} HTML for the toolbar */
    #renderToolbar() {
        const tools = ['Convert', 'Resize', 'Crop', 'Redact', 'Text'];
        return `
            <div class="sg-editor-toolbar">
                ${tools.map(t =>
                    `<button data-tool="${t.toLowerCase()}" class="${this.#activeTool === t.toLowerCase() ? 'active' : ''}">${t}</button>`
                ).join('')}
            </div>
        `;
    }

    /** @returns {string} HTML for the operations tag list */
    #renderOps() {
        if (this.#operations.length === 0) return '<div class="sg-editor-operations"></div>';
        return `
            <div class="sg-editor-operations">
                ${this.#operations.map((op, i) =>
                    `<span class="sg-op-tag">${this.#opLabel(op)} <button class="sg-op-remove" data-idx="${i}">\u00d7</button></span>`
                ).join('')}
            </div>
        `;
    }

    /** @returns {string} HTML for export / action buttons */
    #renderExport() {
        return `
            <div class="sg-editor-export">
                <button class="sg-download-btn">Download</button>
                <button class="sg-undo-btn"${this.#operations.length === 0 ? ' disabled' : ''}>Undo Last</button>
                <button class="sg-reset-btn"${this.#operations.length === 0 ? ' disabled' : ''}>Start Over</button>
            </div>
        `;
    }

    /**
     * Get a display label for an operation.
     *
     * @param {{ type: string, [key: string]: any }} op
     * @returns {string}
     */
    #opLabel(op) {
        switch (op.type) {
            case 'crop':
                return `Crop ${op.width}\u00d7${op.height}`;
            case 'resize':
                return `Resize ${op.width}\u00d7${op.height}`;
            case 'redact': {
                const n = op.regions.length;
                return `Redact ${n} region${n !== 1 ? 's' : ''}`;
            }
            case 'text':
                return `Text "${op.text.substring(0, 15)}${op.text.length > 15 ? '...' : ''}"`;
            default:
                return op.type;
        }
    }

    /** Bind toolbar button click events. */
    #bindToolbar() {
        if (!this.#toolbarEl) return;
        this.#toolbarEl.querySelectorAll('button').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                if (this.#activeTool === tool) {
                    this.#activeTool = null;
                    this.#panelEl.classList.add('hidden');
                    this.#panelEl.innerHTML = '';
                    btn.classList.remove('active');
                } else {
                    this.#activeTool = tool;
                    this.#toolbarEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.#showPanel(tool);
                }
            });
        });
    }

    /** Bind operation tag remove buttons. */
    #bindOps() {
        if (!this.#opsEl) return;
        this.#opsEl.querySelectorAll('.sg-op-remove').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const idx = parseInt(btn.dataset.idx, 10);
                this.#operations.splice(idx, 1);
                await this.#onOperationsChanged();
            });
        });
    }

    /** Bind export / undo / reset buttons. */
    #bindExport() {
        if (!this.#exportEl) return;

        this.#exportEl.querySelector('.sg-download-btn').addEventListener('click', () => this.#doExport());

        const undoBtn = this.#exportEl.querySelector('.sg-undo-btn');
        undoBtn.addEventListener('click', async () => {
            if (this.#operations.length > 0) {
                this.#operations.pop();
                await this.#onOperationsChanged();
            }
        });

        const resetBtn = this.#exportEl.querySelector('.sg-reset-btn');
        resetBtn.addEventListener('click', async () => {
            this.#operations = [];
            await this.#onOperationsChanged();
        });
    }

    /**
     * Show the panel for a given tool.
     *
     * @param {string} tool
     */
    #showPanel(tool) {
        if (!this.#panelEl) return;
        this.#panelEl.classList.remove('hidden');

        switch (tool) {
            case 'convert':
                this.#showConvertPanel();
                break;
            case 'resize':
                this.#showResizePanel();
                break;
            case 'crop':
                this.#panelEl.classList.add('hidden');
                this.#showCropOverlay();
                break;
            case 'redact':
                this.#panelEl.classList.add('hidden');
                this.#showRedactOverlay();
                break;
            case 'text':
                this.#panelEl.classList.add('hidden');
                this.#showTextOverlay();
                break;
            default:
                this.#panelEl.classList.add('hidden');
        }
    }

    // --- Convert Panel ---

    #showConvertPanel() {
        const formats = FORMATS.filter(f => f.key !== 'avif' || this.#avifSupported);
        const currentFormat = formats.find(f => f.key === this.#outputFormat) || formats[0];
        const isLossy = currentFormat.lossy;

        this.#panelEl.innerHTML = `
            <h3>Convert Format</h3>
            <div class="sg-panel-row">
                <label>Format</label>
                ${formats.map(f =>
                    `<button class="sg-format-btn${f.key === this.#outputFormat ? ' active' : ''}" data-format="${f.key}">${f.label}</button>`
                ).join('')}
            </div>
            <div class="sg-panel-row sg-quality-row" ${isLossy ? '' : 'style="display:none"'}>
                <label>Quality</label>
                <input type="range" min="0.1" max="1.0" step="0.01" value="${this.#outputQuality}" class="sg-quality-slider">
                <span class="sg-quality-value">${Math.round(this.#outputQuality * 100)}%</span>
            </div>
            <div class="sg-panel-row">
                <span class="sg-panel-size-estimate"></span>
            </div>
        `;

        // Format buttons
        this.#panelEl.querySelectorAll('.sg-format-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.#outputFormat = btn.dataset.format;
                this.#panelEl.querySelectorAll('.sg-format-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const fmt = formats.find(f => f.key === this.#outputFormat);
                const qualityRow = this.#panelEl.querySelector('.sg-quality-row');
                if (fmt && fmt.lossy) {
                    qualityRow.style.display = '';
                } else {
                    qualityRow.style.display = 'none';
                }
                this.#estimateSize();
            });
        });

        // Quality slider
        const slider = this.#panelEl.querySelector('.sg-quality-slider');
        const valueLabel = this.#panelEl.querySelector('.sg-quality-value');
        slider.addEventListener('input', () => {
            this.#outputQuality = parseFloat(slider.value);
            valueLabel.textContent = `${Math.round(this.#outputQuality * 100)}%`;
            this.#estimateSize();
        });

        this.#estimateSize();
    }

    /** Estimate output size and display it. */
    async #estimateSize() {
        if (!this.#previewCanvas || !this.#panelEl) return;
        const estimateEl = this.#panelEl.querySelector('.sg-panel-size-estimate');
        if (!estimateEl) return;

        try {
            const fmt = FORMATS.find(f => f.key === this.#outputFormat);
            if (!fmt) return;

            let canvas = this.#previewCanvas;
            if (fmt.mime === 'image/jpeg') {
                canvas = flattenTransparency(canvas);
            }

            const blob = await exportImage(canvas, fmt.mime, this.#outputQuality);
            estimateEl.textContent = `Estimated size: ${formatSize(blob.size)}`;
        } catch {
            estimateEl.textContent = '';
        }
    }

    // --- Resize Panel ---

    #showResizePanel() {
        const dims = this.#getCurrentDimensions();
        const aspectRatio = dims.width / dims.height;

        this.#panelEl.innerHTML = `
            <h3>Resize</h3>
            <div class="sg-panel-row">
                <label>Width</label>
                <input type="number" class="sg-resize-w" value="${dims.width}" min="1" max="10000">
                <button class="sg-lock-btn ${this.#resizeLocked ? 'locked' : ''}" title="Lock aspect ratio">${this.#resizeLocked ? '\ud83d\udd12' : '\ud83d\udd13'}</button>
                <label>Height</label>
                <input type="number" class="sg-resize-h" value="${dims.height}" min="1" max="10000">
            </div>
            <div class="sg-panel-row">
                <label>Presets</label>
                ${RESIZE_PRESETS.map(p =>
                    `<button class="sg-preset-btn" data-label="${p.label}" data-w="${p.w || ''}" data-h="${p.h || ''}" data-pct="${p.pct || ''}">${p.label}</button>`
                ).join('')}
            </div>
            <div class="sg-panel-row">
                <button class="sg-resize-apply active">Apply Resize</button>
            </div>
        `;

        const wInput = this.#panelEl.querySelector('.sg-resize-w');
        const hInput = this.#panelEl.querySelector('.sg-resize-h');
        const lockBtn = this.#panelEl.querySelector('.sg-lock-btn');

        // Width change
        wInput.addEventListener('input', () => {
            if (this.#resizeLocked) {
                hInput.value = Math.round(parseInt(wInput.value, 10) / aspectRatio);
            }
        });

        // Height change
        hInput.addEventListener('input', () => {
            if (this.#resizeLocked) {
                wInput.value = Math.round(parseInt(hInput.value, 10) * aspectRatio);
            }
        });

        // Lock toggle
        lockBtn.addEventListener('click', () => {
            this.#resizeLocked = !this.#resizeLocked;
            lockBtn.classList.toggle('locked', this.#resizeLocked);
            lockBtn.textContent = this.#resizeLocked ? '\ud83d\udd12' : '\ud83d\udd13';
        });

        // Preset buttons
        this.#panelEl.querySelectorAll('.sg-preset-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.dataset.pct) {
                    const pct = parseInt(btn.dataset.pct, 10) / 100;
                    wInput.value = Math.round(dims.width * pct);
                    hInput.value = Math.round(dims.height * pct);
                } else {
                    wInput.value = btn.dataset.w;
                    if (this.#resizeLocked) {
                        hInput.value = Math.round(parseInt(btn.dataset.w, 10) / aspectRatio);
                    } else {
                        hInput.value = btn.dataset.h;
                    }
                }
            });
        });

        // Apply
        this.#panelEl.querySelector('.sg-resize-apply').addEventListener('click', async () => {
            const w = parseInt(wInput.value, 10);
            const h = parseInt(hInput.value, 10);
            if (w > 0 && h > 0) {
                this.#operations.push({ type: 'resize', width: w, height: h });
                await this.#onOperationsChanged();
            }
        });
    }

    // --- Crop Overlay ---

    #showCropOverlay() {
        if (!this.#previewWrapper || !this.#previewCanvas) return;

        const cropEl = document.createElement('sg-image-crop');
        cropEl.attach(this.#previewCanvas);

        cropEl.addEventListener('sg-crop-apply', async (e) => {
            const { x, y, width, height } = /** @type {CustomEvent} */ (e).detail;
            this.#operations.push({ type: 'crop', x, y, width, height });
            this.#activeTool = null;
            await this.#onOperationsChanged();
        });

        cropEl.addEventListener('sg-crop-cancel', () => {
            this.#activeTool = null;
            this.#toolbarEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        });
    }

    // --- Redact Overlay ---

    #showRedactOverlay() {
        if (!this.#previewWrapper || !this.#previewCanvas) return;

        const redactEl = document.createElement('sg-image-redact');
        redactEl.attach(this.#previewCanvas);

        redactEl.addEventListener('sg-redact-apply', async (e) => {
            const { regions } = /** @type {CustomEvent} */ (e).detail;
            if (regions.length > 0) {
                this.#operations.push({ type: 'redact', regions });
            }
            this.#activeTool = null;
            await this.#onOperationsChanged();
        });

        redactEl.addEventListener('sg-redact-cancel', () => {
            this.#activeTool = null;
            this.#toolbarEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        });
    }

    // --- Text Overlay ---

    #showTextOverlay() {
        if (!this.#previewWrapper || !this.#previewCanvas) return;

        const textEl = document.createElement('sg-image-text');
        textEl.attach(this.#previewCanvas);

        textEl.addEventListener('sg-text-apply', async (e) => {
            const detail = /** @type {CustomEvent} */ (e).detail;
            this.#operations.push({
                type: 'text',
                text: detail.text,
                x: detail.x,
                y: detail.y,
                fontSize: detail.fontSize,
                fontFamily: detail.fontFamily,
                color: detail.color,
                align: detail.align,
                bold: detail.bold,
                italic: detail.italic,
                outline: detail.outline,
            });
            this.#activeTool = null;
            await this.#onOperationsChanged();
        });

        textEl.addEventListener('sg-text-cancel', () => {
            this.#activeTool = null;
            this.#toolbarEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        });
    }

    // --- Preview Update ---

    /** Re-render the preview canvas from original + operations. */
    async #updatePreview() {
        if (!this.#original || !this.#previewCanvas) return;

        const result = renderOperations(this.#original, this.#operations);

        this.#previewCanvas.width = result.width;
        this.#previewCanvas.height = result.height;

        const ctx = this.#previewCanvas.getContext('2d');
        ctx.drawImage(result, 0, 0);
    }

    /**
     * Called whenever operations array changes. Re-renders everything.
     */
    async #onOperationsChanged() {
        this.#renderShell();
        await this.#updatePreview();

        this.dispatchEvent(new CustomEvent('sg-image-change', {
            bubbles: true,
            composed: true,
        }));
    }

    // --- Export ---

    /** Export the final image and trigger download. */
    async #doExport() {
        if (!this.#original) return;

        const fmt = FORMATS.find(f => f.key === this.#outputFormat);
        if (!fmt) return;

        let canvas = renderOperations(this.#original, this.#operations);

        // Flatten transparency for JPEG
        if (fmt.mime === 'image/jpeg') {
            canvas = flattenTransparency(canvas);
        }

        const blob = await exportImage(canvas, fmt.mime, this.#outputQuality);
        const filename = deriveFilename(this.#filename, this.#outputFormat);

        this.dispatchEvent(new CustomEvent('sg-image-export', {
            bubbles: true,
            composed: true,
            detail: { blob, filename },
        }));

        // Also trigger browser download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // --- Utility ---

    /**
     * Get the current effective dimensions after all operations.
     *
     * @returns {{ width: number, height: number }}
     */
    #getCurrentDimensions() {
        if (!this.#original) {
            return { width: 0, height: 0 };
        }
        const canvas = renderOperations(this.#original, this.#operations);
        return { width: canvas.width, height: canvas.height };
    }

    /**
     * Escape HTML entities for safe insertion into innerHTML.
     *
     * @param {string} str
     * @returns {string}
     */
    #escapeHtml(str) {
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    }
}

customElements.define('sg-image-editor', SgImageEditor);
