// timeline-track-headers.js — per-lane sticky-left header DOM (v0.1.0)

import { SGT_EVENTS } from './timeline-events.js';

/**
 * Build a sticky-left header strip for a single lane.
 * Contains: track label (click-to-select / dbl-click-or-edit-icon to rename) +
 * mute toggle (M) + lock toggle (L) + remove button (×).
 * Buttons dispatch corresponding TRACK_*_REQUESTED events on the host
 * via bubbling CustomEvents so the SgTimeline relays them outward.
 *
 * @param {object} track
 * @param {number} arrayIndex Bottom-up index in the project's videoTracks list.
 * @param {number} totalTracks Total video tracks (drives "remove" disabled).
 * @param {string|null} selectedTrackId
 * @returns {HTMLElement}
 */
export function renderTrackHeader(track, arrayIndex, totalTracks, selectedTrackId) {
    const root = document.createElement('div');
    root.className = 'track-header';
    root.dataset.trackId = track.id || '';
    root.dataset.role = 'track-header';
    const muted = !!track.muted;
    const locked = !!track.locked;
    const selected = !!(selectedTrackId && selectedTrackId === track.id);
    if (muted) root.classList.add('track-header--muted');
    if (locked) root.classList.add('track-header--locked');
    if (selected) root.classList.add('track-header--selected');

    const labelWrap = document.createElement('div');
    labelWrap.className = 'track-header__label-wrap';
    const label = document.createElement('div');
    label.className = 'track-header__label';
    label.dataset.role = 'track-label';
    label.dataset.trackId = track.id || '';
    label.title = 'Click to select · double-click (or pencil) to rename';
    const labelText = (typeof track.name === 'string' && track.name)
        ? track.name
        : `Track ${arrayIndex + 1}`;
    label.textContent = labelText;

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'track-header__rename';
    renameBtn.dataset.role = 'track-rename';
    renameBtn.dataset.trackId = track.id || '';
    renameBtn.title = 'Rename track';
    renameBtn.setAttribute('aria-label', 'Rename track');
    renameBtn.textContent = '✎'; // pencil

    labelWrap.appendChild(label);
    labelWrap.appendChild(renameBtn);

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

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'track-header__lock' + (locked ? ' is-locked' : '');
    lockBtn.dataset.role = 'track-lock';
    lockBtn.dataset.trackId = track.id || '';
    lockBtn.dataset.locked = locked ? '1' : '0';
    lockBtn.setAttribute('aria-pressed', locked ? 'true' : 'false');
    lockBtn.title = locked ? 'Unlock track' : 'Lock track';
    lockBtn.textContent = locked ? '\u{1F512}' : '\u{1F513}';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'track-header__remove';
    removeBtn.dataset.role = 'track-remove';
    removeBtn.dataset.trackId = track.id || '';
    removeBtn.title = 'Remove track';
    removeBtn.textContent = '×';
    if (totalTracks <= 1) removeBtn.disabled = true;
    if (locked) removeBtn.disabled = true;

    btns.appendChild(muteBtn);
    btns.appendChild(lockBtn);
    btns.appendChild(removeBtn);
    root.appendChild(labelWrap);
    root.appendChild(btns);
    return root;
}

/** Replace the label DOM with an inline <input> for renaming. */
function startRename(labelEl, dispatch) {
    if (!labelEl || labelEl.querySelector('input')) return;
    const trackId = labelEl.dataset.trackId;
    if (!trackId) return;
    const original = labelEl.textContent || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = original;
    input.className = 'track-header__rename-input';
    input.setAttribute('aria-label', 'Track name');
    let done = false;
    function commit(save) {
        if (done) return;
        done = true;
        if (save) {
            const next = input.value.trim();
            if (next !== original.trim()) {
                dispatch(SGT_EVENTS.TRACK_RENAMED, { trackId, name: next });
            }
        }
        // Restore the label text. Re-render from project state will replace
        // it with the canonical default if `next` is blank.
        labelEl.textContent = save ? (input.value.trim() || original) : original;
    }
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(true); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); commit(false); input.blur(); }
    });
    input.addEventListener('blur', () => commit(true));
    labelEl.textContent = '';
    labelEl.appendChild(input);
    input.focus();
    input.select();
}

/**
 * Attach a click delegate to the lanes container for header buttons + label
 * click-to-select / double-click-to-rename. Dispatches all the TRACK_*
 * events. Returns a dispose function.
 *
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
        const lockEl = e.target.closest && e.target.closest('[data-role="track-lock"]');
        if (lockEl) {
            e.preventDefault();
            e.stopPropagation();
            const trackId = lockEl.dataset.trackId;
            if (!trackId) return;
            const locked = lockEl.dataset.locked !== '1';
            dispatch(SGT_EVENTS.TRACK_LOCK_REQUESTED, { trackId, locked });
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
            return;
        }
        const renameEl = e.target.closest && e.target.closest('[data-role="track-rename"]');
        if (renameEl) {
            e.preventDefault();
            e.stopPropagation();
            const wrap = renameEl.closest('.track-header__label-wrap');
            const lbl = wrap && wrap.querySelector('[data-role="track-label"]');
            if (lbl) startRename(lbl, dispatch);
            return;
        }
        const labelEl = e.target.closest && e.target.closest('[data-role="track-label"]');
        if (labelEl) {
            // If we're in rename mode (input present) leave the click alone.
            if (labelEl.querySelector('input')) return;
            const headerEl = labelEl.closest('.track-header');
            const trackId = (headerEl && headerEl.dataset.trackId) || labelEl.dataset.trackId;
            if (!trackId) return;
            // Toggle: click again to deselect.
            const currentlySelected = headerEl && headerEl.classList.contains('track-header--selected');
            dispatch(SGT_EVENTS.TRACK_SELECTED, {
                trackId: currentlySelected ? null : trackId,
            });
            return;
        }
        // Click on the empty header area selects the track too.
        const headerEl = e.target.closest && e.target.closest('[data-role="track-header"]');
        if (headerEl && !e.target.closest('button') && !e.target.closest('input')) {
            const trackId = headerEl.dataset.trackId;
            if (!trackId) return;
            const currentlySelected = headerEl.classList.contains('track-header--selected');
            dispatch(SGT_EVENTS.TRACK_SELECTED, {
                trackId: currentlySelected ? null : trackId,
            });
        }
    }
    function onDblClick(e) {
        const labelEl = e.target.closest && e.target.closest('[data-role="track-label"]');
        if (!labelEl) return;
        e.preventDefault();
        e.stopPropagation();
        startRename(labelEl, dispatch);
    }
    lanesEl.addEventListener('click', onClick);
    lanesEl.addEventListener('dblclick', onDblClick);
    return () => {
        lanesEl.removeEventListener('click', onClick);
        lanesEl.removeEventListener('dblclick', onDblClick);
    };
}
