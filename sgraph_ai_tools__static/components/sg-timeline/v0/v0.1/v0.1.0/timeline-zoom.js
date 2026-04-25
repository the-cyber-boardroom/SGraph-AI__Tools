// timeline-zoom.js — zoom toolbar (- / + / Fit) for sg-timeline (v0.1.0)

import { getProjectDuration } from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';

const MIN_PPS = 5;
const MAX_PPS = 480;
const FIT_PADDING_PX = 8;

/**
 * Clamp a pixels-per-second value to the supported range.
 * @param {number} pps
 * @returns {number}
 */
function clampPps(pps) {
    if (!Number.isFinite(pps) || pps <= 0) return MIN_PPS;
    return Math.max(MIN_PPS, Math.min(MAX_PPS, pps));
}

/**
 * Compute the fit-to-view pps for the current project + visible width.
 * @param {object|null} project
 * @param {number} visibleWidth Lane clientWidth.
 * @returns {number} 0 if not computable (no project / no width).
 */
export function computeFitPps(project, visibleWidth) {
    if (!project || !visibleWidth || visibleWidth <= 0) return 0;
    const dur = getProjectDuration(project);
    if (!dur || dur <= 0) return 0;
    const usable = Math.max(1, visibleWidth - FIT_PADDING_PX);
    const raw = Math.floor(usable / dur);
    return clampPps(raw);
}

/**
 * Build the toolbar DOM (returns the container; caller decides where to mount).
 * @param {{ onZoomOut: () => void, onZoomIn: () => void, onFit: () => void }} handlers
 * @returns {{ root: HTMLElement, label: HTMLElement }}
 */
function buildToolbar(handlers) {
    const root = document.createElement('div');
    root.className = 'zoom-toolbar';
    const mkBtn = (text, title, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.title = title;
        b.addEventListener('click', (e) => { e.preventDefault(); fn(); });
        return b;
    };
    root.appendChild(mkBtn('-', 'Zoom out', handlers.onZoomOut));
    root.appendChild(mkBtn('+', 'Zoom in', handlers.onZoomIn));
    root.appendChild(mkBtn('Fit', 'Fit project to view', handlers.onFit));
    const label = document.createElement('span');
    label.className = 'zoom-label';
    root.appendChild(label);
    return { root, label };
}

/**
 * Update the read-only zoom label.
 * @param {HTMLElement} label
 * @param {number} pps
 * @returns {void}
 */
function updateLabel(label, pps) {
    label.textContent = `${Math.round(pps)} px/s`;
}

/**
 * Attach the zoom toolbar to the timeline root. Inserts the toolbar element as
 * the first child of the root container so it sits above the ruler.
 *
 * @param {{
 *   root: HTMLElement|ShadowRoot,
 *   getState: () => { project: object|null, pps: number },
 *   setPixelsPerSecond: (pps: number) => void,
 *   getLane: () => HTMLElement|null,
 * }} cfg
 * @returns {{ dispose: () => void, refresh: () => void, fit: () => void }}
 */
export function attachZoom(cfg) {
    const scrollEl = cfg.root.querySelector('.root');
    if (!scrollEl || !scrollEl.parentNode) return { dispose: () => {}, refresh: () => {}, fit: () => {} };
    const container = scrollEl.parentNode;

    function applyPps(next) {
        const clamped = clampPps(next);
        cfg.setPixelsPerSecond(clamped);
        updateLabel(label, clamped);
    }

    function fit() {
        const lane = cfg.getLane();
        const width = lane ? lane.clientWidth : 0;
        const next = computeFitPps(cfg.getState().project, width);
        if (!next) return;
        applyPps(next);
    }

    const { root: bar, label } = buildToolbar({
        onZoomOut: () => applyPps(cfg.getState().pps / 2),
        onZoomIn: () => applyPps(cfg.getState().pps * 2),
        onFit: fit,
    });
    container.insertBefore(bar, scrollEl);
    updateLabel(label, cfg.getState().pps);

    function refresh() { updateLabel(label, cfg.getState().pps); }
    function dispose() { if (bar.parentNode) bar.parentNode.removeChild(bar); }
    return { dispose, refresh, fit };
}
