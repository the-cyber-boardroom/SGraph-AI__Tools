// sg-preview-canvas.js — canvas + transport bar + transform/crop overlay (v0.1.0)

import { buildTransport, wireTransport, updateTime, setTransportEnabled } from './preview-transport.js';
import { mountOverlay } from './preview-overlay.js';

const CSS_HREF = new URL('./sg-preview-canvas.css', import.meta.url).href;
const DEFAULT_W = 1280;
const DEFAULT_H = 720;

export class SgPreviewCanvas extends HTMLElement {
    static get observedAttributes() { return ['width', 'height']; }

    #canvas = null;
    #transportEl = null;
    #holderEl = null;
    #els = null;
    #composer = null;
    #unwire = null;
    #onPlayhead = null;
    #onState = null;
    #duration = 0;
    #overlay = null;
    #editorMode = 'select';
    #activeClip = null;

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
     * @returns {void}
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
        if (this.#overlay) this.#overlay.refresh();
    }

    /**
     * Set (or clear) the clip whose handles the overlay should render.
     * @param {{clipId: string, transform?: object, crop?: object, srcWidth: number, srcHeight: number}|null} info
     */
    setActiveClip(info) {
        if (!info || !info.clipId
                  || !Number.isFinite(info.srcWidth) || !Number.isFinite(info.srcHeight)
                  || info.srcWidth <= 0 || info.srcHeight <= 0) {
            this.#activeClip = null;
        } else {
            this.#activeClip = {
                clipId: info.clipId,
                transform: info.transform || null,
                crop: info.crop || null,
                srcWidth: info.srcWidth,
                srcHeight: info.srcHeight,
            };
        }
        if (this.#overlay) this.#overlay.refresh();
    }

    /**
     * Attach a composer handle (from createComposer).
     * @param {object} composer
     * @returns {void}
     */
    attachComposer(composer) {
        this.detachComposer();
        if (!composer) return;
        this.#composer = composer;
        this.#unwire = wireTransport(this.#els, composer);
        this.#duration = composer.getDuration ? composer.getDuration() : 0;
        updateTime(this.#els, composer.getCurrentTime ? composer.getCurrentTime() : 0, this.#duration);
        this.#onPlayhead = (e) => {
            const t = (e && e.detail && Number.isFinite(e.detail.time)) ? e.detail.time : 0;
            updateTime(this.#els, t, this.#duration);
        };
        this.#onState = () => { this.#updatePlayIcon(); };
        this.#canvas.addEventListener('composer:playhead-changed', this.#onPlayhead);
        this.#canvas.addEventListener('composer:state-changed', this.#onState);
        this.#canvas.addEventListener('composer:ended', this.#onState);
        setTransportEnabled(this.#els, true);
        this.#updatePlayIcon();
    }

    /**
     * Detach the current composer handle.
     * @returns {void}
     */
    detachComposer() {
        if (this.#unwire) { this.#unwire(); this.#unwire = null; }
        if (this.#onPlayhead) {
            this.#canvas.removeEventListener('composer:playhead-changed', this.#onPlayhead);
            this.#onPlayhead = null;
        }
        if (this.#onState) {
            this.#canvas.removeEventListener('composer:state-changed', this.#onState);
            this.#canvas.removeEventListener('composer:ended', this.#onState);
            this.#onState = null;
        }
        this.#composer = null;
        this.#duration = 0;
        updateTime(this.#els, 0, 0);
        setTransportEnabled(this.#els, false);
        if (this.#els) this.#els.play.textContent = '▶';
    }

    #updatePlayIcon() {
        if (!this.#composer || !this.#els) return;
        this.#els.play.textContent = this.#composer.isPlaying() ? '⏸' : '▶';
    }
}

if (!customElements.get('sg-preview-canvas')) {
    customElements.define('sg-preview-canvas', SgPreviewCanvas);
}
