/**
 * sg-image-redact — Redaction overlay Web Component
 *
 * Provides an interactive overlay to draw rectangular redaction regions
 * on top of a preview canvas. Supports black-fill and pixelate modes.
 *
 * @module sg-image-redact
 * @version 1.0.0
 */

const COMPONENT_URL = new URL(import.meta.url);
const CSS_URL = new URL('./sg-image-redact.css', COMPONENT_URL).href;

/**
 * <sg-image-redact> — Interactive redaction overlay for an image canvas.
 *
 * Usage:
 *   const redactEl = document.createElement('sg-image-redact');
 *   redactEl.attach(previewCanvas);
 *   redactEl.setMode('blur');
 *   redactEl.addEventListener('sg-redact-apply', e => console.log(e.detail));
 *
 * @fires sg-redact-apply — { regions: [{ x, y, w, h, mode }] } in image coordinates
 * @fires sg-redact-cancel — user cancelled
 */
export class SgImageRedact extends HTMLElement {
    /** @type {HTMLCanvasElement|null} */
    #targetCanvas = null;

    /** @type {'black'|'blur'} */
    #mode = 'black';

    /**
     * Regions in display coordinates.
     * @type {Array<{ x: number, y: number, w: number, h: number, mode: string }>}
     */
    #regions = [];

    /** Drawing state */
    #drawing = false;
    #drawStart = { x: 0, y: 0 };
    #currentRect = null;

