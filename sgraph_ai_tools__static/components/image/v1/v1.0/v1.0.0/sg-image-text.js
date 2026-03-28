/**
 * sg-image-text — Text placement overlay Web Component
 *
 * Provides an interactive overlay for placing and styling text on a preview canvas.
 * Click to place anchor, configure font/color/size, then apply.
 *
 * @module sg-image-text
 * @version 1.0.0
 */

const COMPONENT_URL = new URL(import.meta.url);
const CSS_URL = new URL('./sg-image-text.css', COMPONENT_URL).href;

/** Font family mappings */
const FONT_FAMILIES = {
    Sans:  "system-ui, -apple-system, sans-serif",
    Serif: "Georgia, 'Times New Roman', serif",
    Mono:  "'Courier New', Consolas, monospace",
};

/**
 * <sg-image-text> — Interactive text placement overlay for an image canvas.
 *
 * Usage:
 *   const textEl = document.createElement('sg-image-text');
 *   textEl.attach(previewCanvas);
 *   textEl.addEventListener('sg-text-apply', e => console.log(e.detail));
 *
 * @fires sg-text-apply — detail: { text, x, y, fontSize, fontFamily, color, align, bold, italic, outline }
 * @fires sg-text-cancel — user cancelled
 */
export class SgImageText extends HTMLElement {
    /** @type {HTMLCanvasElement|null} */
    #targetCanvas = null;

    /** Text placement state */
    #anchor = null; // { x, y } in display coords
    #textItems = [];

