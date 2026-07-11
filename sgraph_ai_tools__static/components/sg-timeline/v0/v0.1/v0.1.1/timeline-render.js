// timeline-render.js — render orchestrator for sg-timeline (v0.1.0)

import {
    getProjectDuration,
    getVideoTracks,
} from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { renderLaneClips } from './timeline-lane-render.js';
import { renderTrackHeader } from './timeline-track-headers.js';

const TICK_TARGET_PX = 80;
/** Hard cap on ruler ticks. Prevents thousands of DOM nodes for long videos
 *  at high pps (e.g. 2hr video at 60px/s = 7200 ticks without this cap). */
const MAX_RULER_TICKS = 120;
/** Height of a single lane row in pixels. Kept in sync with the
 *  `--sgt-lane-height` CSS custom property in sg-timeline.css. Compact
 *  default since Round-9-I Task 2 (was 80). */
export const LANE_HEIGHT = 44;

console.log('[sgve-timeline] timeline-render.js v5 loaded (tick cap overflow fix + h:mm:ss labels)');

/**
 * Pick a tick interval (seconds) for the given pps and total duration.
 * The interval is the larger of the visual-density target and the cap-driven
 * minimum, so we never render more than MAX_RULER_TICKS ticks.
 * @param {number} pps Pixels per second.
 * @param {number} totalSec Total timeline duration in seconds.
 * @returns {number}
 */
function pickTickInterval(pps, totalSec) {
    const targetSec = TICK_TARGET_PX / Math.max(pps, 1);
    const minForCap  = totalSec > 0 ? totalSec / MAX_RULER_TICKS : 0;
    const effective  = Math.max(targetSec, minForCap);
    const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600];
    for (const c of candidates) if (c >= effective) return c;
    // Duration exceeds all candidates — compute directly so the cap is always honoured.
    return Math.ceil(totalSec / MAX_RULER_TICKS);
}

/** Format seconds as [h:]mm:ss or s.s for short clips. */
function fmtTime(t) {
    if (t < 60) return t.toFixed(t < 10 ? 1 : 0) + 's';
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** Compute the rendered surface width in px from project + pps. */
export function computeSurfaceWidth(project, pps) {
    const dur = project ? getProjectDuration(project) : 0;
    const minSec = Math.max(dur + 5, 30);
    return Math.ceil(minSec * pps);
}

/** Render ruler ticks into rulerEl using a DocumentFragment (one live-DOM insert). */
export function renderRuler(rulerEl, widthPx, pps) {
    const t0 = performance.now();
    rulerEl.style.width = widthPx + 'px';
    const totalSec = widthPx / pps;
    const interval = pickTickInterval(pps, totalSec);
    const frag = document.createDocumentFragment();
    let tickCount = 0;
    for (let t = 0; t <= totalSec; t += interval) {
        const x = t * pps;
        const tick = document.createElement('div');
        tick.className = 'tick';
        tick.style.left = x + 'px';
        frag.appendChild(tick);
        const label = document.createElement('div');
        label.className = 'tick-label';
        label.style.left = x + 'px';
        label.textContent = fmtTime(t);
        frag.appendChild(label);
        tickCount++;
    }
    rulerEl.innerHTML = '';
    rulerEl.appendChild(frag);
    const ms = (performance.now() - t0).toFixed(1);
    console.log(`[sgve-timeline] renderRuler: widthPx=${widthPx} pps=${pps} dur=${totalSec.toFixed(0)}s interval=${interval}s ticks=${tickCount} ${ms}ms`);
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
    lanesEl.style.width = widthPx + 'px';
    const tracks = project ? getVideoTracks(project) : [];
    if (!tracks.length) { lanesEl.innerHTML = ''; return; }
    const total = tracks.length;
    const frag = document.createDocumentFragment();
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

        frag.appendChild(row);
    }
    lanesEl.innerHTML = '';
    lanesEl.appendChild(frag);
}

/** Render the playhead element (position only). */
export function renderPlayhead(playheadEl, time, pps) {
    playheadEl.style.left = (96 + time * pps) + 'px';
}

/** Update playhead position only. */
export function updatePlayhead(playheadEl, time, pps) {
    playheadEl.style.left = (96 + time * pps) + 'px';
}
