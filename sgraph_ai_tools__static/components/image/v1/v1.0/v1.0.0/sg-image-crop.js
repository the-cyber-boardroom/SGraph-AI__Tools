/**
 * sg-image-crop — Crop overlay Web Component
 *
 * Provides an interactive crop rectangle overlay on top of a preview canvas.
 * Supports aspect ratio presets, corner-handle resizing, and coordinate
 * mapping from display space to image space.
 *
 * @module sg-image-crop
 * @version 1.0.0
 */

const COMPONENT_URL = new URL(import.meta.url);
const CSS_URL = new URL('./sg-image-crop.css', COMPONENT_URL).href;

const ASPECT_PRESETS = [
    { label: 'Free', value: null },
    { label: '1:1', value: 1 },
    { label: '4:3', value: 4 / 3 },
    { label: '16:9', value: 16 / 9 },
    { label: '3:2', value: 3 / 2 },
];

/**
 * <sg-image-crop> — Interactive crop overlay for an image canvas.
 *
 * Usage:
 *   const cropEl = document.createElement('sg-image-crop');
 *   cropEl.attach(previewCanvas);
 *   cropEl.setAspectRatio(1); // 1:1
 *   cropEl.addEventListener('sg-crop-apply', e => console.log(e.detail));
 *
 * @fires sg-crop-apply — { x, y, width, height } in image coordinates
 * @fires sg-crop-cancel — user cancelled crop
 */
export class SgImageCrop extends HTMLElement {
    /** @type {HTMLCanvasElement|null} */
    #targetCanvas = null;

    /** @type {number|null} Aspect ratio constraint (null = free) */
    #aspectRatio = null;

    /** Crop rectangle in display coordinates */
    #selection = { x: 0, y: 0, w: 0, h: 0 };
    #hasSelection = false;

    /** Drag state */
    #dragging = false;
    #dragType = null; // 'new' | 'move' | 'nw' | 'ne' | 'sw' | 'se'
    #dragStart = { x: 0, y: 0 };
    #selectionAtDragStart = null;

