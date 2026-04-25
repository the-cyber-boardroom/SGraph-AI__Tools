// timeline-zoom.js — zoom toolbar (- / + / Fit / Split) for sg-timeline (v0.1.0)

import { getProjectDuration } from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { mountColorPicker } from './timeline-color-picker.js';
import { mountSplitButton } from './timeline-split-button.js';
import { buildToolbar, findScrollViewport, updateLabel } from './timeline-toolbar-dom.js';
import { mountHistoryButtons, buildToolbarSeparator } from './timeline-history-buttons.js';
import { SGT_EVENTS } from './timeline-events.js';

const MIN_PPS = 1;
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
 * @param {number} visibleWidth Scroll-viewport clientWidth.
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
 * Attach the zoom toolbar to the timeline root. Inserts the toolbar element as
 * the first child of the root container so it sits above the ruler.
 *
 * Toolbar order: Undo  Redo  |  -  +  Fit  |  Split  |  Colour-swatch.
 *
 * @param {{
 *   root: HTMLElement|ShadowRoot,
 *   getState: () => { project: object|null, pps: number, fps?: number, playhead?: number, selectedClipId?: string|null },
 *   setPixelsPerSecond: (pps: number) => void,
 *   getLane: () => HTMLElement|null,
 *   dispatch?: (name: string, detail: object) => void,
 *   getHistoryFlags?: () => { canUndo: boolean, canRedo: boolean },
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
        if (!lane) return;
        const viewport = findScrollViewport(lane);
        const width = viewport ? viewport.clientWidth : 0;
        const next = computeFitPps(cfg.getState().project, width);
        if (!next) return;
        applyPps(next);
    }

    const { root: bar, label } = buildToolbar({
        onZoomOut: () => applyPps(cfg.getState().pps / 2),
        onZoomIn: () => applyPps(cfg.getState().pps * 2),
        onFit: fit,
    });
    const history = cfg.dispatch && cfg.getHistoryFlags
        ? mountHistoryButtons({ getFlags: cfg.getHistoryFlags, dispatch: cfg.dispatch })
        : null;
    if (history) {
        bar.insertBefore(history.root, bar.firstChild);
        bar.insertBefore(buildToolbarSeparator(), history.root.nextSibling);
        bar.appendChild(buildToolbarSeparator());
    }
    const split = cfg.dispatch
        ? mountSplitButton({ getState: cfg.getState, dispatch: cfg.dispatch })
        : null;
    if (split) bar.appendChild(split.root);
    if (split) bar.appendChild(buildToolbarSeparator());
    const picker = cfg.dispatch
        ? mountColorPicker({ host: bar, getState: cfg.getState, dispatch: cfg.dispatch })
        : null;
    if (picker) bar.appendChild(picker.root);
    container.insertBefore(bar, scrollEl);
    updateLabel(label, cfg.getState().pps);

    const hostEl = cfg.root && cfg.root.host ? cfg.root.host : null;
    const onHostEvt = () => { if (split) split.refresh(); };
    if (hostEl && split) {
        hostEl.addEventListener(SGT_EVENTS.PLAYHEAD_CHANGED, onHostEvt);
        hostEl.addEventListener(SGT_EVENTS.CLIP_SELECTED, onHostEvt);
    }

    function refresh() {
        updateLabel(label, cfg.getState().pps);
        if (picker) picker.refresh();
        if (split) split.refresh();
        if (history) history.refresh();
    }
    function dispose() {
        if (hostEl && split) {
            hostEl.removeEventListener(SGT_EVENTS.PLAYHEAD_CHANGED, onHostEvt);
            hostEl.removeEventListener(SGT_EVENTS.CLIP_SELECTED, onHostEvt);
        }
        if (split) split.dispose();
        if (picker) picker.dispose();
        if (history) history.dispose();
        if (bar.parentNode) bar.parentNode.removeChild(bar);
    }
    return { dispose, refresh, fit };
}
