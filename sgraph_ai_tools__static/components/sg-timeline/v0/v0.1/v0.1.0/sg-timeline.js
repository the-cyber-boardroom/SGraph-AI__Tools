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
import { attachZoom } from './timeline-zoom.js';

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
    #zoom = null;

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
        const getState = () => ({
            project: this.#project,
            pps: this.#pps,
            fps: this.#fps,
            playhead: this.#playhead,
            selectedClipId: this.#selected,
            host: this,
        });
        const dispatch = (name, detail) => {
            if (name === SGT_EVENTS.PLAYHEAD_CHANGED && detail && Number.isFinite(detail.time)) {
                this.#playhead = detail.time;
                updatePlayhead(this.#playheadEl, this.#playhead, this.#pps);
            }
            if (name === SGT_EVENTS.CLIP_SELECTED) {
                this.#selected = detail ? detail.clipId : null;
                this.#renderAll();
                if (this.#zoom) this.#zoom.refresh();
            }
            this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
        };
        if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');
        this.#dispose = attachInteractions(this.#root, getState, dispatch, this);
        this.#zoom = attachZoom({
            root: this.#root,
            getState: () => ({ project: this.#project, pps: this.#pps, selectedClipId: this.#selected }),
            setPixelsPerSecond: (pps) => this.setPixelsPerSecond(pps),
            getLane: () => this.#lane,
            dispatch,
        });
        this.#renderAll();
    }

    /**
     * Public method: request a colour override for the currently-selected clip.
     * No-op when nothing is selected. Pass `null` to revert to the auto-shade.
     * @param {string|null} color
     * @returns {void}
     */
    setSelectedClipColor(color) {
        if (!this.#selected) return;
        this.dispatchEvent(new CustomEvent(SGT_EVENTS.CLIP_COLOR_REQUESTED, {
            detail: { clipId: this.#selected, color: color == null ? null : color },
            bubbles: true, composed: true,
        }));
    }

    disconnectedCallback() {
        if (this.#dispose) { this.#dispose(); this.#dispose = null; }
        if (this.#zoom) { this.#zoom.dispose(); this.#zoom = null; }
    }

    /** @param {object} project */
    setProject(project) {
        this.#project = project || null;
        if (project && Number.isFinite(project.fps)) this.#fps = project.fps;
        this.#renderAll();
        if (this.#zoom) this.#zoom.refresh();
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
        if (this.#zoom) this.#zoom.refresh();
    }

    /** @param {number} pps */
    setPixelsPerSecond(pps) {
        if (!Number.isFinite(pps) || pps <= 0) return;
        this.#pps = pps;
        this.#renderAll();
        if (this.#zoom) this.#zoom.refresh();
    }

    /**
     * Auto-fit pixelsPerSecond so the entire project fits the visible width.
     * No-op when no project, zero duration, or lane not yet visible.
     * @returns {void}
     */
    fitToView() {
        if (this.#zoom) this.#zoom.fit();
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
