// timeline-drop.js — drag/drop affordances for sg-timeline lanes (v0.1.0)

import {
    getTrackDuration,
    getVideoTracks,
} from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { SGT_EVENTS } from './timeline-events.js';
import { findLaneAtY } from './timeline-lane-finder.js';

const ASSET_MIME = 'application/x-sg-asset';

/** Whether a DataTransfer carries the SG asset MIME. */
function hasAssetMime(dt) {
    return !!dt && Array.from(dt.types || []).includes(ASSET_MIME);
}

/**
 * Compute the X position (px) at which a new clip would be appended on a given track.
 * @param {object|null} project
 * @param {string|null} trackId
 * @param {number} pps
 * @returns {number}
 */
function endOfTrackPx(project, trackId, pps) {
    if (!project || !trackId) return 0;
    const track = getVideoTracks(project).find(t => t && t.id === trackId);
    const dur = track ? getTrackDuration(track) : 0;
    return dur * (pps || 0);
}

/** Find or create the absolutely-positioned drop indicator inside a lane. */
function ensureDropIndicator(lane) {
    let el = lane.querySelector('[data-role="drop-indicator"]');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'drop-indicator';
    el.dataset.role = 'drop-indicator';
    lane.appendChild(el);
    return el;
}

/** Hide all drop indicators + remove drop classes across every lane. */
function hideAll(lanesEl) {
    const lanes = lanesEl.querySelectorAll('.lane');
    for (const lane of lanes) {
        lane.classList.remove('drop-target');
        lane.classList.remove('is-drop-active');
        const ind = lane.querySelector('[data-role="drop-indicator"]');
        if (ind) ind.classList.remove('is-visible');
    }
}

/**
 * Attach drag-over / drop affordances + emit clip-added on drop. Highlights
 * the per-lane element under the pointer; on drop the event detail carries
 * the lane's `data-track-id` so the shell knows which track to add to.
 *
 * @param {HTMLElement} lanesEl Container of all .lane elements.
 * @param {() => {project: object|null, pps: number, fps: number}} getState
 * @param {(name: string, detail: object) => void} dispatch
 * @param {(clientX: number, target: HTMLElement) => number} pxToTime
 * @returns {() => void} dispose
 */
export function attachDropAffordance(lanesEl, getState, dispatch, pxToTime) {
    let depth = 0;

    function showOn(lane) {
        hideAll(lanesEl);
        lane.classList.add('drop-target');
        lane.classList.add('is-drop-active');
        const ind = ensureDropIndicator(lane);
        const { project, pps } = getState();
        ind.style.left = endOfTrackPx(project, lane.dataset.trackId, pps) + 'px';
        ind.classList.add('is-visible');
    }

    function onDragEnter(e) {
        if (!hasAssetMime(e.dataTransfer)) return;
        e.preventDefault();
        depth += 1;
        const lane = findLaneAtY(lanesEl, e.clientY);
        if (lane) showOn(lane);
    }

    function onDragOver(e) {
        if (!hasAssetMime(e.dataTransfer)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (depth === 0) depth = 1;
        const lane = findLaneAtY(lanesEl, e.clientY);
        if (lane) showOn(lane);
    }

    function onDragLeave(e) {
        if (!hasAssetMime(e.dataTransfer)) return;
        depth = Math.max(0, depth - 1);
        if (depth === 0) hideAll(lanesEl);
    }

    function onDrop(e) {
        const assetId = e.dataTransfer ? e.dataTransfer.getData(ASSET_MIME) : '';
        depth = 0;
        hideAll(lanesEl);
        if (!assetId) return;
        e.preventDefault();
        const lane = findLaneAtY(lanesEl, e.clientY);
        const trackId = lane ? lane.dataset.trackId || null : null;
        const t = pxToTime(e.clientX, lane || lanesEl);
        dispatch(SGT_EVENTS.CLIP_ADDED, { assetId, timelineStart: t, trackId });
    }

    lanesEl.addEventListener('dragenter', onDragEnter);
    lanesEl.addEventListener('dragover', onDragOver);
    lanesEl.addEventListener('dragleave', onDragLeave);
    lanesEl.addEventListener('drop', onDrop);

    return () => {
        lanesEl.removeEventListener('dragenter', onDragEnter);
        lanesEl.removeEventListener('dragover', onDragOver);
        lanesEl.removeEventListener('dragleave', onDragLeave);
        lanesEl.removeEventListener('drop', onDrop);
    };
}
