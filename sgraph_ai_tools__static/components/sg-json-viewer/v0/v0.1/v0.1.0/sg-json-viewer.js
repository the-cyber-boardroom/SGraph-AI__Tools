/**
 * sg-json-viewer.js — read-only collapsible JSON viewer Web Component.
 * @module sg-json-viewer
 */

import { renderJson } from './json-render.js';

const CSS_HREF = new URL('./sg-json-viewer.css', import.meta.url).href;

/** Web Component shell — Shadow DOM, link to stylesheet, mount point. */
export class SgJsonViewer extends HTMLElement {
    #data = null;
    #expandedDepth = 2;
    #mount = null;

    constructor() {
        super();
        const sr = this.attachShadow({ mode: 'open' });
        sr.innerHTML = `
            <link rel="stylesheet" href="${CSS_HREF}">
            <div class="jv-mount"><div class="jv-empty">No data.</div></div>
        `;
        this.#mount = sr.querySelector('.jv-mount');
    }

    /**
     * Replace the displayed data and re-render.
     * @param {*} obj
     * @returns {void}
     */
    setData(obj) {
        this.#data = obj;
        this.#render();
    }

    /** Return the last value passed to setData. */
    getData() { return this.#data; }

    /**
     * Set the default expansion depth (re-renders).
     * @param {number} n
     * @returns {void}
     */
    setExpandedDepth(n) {
        if (!Number.isFinite(n) || n < 0) return;
        this.#expandedDepth = n | 0;
        this.#render();
    }

    #render() {
        if (!this.#mount) return;
        this.#mount.innerHTML = '';
        if (this.#data === undefined || this.#data === null) {
            const empty = document.createElement('div');
            empty.className = 'jv-empty';
            empty.textContent = this.#data === null ? 'null' : 'No data.';
            this.#mount.appendChild(empty);
            return;
        }
        const node = renderJson(this.#data, { expandedDepth: this.#expandedDepth });
        this.#mount.appendChild(node);
    }
}

if (!customElements.get('sg-json-viewer')) {
    customElements.define('sg-json-viewer', SgJsonViewer);
}
