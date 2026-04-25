// sg-preview-canvas.js — canvas + transport bar + transform/crop overlay (v0.1.0)

import {
    buildTransport,
    updateTime,
    setTransportEnabled,
    mountTransportModeButtons,
} from './preview-transport.js';
import { mountOverlay } from './preview-overlay.js';
import { bindComposer } from './preview-composer-bind.js';

const CSS_HREF = new URL('./sg-preview-canvas.css', import.meta.url).href;
const DEFAULT_W = 1280;
const DEFAULT_H = 720;

export class SgPreviewCanvas extends HTMLElement {
    static get observedAttributes() { return ['width', 'height']; }

    #canvas = null;
    #transportEl = null;
    #holderEl = null;
    #els = null;
    #binding = null;
    #overlay = null;
    #editorMode = 'select';
    #activeClip = null;
    #modeBtns = null;

    constructor() {
        super();
        const sr = this.attachShadow({ mode: 'open' });
        sr.innerHTML = `
            <link rel="stylesheet" href="${CSS_HREF}">
            <div class="wrap">
                <div class="canvas-holder">
                    <canvas></canvas>
                </div>
                <div class="transport"></div>
            </div>
        `;
        this.#canvas = sr.querySelector('canvas');
        this.#transportEl = sr.querySelector('.transport');
        this.#holderEl = sr.querySelector('.canvas-holder');
        const w = parseInt(this.getAttribute('width') || '', 10);
        const h = parseInt(this.getAttribute('height') || '', 10);
        this.setSize(Number.isFinite(w) && w > 0 ? w : DEFAULT_W,
                     Number.isFinite(h) && h > 0 ? h : DEFAULT_H);
        this.#els = buildTransport(this.#transportEl);
        updateTime(this.#els, 0, 0);
        setTransportEnabled(this.#els, false);
        this.#modeBtns = mountTransportModeButtons(this.#transportEl, {
            getMode: () => this.#editorMode,
            dispatch: (name, detail) => this.dispatchEvent(
                new CustomEvent(name, { detail, bubbles: true, composed: true })),
        });
    }

    connectedCallback() {
        if (this.#overlay) return;
        this.#overlay = mountOverlay({
            parent: this.#holderEl,
            host: this,
            getCanvas: () => this.#canvas,
            getMode: () => this.#editorMode,
            getActive: () => this.#activeClip,
        });
    }

    attributeChangedCallback(name, _old, val) {
        const n = parseInt(val, 10);
        if (!Number.isFinite(n) || n <= 0) return;
        if (name === 'width') this.setSize(n, this.#canvas.height);
        else if (name === 'height') this.setSize(this.#canvas.width, n);
    }

    disconnectedCallback() {
        this.detachComposer();
        if (this.#overlay) { try { this.#overlay.destroy(); } catch (_) {} this.#overlay = null; }
        if (this.#modeBtns) { try { this.#modeBtns.dispose(); } catch (_) {} this.#modeBtns = null; }
    }

    /**
     * Get the inner canvas element.
     * @returns {HTMLCanvasElement}
     */
    getCanvas() { return this.#canvas; }

    /**
     * Set canvas pixel dimensions.
     * @param {number} w
     * @param {number} h
     */
    setSize(w, h) {
        if (Number.isFinite(w) && w > 0) this.#canvas.width = w;
        if (Number.isFinite(h) && h > 0) this.#canvas.height = h;
        if (this.#overlay) this.#overlay.refresh();
    }

    /** Alias of `setSize` for caller clarity. */
    setCanvasSize(w, h) { this.setSize(w, h); }

    /**
     * Switch the on-canvas overlay mode.
     * @param {'select'|'move'|'crop'} mode
     */
    setEditorMode(mode) {
        const next = (mode === 'move' || mode === 'crop') ? mode : 'select';
        this.#editorMode = next;
        if (this.#modeBtns) this.#modeBtns.refresh();
        if (this.#overlay) this.#overlay.refresh();
    }

    /**
     * Read the current overlay mode.
     * @returns {'select'|'move'|'crop'}
     */
    getEditorMode() { return this.#editorMode; }

    /**
     * Set (or clear) the clip whose handles the overlay should render.
     * @param {{clipId: string, transform?: object, crop?: object, srcWidth: number, srcHeight: number}|null} info
     */
    setActiveClip(info) {
        const ok = info && info.clipId
            && Number.isFinite(info.srcWidth) && info.srcWidth > 0
            && Number.isFinite(info.srcHeight) && info.srcHeight > 0;
        this.#activeClip = ok ? {
            clipId: info.clipId,
            transform: info.transform || null,
            crop: info.crop || null,
            srcWidth: info.srcWidth,
            srcHeight: info.srcHeight,
        } : null;
        if (this.#overlay) this.#overlay.refresh();
    }

    /**
     * Attach a composer handle (from createComposer).
     * @param {object} composer
     */
    attachComposer(composer) {
        this.detachComposer();
        if (!composer) return;
        this.#binding = bindComposer({ composer, els: this.#els, canvas: this.#canvas });
    }

    /** Detach the current composer handle. */
    detachComposer() {
        if (this.#binding) { try { this.#binding.detach(); } catch (_) {} this.#binding = null; }
    }
}

if (!customElements.get('sg-preview-canvas')) {
    customElements.define('sg-preview-canvas', SgPreviewCanvas);
}