    /** DOM refs */
    #overlayEl = null;
    #controlsEl = null;
    #regionsContainer = null;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.#render();
    }

    /**
     * Attach this redact overlay on top of a preview canvas.
     *
     * @param {HTMLCanvasElement} previewCanvas
     */
    attach(previewCanvas) {
        this.#targetCanvas = previewCanvas;
        this.#regions = [];
        this.#currentRect = null;

        const parent = previewCanvas.parentElement;
        if (parent && !parent.contains(this)) {
            parent.appendChild(this);
        }

        this.#render();
    }

    /**
     * Remove the redact overlay.
     */
    detach() {
        this.#targetCanvas = null;
        this.#regions = [];
        if (this.parentElement) {
            this.parentElement.removeChild(this);
        }
    }

    /**
     * Set the redaction mode.
     *
     * @param {'black'|'blur'} mode
     */
    setMode(mode) {
        this.#mode = mode;
        this.#updateModeButtons();
    }

    /**
     * Get all regions in image coordinates.
     *
     * @returns {Array<{ x: number, y: number, w: number, h: number, mode: string }>}
     */
    getRegions() {
        return this.#regions.map(r => this.#toImageCoords(r));
    }

    /**
     * Remove all drawn regions.
     */
    clear() {
        this.#regions = [];
        this.#renderRegions();
    }

    #render() {
        this.shadowRoot.innerHTML = `
            <link rel="stylesheet" href="${CSS_URL}">
            <div class="sg-redact-overlay">
                <div class="sg-redact-regions"></div>
                <div class="sg-redact-controls">
                    <button class="sg-mode-btn active" data-mode="black">Black</button>
                    <button class="sg-mode-btn" data-mode="blur">Pixelate</button>
                    <div class="sg-redact-separator"></div>
                    <span class="sg-redact-count">0 regions</span>
                    <div class="sg-redact-separator"></div>
                    <button class="sg-redact-apply">Done</button>
                    <button class="sg-redact-cancel">Cancel</button>
                </div>
            </div>
        `;

        this.#overlayEl = this.shadowRoot.querySelector('.sg-redact-overlay');
        this.#regionsContainer = this.shadowRoot.querySelector('.sg-redact-regions');
        this.#controlsEl = this.shadowRoot.querySelector('.sg-redact-controls');

        // Pointer events for drawing
        this.#overlayEl.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
        window.addEventListener('pointermove', this.#onPointerMoveBound);
        window.addEventListener('pointerup', this.#onPointerUpBound);

        // Mode buttons
        this.#controlsEl.querySelectorAll('.sg-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.#mode = /** @type {'black'|'blur'} */ (btn.dataset.mode);
                this.#updateModeButtons();
            });
        });

        // Apply / Cancel
        this.#controlsEl.querySelector('.sg-redact-apply').addEventListener('click', () => this.#apply());
        this.#controlsEl.querySelector('.sg-redact-cancel').addEventListener('click', () => this.#cancel());
    }

    /** @type {(e: PointerEvent) => void} */
    #onPointerMoveBound = (e) => this.#onPointerMove(e);
    /** @type {(e: PointerEvent) => void} */
    #onPointerUpBound = (e) => this.#onPointerUp(e);

    disconnectedCallback() {
        window.removeEventListener('pointermove', this.#onPointerMoveBound);
        window.removeEventListener('pointerup', this.#onPointerUpBound);
    }

    /**
     * Get local coordinates from a pointer event.
     *
     * @param {PointerEvent} e
     * @returns {{ x: number, y: number }}
     */
    #getLocalCoords(e) {
        const rect = this.#overlayEl.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    }

    #onPointerDown(e) {
        if (e.button !== 0) return;
        // Ignore clicks on controls or remove buttons
        if (e.target.closest && (e.target.closest('.sg-redact-controls') || e.target.closest('.sg-redact-remove'))) {
            return;
        }

        const pos = this.#getLocalCoords(e);
        this.#drawing = true;
        this.#drawStart = pos;
        this.#currentRect = { x: pos.x, y: pos.y, w: 0, h: 0, mode: this.#mode };
        e.preventDefault();
    }

    #onPointerMove(e) {
        if (!this.#drawing || !this.#currentRect) return;
        const pos = this.#getLocalCoords(e);

        this.#currentRect.x = Math.min(this.#drawStart.x, pos.x);
        this.#currentRect.y = Math.min(this.#drawStart.y, pos.y);
        this.#currentRect.w = Math.abs(pos.x - this.#drawStart.x);
        this.#currentRect.h = Math.abs(pos.y - this.#drawStart.y);

        this.#renderRegions();
    }

    #onPointerUp(e) {
        if (!this.#drawing) return;
        this.#drawing = false;

        if (this.#currentRect && this.#currentRect.w > 5 && this.#currentRect.h > 5) {
            this.#regions.push({ ...this.#currentRect });
        }

        this.#currentRect = null;
        this.#renderRegions();
        this.#updateCount();
    }

    /** Re-render all region overlays. */
    #renderRegions() {
        if (!this.#regionsContainer) return;

        this.#regionsContainer.innerHTML = '';

        const allRegions = [...this.#regions];
        if (this.#currentRect && this.#drawing) {
            allRegions.push(this.#currentRect);
        }

        allRegions.forEach((region, idx) => {
            const div = document.createElement('div');
            div.className = 'sg-redact-region';
            div.style.left = `${region.x}px`;
            div.style.top = `${region.y}px`;
            div.style.width = `${region.w}px`;
            div.style.height = `${region.h}px`;

            const label = document.createElement('span');
            label.className = 'sg-redact-label';
            label.textContent = `${idx + 1}`;
            div.appendChild(label);

            // Only add remove button for committed regions (not current drawing)
            if (idx < this.#regions.length) {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'sg-redact-remove';
                removeBtn.textContent = '\u00d7';
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.#regions.splice(idx, 1);
                    this.#renderRegions();
                    this.#updateCount();
                });
                div.appendChild(removeBtn);
            }

            this.#regionsContainer.appendChild(div);
        });
    }

    /** Update the region count text. */
    #updateCount() {
        const countEl = this.shadowRoot.querySelector('.sg-redact-count');
        if (countEl) {
            const n = this.#regions.length;
            countEl.textContent = `${n} region${n !== 1 ? 's' : ''}`;
        }
    }

    /** Update active state on mode buttons. */
    #updateModeButtons() {
        if (!this.#controlsEl) return;
        this.#controlsEl.querySelectorAll('.sg-mode-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.mode === this.#mode);
        });
    }

    /**
     * Map a display-coordinate region to image coordinates.
     *
     * @param {{ x: number, y: number, w: number, h: number, mode: string }} region
     * @returns {{ x: number, y: number, w: number, h: number, mode: string }}
     */
    #toImageCoords(region) {
        if (!this.#targetCanvas) {
            return { ...region };
        }

        const displayW = this.#targetCanvas.clientWidth;
        const displayH = this.#targetCanvas.clientHeight;
        const imgW = this.#targetCanvas.width;
        const imgH = this.#targetCanvas.height;

        const scaleX = imgW / displayW;
        const scaleY = imgH / displayH;

        return {
            x: Math.round(region.x * scaleX),
            y: Math.round(region.y * scaleY),
            w: Math.round(region.w * scaleX),
            h: Math.round(region.h * scaleY),
            mode: region.mode,
        };
    }

    /** Emit sg-redact-apply and detach. */
    #apply() {
        const regions = this.getRegions();
        this.dispatchEvent(new CustomEvent('sg-redact-apply', {
            bubbles: true,
            composed: true,
            detail: { regions },
        }));
        this.detach();
    }

    /** Emit sg-redact-cancel and detach. */
    #cancel() {
        this.dispatchEvent(new CustomEvent('sg-redact-cancel', {
            bubbles: true,
            composed: true,
        }));
        this.detach();
    }
}

customElements.define('sg-image-redact', SgImageRedact);
