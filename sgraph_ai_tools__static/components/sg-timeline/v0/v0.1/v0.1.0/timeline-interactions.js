// timeline-interactions.js — pointer + drop wiring for sg-timeline (v0.1.0)

import { snapToFps } from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { SGT_EVENTS } from './timeline-events.js';
import { attachDropAffordance } from './timeline-drop.js';
import { attachKeyboard } from './timeline-keyboard.js';
import { showDragFeedback, endDragFeedback } from './timeline-feedback.js';
import { attachHeaderButtons } from './timeline-track-headers.js';
import { findLaneAtY } from './timeline-lane-finder.js';
import { computeDragPreview, findClipAndTrack, assetDuration } from './timeline-clip-drag.js';

/**
 * Attach pointer + drop interactions to the timeline shadow root.
 * @param {ShadowRoot} root
 * @param {() => {project: object|null, pps: number, fps: number, playhead?: number, selectedClipId?: string|null, host?: HTMLElement}} getState
 * @param {(name: string, detail: object) => void} dispatch
 * @param {HTMLElement} [hostEl] Custom-element host (for keyboard scope).
 * @returns {() => void} dispose function
 */
export function attachInteractions(root, getState, dispatch, hostEl) {
    const ruler = root.querySelector('.ruler');
    const lanes = root.querySelector('.lanes');
    if (!ruler || !lanes) return () => {};

    let drag = null;

    function pxToTime(clientX, target) {
        const rect = target.getBoundingClientRect();
        const x = clientX - rect.left + target.scrollLeft;
        const { pps, fps } = getState();
        const t = Math.max(0, x / pps);
        return snapToFps(t, fps || 30);
    }

    function onLanesPointerDown(e) {
        const clipEl = e.target.closest('.clip');
        if (!clipEl) return;
        if (e.target.closest('.clip__delete')) return;
        const clipId = clipEl.dataset.clipId;
        const role = e.target.dataset.role || 'move';
        const state = getState();
        const found = findClipAndTrack(state, clipId);
        if (!found) return;
        const sourceLane = clipEl.closest('.lane');
        if (!sourceLane) return;
        e.preventDefault();
        clipEl.setPointerCapture && clipEl.setPointerCapture(e.pointerId);
        drag = {
            kind: role,
            clipId,
            clipEl,
            sourceLane,
            currentLane: sourceLane,
            fromTrackId: found.track.id,
            startX: e.clientX,
            origStart: found.clip.timelineStart,
            origIn: found.clip.inPoint,
            origOut: found.clip.outPoint,
            assetDur: assetDuration(state, found.clip.assetId),
            pointerId: e.pointerId,
            moved: false,
        };
        dispatch(SGT_EVENTS.CLIP_SELECTED, { clipId });
    }

    function clearLaneHighlights() {
        const ls = lanes.querySelectorAll('.lane.is-cross-target');
        for (const l of ls) l.classList.remove('is-cross-target');
    }

    /** Re-resolve the live lane element for `trackId`. The shadow DOM may
     *  rebuild lanes during a drag (e.g. on selection change), which would
     *  orphan our captured `sourceLane`/`currentLane` refs and silently hide
     *  the ghost + label overlay. */
    function liveLaneForTrack(trackId) {
        if (!trackId) return null;
        return lanes.querySelector(`.lane[data-track-id="${trackId}"]`);
    }

    function onPointerMove(e) {
        if (!drag) return;
        const { pps, fps } = getState();
        const dx = e.clientX - drag.startX;
        if (Math.abs(dx) > 2) drag.moved = true;
        const preview = computeDragPreview(drag, dx, pps, fps);
        if (drag.kind === 'move') {
            const targetLane = findLaneAtY(lanes, e.clientY);
            if (targetLane && targetLane !== drag.currentLane) {
                if (drag.currentLane) endDragFeedback(drag.currentLane, null);
                clearLaneHighlights();
                if (targetLane !== drag.sourceLane) targetLane.classList.add('is-cross-target');
                drag.currentLane = targetLane;
            }
            drag.toTrackId = targetLane ? targetLane.dataset.trackId : drag.fromTrackId;
        } else {
            // For trim gestures, re-resolve the source lane each frame so the
            // overlay survives any lane rebuild that happened during the drag.
            const live = liveLaneForTrack(drag.fromTrackId);
            if (live && live !== drag.currentLane) drag.currentLane = live;
        }
        if (preview && drag.moved) {
            const ghostHost = drag.currentLane || drag.sourceLane;
            showDragFeedback(ghostHost, drag, preview, { clientX: e.clientX, clientY: e.clientY });
        }
    }

    function onPointerUp() {
        if (!drag) return;
        const d = drag;
        drag = null;
        clearLaneHighlights();
        endDragFeedback(d.currentLane || d.sourceLane, d.clipEl);
        if (!d.moved) return;
        if (d.kind === 'move' && Number.isFinite(d.pendingStart)) {
            const toTrackId = d.toTrackId || d.fromTrackId;
            if (toTrackId !== d.fromTrackId) {
                dispatch(SGT_EVENTS.CLIP_TRACK_CHANGED, {
                    clipId: d.clipId, fromTrackId: d.fromTrackId, toTrackId,
                    timelineStart: d.pendingStart,
                });
            } else {
                dispatch(SGT_EVENTS.CLIP_MOVED, { clipId: d.clipId, timelineStart: d.pendingStart });
            }
            return;
        }
        if (d.kind === 'trim-left') {
            dispatch(SGT_EVENTS.CLIP_TRIMMED, { clipId: d.clipId, inPoint: d.pendingIn, outPoint: d.origOut });
            if (Number.isFinite(d.pendingStart) && d.pendingStart !== d.origStart) {
                dispatch(SGT_EVENTS.CLIP_MOVED, { clipId: d.clipId, timelineStart: d.pendingStart });
            }
        } else if (d.kind === 'trim-right') {
            dispatch(SGT_EVENTS.CLIP_TRIMMED, { clipId: d.clipId, inPoint: d.origIn, outPoint: d.pendingOut });
        }
    }

    function onPointerCancel() {
        if (!drag) return;
        const d = drag;
        drag = null;
        clearLaneHighlights();
        endDragFeedback(d.currentLane || d.sourceLane, d.clipEl);
    }

    function onRulerPointerDown(e) {
        if (e.target !== ruler && !e.target.classList.contains('tick') && !e.target.classList.contains('tick-label')) return;
        const t = pxToTime(e.clientX, ruler);
        dispatch(SGT_EVENTS.PLAYHEAD_CHANGED, { time: t });
        const onMove = (ev) => dispatch(SGT_EVENTS.PLAYHEAD_CHANGED, { time: pxToTime(ev.clientX, ruler) });
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }

    function onLanesClick(e) {
        if (e.target.closest('[data-role="track-mute"]') || e.target.closest('[data-role="track-remove"]')) return;
        const delEl = e.target.closest && e.target.closest('.clip__delete');
        if (delEl) {
            e.stopPropagation();
            e.preventDefault();
            const clipId = delEl.dataset.clipId || (delEl.closest('.clip') || {}).dataset?.clipId;
            if (clipId) dispatch(SGT_EVENTS.CLIP_DELETED, { clipId });
            return;
        }
        if (e.target.classList && e.target.classList.contains('lane')) {
            dispatch(SGT_EVENTS.CLIP_SELECTED, { clipId: null });
        }
    }

    const disposeDrop = attachDropAffordance(lanes, getState, dispatch, pxToTime);
    const disposeKeys = attachKeyboard(hostEl, getState, dispatch);
    const disposeHeaders = attachHeaderButtons(lanes, dispatch);
    lanes.addEventListener('pointerdown', onLanesPointerDown);
    lanes.addEventListener('click', onLanesClick);
    ruler.addEventListener('pointerdown', onRulerPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
        disposeDrop();
        disposeKeys();
        disposeHeaders();
        lanes.removeEventListener('pointerdown', onLanesPointerDown);
        lanes.removeEventListener('click', onLanesClick);
        ruler.removeEventListener('pointerdown', onRulerPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
    };
}
