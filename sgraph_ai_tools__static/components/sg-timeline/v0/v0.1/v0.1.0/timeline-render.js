// timeline-render.js — pure render functions for sg-timeline (v0.1.0)

import {
    clipDuration,
    getProjectDuration,
    getVideoTracks,
} from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';

const TICK_TARGET_PX = 80;

/**
 * Pick a tick interval (seconds) for the given pps.
 * @param {number} pps Pixels per second.
 * @returns {number}
 */
function pickTickInterval(pps) {
    const targetSec = TICK_TARGET_PX / Math.max(pps, 1);
    const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
    for (const c of candidates) if (c >= targetSec) return c;
    return candidates[candidates.length - 1];
}

/**
 * Format seconds as mm:ss or m:ss.s.
 * @param {number} t
 * @returns {string}
 */
function fmtTime(t) {
    if (t < 60) return t.toFixed(t < 10 ? 1 : 0) + 's';
    const m = Math.floor(t / 60);
    const s = Math.floor(t - m * 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Compute the rendered surface width in px from project + pps.
 * @param {object} project
 * @param {number} pps
 * @returns {number}
 */
export function computeSurfaceWidth(project, pps) {
    const dur = project ? getProjectDuration(project) : 0;
    const minSec = Math.max(dur + 5, 30);
    return Math.ceil(minSec * pps);
}

/**
 * Render ruler ticks.
 * @param {HTMLElement} rulerEl
 * @param {number} widthPx
 * @param {number} pps
 * @returns {void}
 */
export function renderRuler(rulerEl, widthPx, pps) {
    rulerEl.innerHTML = '';
    rulerEl.style.width = widthPx + 'px';
    const interval = pickTickInterval(pps);
    const totalSec = widthPx / pps;
    for (let t = 0; t <= totalSec; t += interval) {
        const x = t * pps;
        const tick = document.createElement('div');
        tick.className = 'tick';
        tick.style.left = x + 'px';
        rulerEl.appendChild(tick);
        const label = document.createElement('div');
        label.className = 'tick-label';
        label.style.left = x + 'px';
        label.textContent = fmtTime(t);
        rulerEl.appendChild(label);
    }
}

/**
 * Render the lane container width.
 * @param {HTMLElement} laneEl
 * @param {number} widthPx
 * @returns {void}
 */
export function renderTrack(laneEl, widthPx) {
    laneEl.style.width = widthPx + 'px';
}

/**
 * Resolve a clip's display label (asset name or assetId).
 * @param {object} clip
 * @param {object} project
 * @returns {string}
 */
function clipLabel(clip, project) {
    const assets = project && project.assets;
    if (assets && typeof assets === 'object') {
        const a = Array.isArray(assets) ? assets.find(x => x && x.id === clip.assetId) : assets[clip.assetId];
        if (a && a.name) return a.name;
    }
    return clip.assetId;
}

/**
 * Render clip rectangles for the first video track.
 * @param {HTMLElement} laneEl
 * @param {object|null} project
 * @param {number} pps
 * @param {string|null} selectedClipId
 * @returns {void}
 */
export function renderClips(laneEl, project, pps, selectedClipId) {
    laneEl.innerHTML = '';
    if (!project) return;
    const track = getVideoTracks(project)[0];
    if (!track) return;
    for (let i = 0; i < track.clips.length; i += 1) {
        const clip = track.clips[i];
        const dur = clipDuration(clip);
        const el = document.createElement('div');
        const shade = `clip--shade-${i % 4}`;
        const sel = clip.id === selectedClipId ? ' is-selected selected' : '';
        el.className = `clip ${shade}${sel}`;
        el.dataset.clipId = clip.id || '';
        el.style.left = (clip.timelineStart * pps) + 'px';
        el.style.width = Math.max(2, dur * pps) + 'px';
        const label = document.createElement('div');
        label.className = 'clip-label';
        label.textContent = clipLabel(clip, project);
        el.appendChild(label);
        const durEl = document.createElement('div');
        durEl.className = 'clip-duration';
        durEl.textContent = dur.toFixed(2) + 's';
        el.appendChild(durEl);
        const lh = document.createElement('div');
        lh.className = 'clip-handle left';
        lh.dataset.role = 'trim-left';
        el.appendChild(lh);
        const rh = document.createElement('div');
        rh.className = 'clip-handle right';
        rh.dataset.role = 'trim-right';
        el.appendChild(rh);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'clip__delete';
        del.dataset.role = 'delete';
        del.dataset.clipId = clip.id || '';
        del.setAttribute('aria-label', 'Delete clip');
        del.title = 'Delete clip';
        del.textContent = '×';
        el.appendChild(del);
        laneEl.appendChild(el);
    }
}

/**
 * Render the playhead element (position only).
 * @param {HTMLElement} playheadEl
 * @param {number} time
 * @param {number} pps
 * @returns {void}
 */
export function renderPlayhead(playheadEl, time, pps) {
    playheadEl.style.left = (time * pps) + 'px';
}

/**
 * Update playhead position only.
 * @param {HTMLElement} playheadEl
 * @param {number} time
 * @param {number} pps
 * @returns {void}
 */
export function updatePlayhead(playheadEl, time, pps) {
    playheadEl.style.left = (time * pps) + 'px';
}
