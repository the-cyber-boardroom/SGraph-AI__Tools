// timeline-render.js — render orchestrator for sg-timeline (v0.1.0)

import {
    getProjectDuration,
    getVideoTracks,
} from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { renderLaneClips } from './timeline-lane-render.js';
import { renderTrackHeader } from './timeline-track-headers.js';

const TICK_TARGET_PX = 80;
export const LANE_HEIGHT = 80;

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

/** Format seconds as mm:ss or m:ss.s. */
function fmtTime(t) {
    if (t < 60) return t.toFixed(t < 10 ? 1 : 0) + 's';
    const m = Math.floor(t / 60);
    const s = Math.floor(t - m * 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** Compute the rendered surface width in px from project + pps. */
export function computeSurfaceWidth(project, pps) {
    const dur = project ? getProjectDuration(project) : 0;
    const minSec = Math.max(dur + 5, 30);
    return Math.ceil(minSec * pps);
}

/** Render ruler ticks. */
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
 * Render the lanes container: one .lane-row per video track, in REVERSE
 * array order so the highest array index (top z-order) is at the top of the UI.
 * Each row has a track-header (sticky-left) and a .lane (clip canvas).
 *
 * @param {HTMLElement} lanesEl
 * @param {object|null} project
 * @param {number} widthPx
 * @param {number} pps
 * @param {string|null} selectedClipId
 * @param {string|null} [selectedTrackId]
 * @returns {void}
 */
export function renderLanes(lanesEl, project, widthPx, pps, selectedClipId, selectedTrackId) {
    lanesEl.innerHTML = '';
    lanesEl.style.width = widthPx + 'px';
    const tracks = project ? getVideoTracks(project) : [];
    if (!tracks.length) return;
    const total = tracks.length;
    for (let i = tracks.length - 1; i >= 0; i--) {
        const track = tracks[i];
        const row = document.createElement('div');
        row.className = 'lane-row';
        row.dataset.trackId = track.id || '';
        row.style.height = LANE_HEIGHT + 'px';
        if (selectedTrackId && track.id === selectedTrackId) row.classList.add('lane-row--selected');
        if (track.locked) row.classList.add('lane-row--locked');

        const lane = document.createElement('div');
        lane.className = 'lane';
        lane.dataset.trackId = track.id || '';
        lane.style.width = widthPx + 'px';
        if (track.locked) lane.classList.add('lane--locked');
        renderLaneClips(lane, track, project, pps, selectedClipId);
        row.appendChild(lane);

        const header = renderTrackHeader(track, i, total, selectedTrackId);
        row.appendChild(header);

        lanesEl.appendChild(row);
    }
}

/** Render the playhead element (position only). */
export function renderPlayhead(playheadEl, time, pps) {
    playheadEl.style.left = (96 + time * pps) + 'px';
}

/** Update playhead position only. */
export function updatePlayhead(playheadEl, time, pps) {
    playheadEl.style.left = (96 + time * pps) + 'px';
}