    /** Current text configuration */
    #config = {
        text: '',
        fontSize: 32,
        fontFamily: FONT_FAMILIES.Sans,
        fontFamilyKey: 'Sans',
        color: '#ffffff',
        align: 'left',
        bold: false,
        italic: false,
        outline: true,
    };

    /** DOM refs */
    #overlayEl = null;
    #controlsEl = null;
    #anchorEl = null;
    #previewTextEl = null;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.#render();
    }

    /**
     * Attach this text overlay on top of a preview canvas.
     *
     * @param {HTMLCanvasElement} previewCanvas
     */
    attach(previewCanvas) {
        this.#targetCanvas = previewCanvas;
        this.#anchor = null;
        this.#textItems = [];

        const parent = previewCanvas.parentElement;
        if (parent && !parent.contains(this)) {
            parent.appendChild(this);
        }

        this.#render();
    }

    /**
     * Remove the text overlay.
     */
    detach() {
        this.#targetCanvas = null;
        this.#anchor = null;
        if (this.parentElement) {
            this.parentElement.removeChild(this);
        }
    }

    /**
     * Get all text items in image coordinates.
     *
     * @returns {Array<{ text: string, x: number, y: number, fontSize: number, fontFamily: string, color: string, align: string, bold: boolean, italic: boolean, outline: boolean }>}
     */
    getTextItems() {
        return this.#textItems.map(item => this.#toImageCoords(item));
    }

    #render() {
        this.shadowRoot.innerHTML = `
            <link rel="stylesheet" href="${CSS_URL}">
            <div class="sg-text-overlay">
                <div class="sg-text-anchor" style="display:none"></div>
                <div class="sg-text-preview" style="display:none"></div>
                <div class="sg-text-controls">
                    <div class="sg-text-row">
                        <label>Text</label>
                        <input type="text" class="sg-text-input" placeholder="Click image to place, then type..." value="">
                    </div>
                    <div class="sg-text-row">
                        <label>Size</label>
                        <input type="range" class="sg-text-size" min="12" max="200" value="${this.#config.fontSize}">
                        <span class="sg-text-size-value">${this.#config.fontSize}</span>
                    </div>
                    <div class="sg-text-row">
                        <label>Font</label>
                        <button class="sg-font-btn active" data-font="Sans">Sans</button>
                        <button class="sg-font-btn" data-font="Serif">Serif</button>
                        <button class="sg-font-btn" data-font="Mono">Mono</button>
                        <div class="sg-text-separator"></div>
                        <input type="color" class="sg-text-color" value="${this.#config.color}">
                    </div>
                    <div class="sg-text-row">
                        <label>Style</label>
                        <button class="sg-style-btn sg-bold-btn" data-style="bold">B</button>
                        <button class="sg-style-btn sg-italic-btn" data-style="italic"><em>I</em></button>
                        <div class="sg-text-separator"></div>
                        <button class="sg-align-btn active" data-align="left">L</button>
                        <button class="sg-align-btn" data-align="center">C</button>
                        <button class="sg-align-btn" data-align="right">R</button>
                        <div class="sg-text-separator"></div>
                        <button class="sg-style-btn sg-outline-btn active" data-style="outline">Outline</button>
                    </div>
                    <div class="sg-text-row">
                        <button class="sg-text-apply">Apply</button>
                        <button class="sg-text-cancel">Cancel</button>
                    </div>
                </div>
            </div>
        `;

        this.#overlayEl = this.shadowRoot.querySelector('.sg-text-overlay');
        this.#controlsEl = this.shadowRoot.querySelector('.sg-text-controls');
        this.#anchorEl = this.shadowRoot.querySelector('.sg-text-anchor');
        this.#previewTextEl = this.shadowRoot.querySelector('.sg-text-preview');

        this.#bindEvents();
    }

    #bindEvents() {
        // Click on overlay to place anchor
        this.#overlayEl.addEventListener('pointerdown', (e) => {
            // Ignore clicks on controls
            if (e.target.closest('.sg-text-controls')) return;
            this.#placeAnchor(e);
        });

        // Text input
        const textInput = this.shadowRoot.querySelector('.sg-text-input');
        textInput.addEventListener('input', () => {
            this.#config.text = textInput.value;
            this.#updatePreview();
        });

        // Font size slider
        const sizeSlider = this.shadowRoot.querySelector('.sg-text-size');
        const sizeValue = this.shadowRoot.querySelector('.sg-text-size-value');
        sizeSlider.addEventListener('input', () => {
            this.#config.fontSize = parseInt(sizeSlider.value, 10);
            sizeValue.textContent = `${this.#config.fontSize}`;
            this.#updatePreview();
        });

        // Font family buttons
        this.shadowRoot.querySelectorAll('.sg-font-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.shadowRoot.querySelectorAll('.sg-font-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.#config.fontFamilyKey = btn.dataset.font;
                this.#config.fontFamily = FONT_FAMILIES[btn.dataset.font];
                this.#updatePreview();
            });
        });

        // Color picker
        const colorInput = this.shadowRoot.querySelector('.sg-text-color');
        colorInput.addEventListener('input', () => {
            this.#config.color = colorInput.value;
            this.#updatePreview();
        });

        // Bold / Italic / Outline toggles
        this.shadowRoot.querySelector('.sg-bold-btn').addEventListener('click', (e) => {
            this.#config.bold = !this.#config.bold;
            e.currentTarget.classList.toggle('active', this.#config.bold);
            this.#updatePreview();
        });

        this.shadowRoot.querySelector('.sg-italic-btn').addEventListener('click', (e) => {
            this.#config.italic = !this.#config.italic;
            e.currentTarget.classList.toggle('active', this.#config.italic);
            this.#updatePreview();
        });

        this.shadowRoot.querySelector('.sg-outline-btn').addEventListener('click', (e) => {
            this.#config.outline = !this.#config.outline;
            e.currentTarget.classList.toggle('active', this.#config.outline);
            this.#updatePreview();
        });

        // Alignment buttons
        this.shadowRoot.querySelectorAll('.sg-align-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.shadowRoot.querySelectorAll('.sg-align-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.#config.align = btn.dataset.align;
                this.#updatePreview();
            });
        });

        // Apply / Cancel
        this.shadowRoot.querySelector('.sg-text-apply').addEventListener('click', () => this.#apply());
        this.shadowRoot.querySelector('.sg-text-cancel').addEventListener('click', () => this.#cancel());
    }

    /**
     * Place the text anchor at the pointer location.
     *
     * @param {PointerEvent} e
     */
    #placeAnchor(e) {
        const rect = this.#overlayEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.#anchor = { x, y };

        this.#anchorEl.style.display = '';
        this.#anchorEl.style.left = `${x}px`;
        this.#anchorEl.style.top = `${y}px`;

        this.#updatePreview();

        // Focus the text input
        const textInput = this.shadowRoot.querySelector('.sg-text-input');
        textInput.focus();
    }

    /** Update the live preview text on the overlay. */
    #updatePreview() {
        if (!this.#anchor || !this.#previewTextEl) return;

        const text = this.#config.text;
        if (!text) {
            this.#previewTextEl.style.display = 'none';
            return;
        }

        this.#previewTextEl.style.display = '';
        this.#previewTextEl.textContent = text;

        // Calculate the display font size by scaling from image coords to display coords
        let displayFontSize = this.#config.fontSize;
        if (this.#targetCanvas) {
            const scaleX = this.#targetCanvas.clientWidth / this.#targetCanvas.width;
            displayFontSize = this.#config.fontSize * scaleX;
        }

        const fontParts = [];
        if (this.#config.italic) fontParts.push('italic');
        if (this.#config.bold) fontParts.push('bold');
        fontParts.push(`${displayFontSize}px`);
        fontParts.push(this.#config.fontFamily);

        this.#previewTextEl.style.font = fontParts.join(' ');
        this.#previewTextEl.style.color = this.#config.color;
        this.#previewTextEl.style.textAlign = this.#config.align;
        this.#previewTextEl.style.left = `${this.#anchor.x}px`;
        this.#previewTextEl.style.top = `${this.#anchor.y}px`;

        if (this.#config.outline) {
            this.#previewTextEl.style.textShadow =
                '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000';
        } else {
            this.#previewTextEl.style.textShadow = 'none';
        }
    }

    /**
     * Map a text item from display coordinates to image coordinates.
     *
     * @param {{ text: string, x: number, y: number, fontSize: number, fontFamily: string, color: string, align: string, bold: boolean, italic: boolean, outline: boolean }} item
     * @returns {{ text: string, x: number, y: number, fontSize: number, fontFamily: string, color: string, align: string, bold: boolean, italic: boolean, outline: boolean }}
     */
    #toImageCoords(item) {
        if (!this.#targetCanvas) return { ...item };

        const displayW = this.#targetCanvas.clientWidth;
        const imgW = this.#targetCanvas.width;
        const scaleX = imgW / displayW;

        const displayH = this.#targetCanvas.clientHeight;
        const imgH = this.#targetCanvas.height;
        const scaleY = imgH / displayH;

        return {
            ...item,
            x: Math.round(item.x * scaleX),
            y: Math.round(item.y * scaleY),
            // fontSize is already in image coordinates, no scaling needed
        };
    }

    /** Emit sg-text-apply and detach. */
    #apply() {
        if (!this.#anchor || !this.#config.text) return;

        const item = {
            text: this.#config.text,
            x: this.#anchor.x,
            y: this.#anchor.y,
            fontSize: this.#config.fontSize,
            fontFamily: this.#config.fontFamily,
            color: this.#config.color,
            align: this.#config.align,
            bold: this.#config.bold,
            italic: this.#config.italic,
            outline: this.#config.outline,
        };

        this.#textItems.push(item);

        const imageItem = this.#toImageCoords(item);

        this.dispatchEvent(new CustomEvent('sg-text-apply', {
            bubbles: true,
            composed: true,
            detail: imageItem,
        }));
        this.detach();
    }

    /** Emit sg-text-cancel and detach. */
    #cancel() {
        this.dispatchEvent(new CustomEvent('sg-text-cancel', {
            bubbles: true,
            composed: true,
        }));
        this.detach();
    }
}

customElements.define('sg-image-text', SgImageText);
