// sg-preview-canvas.js — canvas + transport bar component (v0.1.0)

import { buildTransport, wireTransport, fmtMmss } from './preview-transport.js';

const CSS_HREF = new URL('./sg-preview-canvas.css', import.meta.url).href;
const DEFAULT_W = 1280;
const DEFAULT_H = 720;

export class SgPreviewCanvas extends HTMLElement {
    static get observedAttributes() { return ['width', 'height']; }

    #canvas = null;
    #transportEl = null;
    #els = null;
    #composer = null;
    #unwire = null;
    #onPlayhead = null;
    #onEnded = null;
    #duration = 0;

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
        const w = parseInt(this.getAttribute('width') || '', 10);
        const h = parseInt(this.getAttribute('height') || '', 10);
        this.setSize(Number.isFinite(w) && w > 0 ? w : DEFAULT_W,
                     Number.isFinite(h) && h > 0 ? h : DEFAULT_H);
        this.#els = buildTransport(this.#transportEl);
        this.#updateTime(0, 0);
        this.#setEnabled(false);
    }

    attributeChangedCallback(name, _old, val) {
        const n = parseInt(val, 10);
        if (!Number.isFinite(n) || n <= 0) return;
        if (name === 'width') this.setSize(n, this.#canvas.height);
        else if (name === 'height') this.setSize(this.#canvas.width, n);
    }

    disconnectedCallback() { this.detachComposer(); }

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
    }

    /**
     * Attach a composer handle (from createComposer).
     * @param {{play:Function,pause:Function,seek:Function,getCurrentTime:Function,getDuration:Function,isPlaying:Function,destroy:Function}} composer
     * @returns {void}
     */
    attachComposer(composer) {
        this.detachComposer();
        if (!composer) return;
        this.#composer = composer;
        this.#unwire = wireTransport(this.#els, composer);
        this.#duration = composer.getDuration ? composer.getDuration() : 0;
        this.#updateTime(composer.getCurrentTime ? composer.getCurrentTime() : 0, this.#duration);
        this.#onPlayhead = (e) => {
            const t = (e && e.detail && Number.isFinite(e.detail.time)) ? e.detail.time : 0;
            this.#updateTime(t, this.#duration);
            this.#updatePlayIcon();
        };
        this.#onEnded = () => {
            this.#updatePlayIcon();
        };
        this.#canvas.addEventListener('composer:playhead-changed', this.#onPlayhead);
        this.#canvas.addEventListener('composer:ended', this.#onEnded);
        this.#setEnabled(true);
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
        if (this.#onEnded) {
            this.#canvas.removeEventListener('composer:ended', this.#onEnded);
            this.#onEnded = null;
        }
        this.#composer = null;
        this.#duration = 0;
        this.#updateTime(0, 0);
        this.#setEnabled(false);
        if (this.#els) this.#els.play.textContent = '▶';
    }

    #updateTime(cur, dur) {
        if (this.#els) this.#els.time.textContent = `${fmtMmss(cur)} / ${fmtMmss(dur)}`;
    }

    #updatePlayIcon() {
        if (!this.#composer || !this.#els) return;
        this.#els.play.textContent = this.#composer.isPlaying() ? '⏸' : '▶';
    }

    #setEnabled(enabled) {
        if (!this.#els) return;
        this.#els.back.disabled = !enabled;
        this.#els.play.disabled = !enabled;
        this.#els.fwd.disabled = !enabled;
    }
}

if (!customElements.get('sg-preview-canvas')) {
    customElements.define('sg-preview-canvas', SgPreviewCanvas);
}
