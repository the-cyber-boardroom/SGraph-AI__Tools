// sg-timeline.js — interactive timeline component (v0.1.0)

import { SGT_EVENTS } from './timeline-events.js';
import {
    computeSurfaceWidth,
    renderRuler,
    renderTrack,
    renderClips,
    renderPlayhead,
    updatePlayhead,
} from './timeline-render.js';
import { attachInteractions } from './timeline-interactions.js';

const CSS_HREF = new URL('./sg-timeline.css', import.meta.url).href;
const DEFAULT_PPS = 60;
const DEFAULT_FPS = 30;

export { SGT_EVENTS };

export class SgTimeline extends HTMLElement {
    #project = null;
    #pps = DEFAULT_PPS;
    #fps = DEFAULT_FPS;
    #playhead = 0;
    #selected = null;
    #dispose = null;
    #root = null;
    #ruler = null;
    #lane = null;
    #playheadEl = null;
    #surface = null;

    constructor() {
        super();
        const sr = this.attachShadow({ mode: 'open' });
        sr.innerHTML = `
            <link rel="stylesheet" href="${CSS_HREF}">
            <div class="root">
                <div class="surface">
                    <div class="ruler"></div>
                    <div class="lane"></div>
                    <div class="playhead"></div>
                </div>
            </div>
        `;
        this.#root = sr;
        this.#surface = sr.querySelector('.surface');
        this.#ruler = sr.querySelector('.ruler');
        this.#lane = sr.querySelector('.lane');
        this.#playheadEl = sr.querySelector('.playhead');
    }

    connectedCallback() {
        if (this.#dispose) return;
        const getState = () => ({ project: this.#project, pps: this.#pps, fps: this.#fps });
        const dispatch = (name, detail) => {
            if (name === SGT_EVENTS.PLAYHEAD_CHANGED && detail && Number.isFinite(detail.time)) {
                this.#playhead = detail.time;
                updatePlayhead(this.#playheadEl, this.#playhead, this.#pps);
            }
            if (name === SGT_EVENTS.CLIP_SELECTED) {
                this.#selected = detail ? detail.clipId : null;
                this.#renderAll();
            }
            this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
        };
        this.#dispose = attachInteractions(this.#root, getState, dispatch);
        this.#renderAll();
    }

    disconnectedCallback() {
        if (this.#dispose) { this.#dispose(); this.#dispose = null; }
    }

    /** @param {object} project */
    setProject(project) {
        this.#project = project || null;
        if (project && Number.isFinite(project.fps)) this.#fps = project.fps;
        this.#renderAll();
    }

    /** @param {number} t */
    setPlayheadTime(t) {
        if (!Number.isFinite(t)) return;
        this.#playhead = t;
        updatePlayhead(this.#playheadEl, this.#playhead, this.#pps);
    }

    /** @param {string|null} clipId */
    setSelectedClip(clipId) {
        this.#selected = clipId || null;
        renderClips(this.#lane, this.#project, this.#pps, this.#selected);
    }

    /** @param {number} pps */
    setPixelsPerSecond(pps) {
        if (!Number.isFinite(pps) || pps <= 0) return;
        this.#pps = pps;
        this.#renderAll();
    }

    #renderAll() {
        const widthPx = computeSurfaceWidth(this.#project, this.#pps);
        this.#surface.style.width = widthPx + 'px';
        renderRuler(this.#ruler, widthPx, this.#pps);
        renderTrack(this.#lane, widthPx);
        renderClips(this.#lane, this.#project, this.#pps, this.#selected);
        renderPlayhead(this.#playheadEl, this.#playhead, this.#pps);
    }
}

if (!customElements.get('sg-timeline')) {
    customElements.define('sg-timeline', SgTimeline);
}
