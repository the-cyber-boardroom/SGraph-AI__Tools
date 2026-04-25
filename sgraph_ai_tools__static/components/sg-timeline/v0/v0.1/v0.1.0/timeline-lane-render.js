// timeline-lane-render.js — render clips inside a single lane (v0.1.0)

import { clipDuration } from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { clipAsset, clipLabel } from './timeline-clip-label.js';

/**
 * Build a clip rectangle DOM node for one clip in a track.
 * @param {object} clip
 * @param {number} index Clip index within track (drives auto-shade).
 * @param {object} project
 * @param {number} pps
 * @param {boolean} selected
 * @returns {HTMLElement}
 */
function buildClipEl(clip, index, project, pps, selected) {
    const dur = clipDuration(clip);
    const el = document.createElement('div');
    const shade = `clip--shade-${index % 6}`;
    const sel = selected ? ' is-selected selected' : '';
    el.className = `clip ${shade}${sel}`;
    el.dataset.clipId = clip.id || '';
    const assetForClip = clipAsset(clip, project);
    if (assetForClip && assetForClip.assetType) el.dataset.assetType = assetForClip.assetType;
    el.style.left = (clip.timelineStart * pps) + 'px';
    el.style.width = Math.max(2, dur * pps) + 'px';
    if (clip.color && typeof clip.color === 'string') el.style.background = clip.color;
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
    return el;
}

/**
 * Render all clip rectangles for a single track into its lane element.
 * The lane is cleared first.
 * @param {HTMLElement} laneEl
 * @param {object} track
 * @param {object|null} project
 * @param {number} pps
 * @param {string|null} selectedClipId
 * @returns {void}
 */
export function renderLaneClips(laneEl, track, project, pps, selectedClipId) {
    laneEl.innerHTML = '';
    if (!project || !track || !Array.isArray(track.clips)) return;
    if (track.muted) laneEl.classList.add('lane--muted');
    else laneEl.classList.remove('lane--muted');
    for (let i = 0; i < track.clips.length; i += 1) {
        const clip = track.clips[i];
        const sel = clip.id === selectedClipId;
        laneEl.appendChild(buildClipEl(clip, i, project, pps, sel));
    }
}