    /** DOM refs */
    #overlayEl = null;
    #canvasOverlay = null;
    #selectionEl = null;
    #infoEl = null;
    #controlsEl = null;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.#render();
    }

    /**
     * Attach this crop overlay on top of a preview canvas.
     * The canvas parent must have position: relative.
     *
     * @param {HTMLCanvasElement} previewCanvas
     */
    attach(previewCanvas) {
        this.#targetCanvas = previewCanvas;
        this.#hasSelection = false;
        this.#selection = { x: 0, y: 0, w: 0, h: 0 };

        // Insert into the canvas's parent wrapper
        const parent = previewCanvas.parentElement;
        if (parent && !parent.contains(this)) {
            parent.appendChild(this);
        }

        this.#render();
        this.#drawOverlay();
    }

    /**
     * Remove the crop overlay.
     */
    detach() {
        this.#targetCanvas = null;
        this.#hasSelection = false;
        if (this.parentElement) {
            this.parentElement.removeChild(this);
        }
    }

    /**
     * Set the aspect ratio constraint.
     *
     * @param {number|null} ratio — null for free crop, or a number like 1, 4/3, 16/9
     */
    setAspectRatio(ratio) {
        this.#aspectRatio = ratio;
        if (this.#hasSelection && ratio !== null) {
            this.#enforceAspectRatio();
            this.#drawOverlay();
            this.#updateInfo();
            this.#positionElements();
        }
    }

    #render() {
        this.shadowRoot.innerHTML = `
            <link rel="stylesheet" href="${CSS_URL}">
            <div class="sg-crop-overlay">
                <canvas></canvas>
                <div class="sg-crop-selection" style="display:none">
                    <div class="sg-crop-info"></div>
                    <div class="sg-crop-handle sg-crop-handle--nw" data-handle="nw"></div>
                    <div class="sg-crop-handle sg-crop-handle--ne" data-handle="ne"></div>
                    <div class="sg-crop-handle sg-crop-handle--sw" data-handle="sw"></div>
                    <div class="sg-crop-handle sg-crop-handle--se" data-handle="se"></div>
                </div>
                <div class="sg-crop-controls">
                    ${ASPECT_PRESETS.map((p, i) =>
                        `<button class="sg-aspect-btn${i === 0 ? ' active' : ''}" data-ratio="${p.value}">${p.label}</button>`
                    ).join('')}
                    <div class="sg-crop-separator"></div>
                    <button class="sg-crop-apply">Apply</button>
                    <button class="sg-crop-cancel">Cancel</button>
                </div>
            </div>
        `;

        this.#overlayEl = this.shadowRoot.querySelector('.sg-crop-overlay');
        this.#canvasOverlay = this.shadowRoot.querySelector('canvas');
        this.#selectionEl = this.shadowRoot.querySelector('.sg-crop-selection');
        this.#infoEl = this.shadowRoot.querySelector('.sg-crop-info');
        this.#controlsEl = this.shadowRoot.querySelector('.sg-crop-controls');

        // Event listeners
        this.#overlayEl.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
        window.addEventListener('pointermove', this.#onPointerMoveBound);
        window.addEventListener('pointerup', this.#onPointerUpBound);

        // Aspect ratio buttons
        this.#controlsEl.querySelectorAll('.sg-aspect-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                this.#controlsEl.querySelectorAll('.sg-aspect-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const val = btn.dataset.ratio;
                this.setAspectRatio(val === 'null' ? null : parseFloat(val));
            });
        });

        // Apply / Cancel
        this.#controlsEl.querySelector('.sg-crop-apply').addEventListener('click', () => this.#apply());
        this.#controlsEl.querySelector('.sg-crop-cancel').addEventListener('click', () => this.#cancel());
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
     * Get the display coordinates from a pointer event relative to the overlay.
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

    /**
     * Determine if a pointer position is over a corner handle.
     *
     * @param {number} px
     * @param {number} py
     * @returns {string|null} 'nw','ne','sw','se' or null
     */
    #hitTestHandle(px, py) {
        if (!this.#hasSelection) return null;
        const s = this.#selection;
        const threshold = 14;
        const corners = {
            nw: { x: s.x, y: s.y },
            ne: { x: s.x + s.w, y: s.y },
            sw: { x: s.x, y: s.y + s.h },
            se: { x: s.x + s.w, y: s.y + s.h },
        };
        for (const [name, corner] of Object.entries(corners)) {
            if (Math.abs(px - corner.x) < threshold && Math.abs(py - corner.y) < threshold) {
                return name;
            }
        }
        return null;
    }

    /**
     * Determine if a pointer position is inside the selection.
     *
     * @param {number} px
     * @param {number} py
     * @returns {boolean}
     */
    #hitTestInside(px, py) {
        if (!this.#hasSelection) return false;
        const s = this.#selection;
        return px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h;
    }

    #onPointerDown(e) {
        if (e.button !== 0) return;
        const pos = this.#getLocalCoords(e);

        const handle = this.#hitTestHandle(pos.x, pos.y);
        if (handle) {
            this.#dragging = true;
            this.#dragType = handle;
            this.#dragStart = pos;
            this.#selectionAtDragStart = { ...this.#selection };
            e.preventDefault();
            return;
        }

        if (this.#hitTestInside(pos.x, pos.y)) {
            this.#dragging = true;
            this.#dragType = 'move';
            this.#dragStart = pos;
            this.#selectionAtDragStart = { ...this.#selection };
            e.preventDefault();
            return;
        }

        // Start new selection
        this.#dragging = true;
        this.#dragType = 'new';
        this.#dragStart = pos;
        this.#selection = { x: pos.x, y: pos.y, w: 0, h: 0 };
        this.#hasSelection = true;
        this.#selectionEl.style.display = '';
        e.preventDefault();
    }

    #onPointerMove(e) {
        if (!this.#dragging) return;
        const pos = this.#getLocalCoords(e);
        const overlayRect = this.#overlayEl.getBoundingClientRect();
        const maxW = overlayRect.width;
        const maxH = overlayRect.height;

        if (this.#dragType === 'new') {
            let x = Math.min(this.#dragStart.x, pos.x);
            let y = Math.min(this.#dragStart.y, pos.y);
            let w = Math.abs(pos.x - this.#dragStart.x);
            let h = Math.abs(pos.y - this.#dragStart.y);

            if (this.#aspectRatio !== null) {
                // Constrain to aspect ratio, anchored from drag start
                h = w / this.#aspectRatio;
                if (pos.y < this.#dragStart.y) {
                    y = this.#dragStart.y - h;
                }
            }

            this.#selection = { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(w, maxW), h: Math.min(h, maxH) };
        } else if (this.#dragType === 'move') {
            const dx = pos.x - this.#dragStart.x;
            const dy = pos.y - this.#dragStart.y;
            let nx = this.#selectionAtDragStart.x + dx;
            let ny = this.#selectionAtDragStart.y + dy;
            nx = Math.max(0, Math.min(nx, maxW - this.#selection.w));
            ny = Math.max(0, Math.min(ny, maxH - this.#selection.h));
            this.#selection.x = nx;
            this.#selection.y = ny;
        } else {
            // Handle resize
            this.#resizeFromHandle(this.#dragType, pos, maxW, maxH);
        }

        this.#drawOverlay();
        this.#updateInfo();
        this.#positionElements();
    }

    /**
     * Resize the selection from a corner handle drag.
     *
     * @param {string} handle
     * @param {{ x: number, y: number }} pos
     * @param {number} maxW
     * @param {number} maxH
     */
    #resizeFromHandle(handle, pos, maxW, maxH) {
        const s = this.#selectionAtDragStart;
        let x = s.x, y = s.y, w = s.w, h = s.h;

        const px = Math.max(0, Math.min(pos.x, maxW));
        const py = Math.max(0, Math.min(pos.y, maxH));

        switch (handle) {
            case 'se':
                w = px - s.x;
                h = this.#aspectRatio !== null ? w / this.#aspectRatio : py - s.y;
                break;
            case 'sw':
                w = (s.x + s.w) - px;
                h = this.#aspectRatio !== null ? w / this.#aspectRatio : py - s.y;
                x = s.x + s.w - w;
                break;
            case 'ne':
                w = px - s.x;
                h = this.#aspectRatio !== null ? w / this.#aspectRatio : s.y + s.h - py;
                y = s.y + s.h - h;
                break;
            case 'nw':
                w = (s.x + s.w) - px;
                h = this.#aspectRatio !== null ? w / this.#aspectRatio : (s.y + s.h) - py;
                x = s.x + s.w - w;
                y = s.y + s.h - h;
                break;
        }

        if (w < 10) w = 10;
        if (h < 10) h = 10;

        this.#selection = { x, y, w, h };
    }

    #onPointerUp(e) {
        if (!this.#dragging) return;
        this.#dragging = false;
        this.#dragType = null;
        this.#selectionAtDragStart = null;

        // Normalize negative dimensions
        if (this.#selection.w < 0) {
            this.#selection.x += this.#selection.w;
            this.#selection.w = Math.abs(this.#selection.w);
        }
        if (this.#selection.h < 0) {
            this.#selection.y += this.#selection.h;
            this.#selection.h = Math.abs(this.#selection.h);
        }

        this.#drawOverlay();
        this.#updateInfo();
        this.#positionElements();
    }

    /** Enforce current aspect ratio on the selection, keeping top-left fixed. */
    #enforceAspectRatio() {
        if (this.#aspectRatio === null || !this.#hasSelection) return;
        this.#selection.h = this.#selection.w / this.#aspectRatio;
    }

    /** Draw the dark overlay with a transparent crop window. */
    #drawOverlay() {
        if (!this.#canvasOverlay || !this.#overlayEl) return;

        const rect = this.#overlayEl.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.#canvasOverlay.width = rect.width * dpr;
        this.#canvasOverlay.height = rect.height * dpr;

        const ctx = this.#canvasOverlay.getContext('2d');
        ctx.scale(dpr, dpr);

        // Draw dark overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, rect.width, rect.height);

        if (this.#hasSelection && this.#selection.w > 0 && this.#selection.h > 0) {
            // Clear the crop area
            ctx.clearRect(this.#selection.x, this.#selection.y, this.#selection.w, this.#selection.h);
        }
    }

    /** Update the info label with pixel dimensions in image space. */
    #updateInfo() {
        if (!this.#infoEl || !this.#hasSelection || !this.#targetCanvas) return;
        const img = this.#toImageCoords(this.#selection);
        this.#infoEl.textContent = `${Math.round(img.width)} x ${Math.round(img.height)}`;
    }

    /** Position the selection element and controls. */
    #positionElements() {
        if (!this.#selectionEl || !this.#hasSelection) return;
        const s = this.#selection;
        this.#selectionEl.style.display = '';
        this.#selectionEl.style.left = `${s.x}px`;
        this.#selectionEl.style.top = `${s.y}px`;
        this.#selectionEl.style.width = `${s.w}px`;
        this.#selectionEl.style.height = `${s.h}px`;
    }

    /**
     * Map display coordinates to image coordinates.
     *
     * @param {{ x: number, y: number, w: number, h: number }} displayRect
     * @returns {{ x: number, y: number, width: number, height: number }}
     */
    #toImageCoords(displayRect) {
        if (!this.#targetCanvas) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }

        const canvasEl = this.#targetCanvas;
        const displayW = canvasEl.clientWidth;
        const displayH = canvasEl.clientHeight;
        const imgW = canvasEl.width;
        const imgH = canvasEl.height;

        const scaleX = imgW / displayW;
        const scaleY = imgH / displayH;

        return {
            x: Math.round(displayRect.x * scaleX),
            y: Math.round(displayRect.y * scaleY),
            width: Math.round(displayRect.w * scaleX),
            height: Math.round(displayRect.h * scaleY),
        };
    }

    /** Emit sg-crop-apply and detach. */
    #apply() {
        if (!this.#hasSelection) return;
        const coords = this.#toImageCoords(this.#selection);
        this.dispatchEvent(new CustomEvent('sg-crop-apply', {
            bubbles: true,
            composed: true,
            detail: coords,
        }));
        this.detach();
    }

    /** Emit sg-crop-cancel and detach. */
    #cancel() {
        this.dispatchEvent(new CustomEvent('sg-crop-cancel', {
            bubbles: true,
            composed: true,
        }));
        this.detach();
    }
}

customElements.define('sg-image-crop', SgImageCrop);
