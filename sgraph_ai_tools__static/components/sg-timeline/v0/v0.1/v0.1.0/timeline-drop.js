// timeline-drop.js — drag/drop affordances for sg-timeline lane (v0.1.0)

import {
    getTrackDuration,
    getVideoTracks,
} from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { SGT_EVENTS } from './timeline-events.js';

const ASSET_MIME = 'application/x-sg-asset';

/**
 * Whether a DataTransfer carries the SG asset MIME.
 * @param {DataTransfer|null} dt
 * @returns {boolean}
 */
function hasAssetMime(dt) {
    return !!dt && Array.from(dt.types || []).includes(ASSET_MIME);
}

/**
 * Compute the X position (px) at which a new clip would be appended.
 * Phase 1 appends to end of the first video track.
 * @param {{project: object|null, pps: number}} state
 * @returns {number}
 */
function endOfTrackPx(state) {
    const track = state.project ? getVideoTracks(state.project)[0] : null;
    const dur = track ? getTrackDuration(track) : 0;
    return dur * (state.pps || 0);
}

/**
 * Find or create the absolutely-positioned drop indicator inside the lane.
 * @param {HTMLElement} lane
 * @returns {HTMLElement}
 */
function ensureDropIndicator(lane) {
    let el = lane.querySelector('[data-role="drop-indicator"]');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'drop-indicator';
    el.dataset.role = 'drop-indicator';
    lane.appendChild(el);
    return el;
}

/**
 * Attach drag-over / drop affordances + emit clip-added on drop.
 * Uses a depth counter so child enter/leave events do not flicker.
 *
 * @param {HTMLElement} lane The track lane element.
 * @param {() => {project: object|null, pps: number, fps: number}} getState
 * @param {(name: string, detail: object) => void} dispatch
 * @param {(clientX: number, target: HTMLElement) => number} pxToTime
 * @returns {() => void} dispose
 */
export function attachDropAffordance(lane, getState, dispatch, pxToTime) {
    let depth = 0;

    function show() {
        lane.classList.add('drop-target');
        lane.classList.add('is-drop-active');
        const ind = ensureDropIndicator(lane);
        ind.style.left = endOfTrackPx(getState()) + 'px';
        ind.classList.add('is-visible');
    }

    function hide() {
        lane.classList.remove('drop-target');
        lane.classList.remove('is-drop-active');
        const ind = lane.querySelector('[data-role="drop-indicator"]');
        if (ind) ind.classList.remove('is-visible');
        depth = 0;
    }

    function onDragEnter(e) {
        if (!hasAssetMime(e.dataTransfer)) return;
        e.preventDefault();
        depth += 1;
        show();
    }

    function onDragOver(e) {
        if (!hasAssetMime(e.dataTransfer)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (depth === 0) depth = 1;
        show();
    }

    function onDragLeave(e) {
        if (!hasAssetMime(e.dataTransfer)) return;
        depth = Math.max(0, depth - 1);
        if (depth === 0) hide();
    }

    function onDrop(e) {
        const assetId = e.dataTransfer ? e.dataTransfer.getData(ASSET_MIME) : '';
        hide();
        if (!assetId) return;
        e.preventDefault();
        const t = pxToTime(e.clientX, lane);
        dispatch(SGT_EVENTS.CLIP_ADDED, { assetId, timelineStart: t });
    }

    lane.addEventListener('dragenter', onDragEnter);
    lane.addEventListener('dragover', onDragOver);
    lane.addEventListener('dragleave', onDragLeave);
    lane.addEventListener('drop', onDrop);

    return () => {
        lane.removeEventListener('dragenter', onDragEnter);
        lane.removeEventListener('dragover', onDragOver);
        lane.removeEventListener('dragleave', onDragLeave);
        lane.removeEventListener('drop', onDrop);
    };
}
