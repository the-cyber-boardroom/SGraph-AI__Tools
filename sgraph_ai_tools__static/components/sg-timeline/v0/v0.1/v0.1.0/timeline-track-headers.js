// timeline-track-headers.js — per-lane sticky-left header DOM (v0.1.0)

import { SGT_EVENTS } from './timeline-events.js';

/**
 * Build a sticky-left header strip for a single lane.
 * Contains: track label + mute toggle (M) + remove button (×).
 * Buttons dispatch TRACK_MUTE_REQUESTED / TRACK_REMOVE_REQUESTED on the host
 * via bubbling CustomEvents so the SgTimeline relays them outward.
 *
 * @param {object} track
 * @param {number} arrayIndex Bottom-up index in the project's videoTracks list.
 * @param {number} totalTracks Total video tracks (drives "remove" disabled).
 * @returns {HTMLElement}
 */
export function renderTrackHeader(track, arrayIndex, totalTracks) {
    const root = document.createElement('div');
    root.className = 'track-header';
    root.dataset.trackId = track.id || '';
    const muted = !!track.muted;
    if (muted) root.classList.add('track-header--muted');

    const label = document.createElement('div');
    label.className = 'track-header__label';
    label.textContent = (typeof track.name === 'string' && track.name)
        ? track.name
        : `Track ${arrayIndex + 1}`;
    label.title = label.textContent;

    const btns = document.createElement('div');
    btns.className = 'track-header__btns';

    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'track-header__mute' + (muted ? ' is-muted' : '');
    muteBtn.dataset.role = 'track-mute';
    muteBtn.dataset.trackId = track.id || '';
    muteBtn.dataset.muted = muted ? '1' : '0';
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    muteBtn.title = muted ? 'Unmute track' : 'Mute track';
    muteBtn.textContent = 'M';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'track-header__remove';
    removeBtn.dataset.role = 'track-remove';
    removeBtn.dataset.trackId = track.id || '';
    removeBtn.title = 'Remove track';
    removeBtn.textContent = '×';
    if (totalTracks <= 1) removeBtn.disabled = true;

    btns.appendChild(muteBtn);
    btns.appendChild(removeBtn);
    root.appendChild(label);
    root.appendChild(btns);
    return root;
}

/**
 * Attach a click delegate to the lanes container for header buttons.
 * Dispatches TRACK_MUTE_REQUESTED / TRACK_REMOVE_REQUESTED.
 * @param {HTMLElement} lanesEl
 * @param {(name: string, detail: object) => void} dispatch
 * @returns {() => void}
 */
export function attachHeaderButtons(lanesEl, dispatch) {
    function onClick(e) {
        const muteEl = e.target.closest && e.target.closest('[data-role="track-mute"]');
        if (muteEl) {
            e.preventDefault();
            e.stopPropagation();
            const trackId = muteEl.dataset.trackId;
            if (!trackId) return;
            const muted = muteEl.dataset.muted !== '1';
            dispatch(SGT_EVENTS.TRACK_MUTE_REQUESTED, { trackId, muted });
            return;
        }
        const removeEl = e.target.closest && e.target.closest('[data-role="track-remove"]');
        if (removeEl) {
            e.preventDefault();
            e.stopPropagation();
            if (removeEl.disabled) return;
            const trackId = removeEl.dataset.trackId;
            if (!trackId) return;
            dispatch(SGT_EVENTS.TRACK_REMOVE_REQUESTED, { trackId });
        }
    }
    lanesEl.addEventListener('click', onClick);
    return () => lanesEl.removeEventListener('click', onClick);
}
