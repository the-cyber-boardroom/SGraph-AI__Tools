// timeline-interactions.js — pointer + drop wiring for sg-timeline (v0.1.0)

import { snapToFps } from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { SGT_EVENTS } from './timeline-events.js';
import { attachDropAffordance } from './timeline-drop.js';
import { attachKeyboard } from './timeline-keyboard.js';
import { showDragFeedback, endDragFeedback } from './timeline-feedback.js';

/**
 * Look up a clip object by id from the first video track of state.project.
 * @param {object} state
 * @param {string} clipId
 * @returns {object|null}
 */
function findClip(state, clipId) {
    const project = state.project;
    if (!project || !Array.isArray(project.tracks)) return null;
    for (const t of project.tracks) {
        if (t && t.kind === 'video' && Array.isArray(t.clips)) {
            for (const c of t.clips) if (c && c.id === clipId) return c;
        }
    }
    return null;
}

/**
 * Asset duration lookup (project.assets keyed by id or array).
 * @param {object} state
 * @param {string} assetId
 * @returns {number}
 */
function assetDuration(state, assetId) {
    const a = state.project && state.project.assets;
    if (!a) return Infinity;
    const rec = Array.isArray(a) ? a.find(x => x && x.id === assetId) : a[assetId];
    return (rec && Number.isFinite(rec.duration)) ? rec.duration : Infinity;
}

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
    const lane = root.querySelector('.lane');
    if (!ruler || !lane) return () => {};

    let drag = null;

    function pxToTime(clientX, target) {
        const rect = target.getBoundingClientRect();
        const x = clientX - rect.left + target.scrollLeft;
        const { pps, fps } = getState();
        const t = Math.max(0, x / pps);
        return snapToFps(t, fps || 30);
    }

    function onLanePointerDown(e) {
        const clipEl = e.target.closest('.clip');
        if (!clipEl) return;
        if (e.target.closest('.clip__delete')) return;
        const clipId = clipEl.dataset.clipId;
        const role = e.target.dataset.role || 'move';
        const state = getState();
        const clip = findClip(state, clipId);
        if (!clip) return;
        e.preventDefault();
        clipEl.setPointerCapture && clipEl.setPointerCapture(e.pointerId);
        drag = {
            kind: role,
            clipId,
            clipEl,
            startX: e.clientX,
            origStart: clip.timelineStart,
            origIn: clip.inPoint,
            origOut: clip.outPoint,
            assetDur: assetDuration(state, clip.assetId),
            pointerId: e.pointerId,
            moved: false,
        };
        dispatch(SGT_EVENTS.CLIP_SELECTED, { clipId });
    }

    function onPointerMove(e) {
        if (!drag) return;
        const { pps, fps } = getState();
        const dx = e.clientX - drag.startX;
        const dt = snapToFps(dx / pps, fps || 30);
        if (Math.abs(dx) > 2) drag.moved = true;
        let preview = null;
        if (drag.kind === 'move') {
            const newStart = Math.max(0, drag.origStart + dt);
            drag.pendingStart = newStart;
            const width = (drag.origOut - drag.origIn) * pps;
            preview = { leftPx: newStart * pps, widthPx: width, time: newStart };
        } else if (drag.kind === 'trim-left') {
            const newIn = Math.max(0, Math.min(drag.origOut - 1 / (fps || 30), drag.origIn + dt));
            const newStart = Math.max(0, drag.origStart + (newIn - drag.origIn));
            const width = (drag.origOut - newIn) * pps;
            drag.pendingIn = newIn;
            drag.pendingStart = newStart;
            preview = { leftPx: newStart * pps, widthPx: width, time: newStart, inPoint: newIn, outPoint: drag.origOut };
        } else if (drag.kind === 'trim-right') {
            const newOut = Math.max(drag.origIn + 1 / (fps || 30), Math.min(drag.assetDur, drag.origOut + dt));
            const width = (newOut - drag.origIn) * pps;
            drag.pendingOut = newOut;
            preview = { leftPx: drag.origStart * pps, widthPx: width, time: drag.origStart, inPoint: drag.origIn, outPoint: newOut };
        }
        if (preview && drag.moved) {
            showDragFeedback(lane, drag, preview, { clientX: e.clientX, clientY: e.clientY });
        }
    }

    function onPointerUp() {
        if (!drag) return;
        const d = drag;
        drag = null;
        endDragFeedback(lane, d.clipEl);
        if (!d.moved) return;
        if (d.kind === 'move' && Number.isFinite(d.pendingStart)) {
            dispatch(SGT_EVENTS.CLIP_MOVED, { clipId: d.clipId, timelineStart: d.pendingStart });
        } else if (d.kind === 'trim-left') {
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
        endDragFeedback(lane, d.clipEl);
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

    function onLaneClick(e) {
        const delEl = e.target.closest && e.target.closest('.clip__delete');
        if (delEl) {
            e.stopPropagation();
            e.preventDefault();
            const clipId = delEl.dataset.clipId || (delEl.closest('.clip') || {}).dataset?.clipId;
            if (clipId) dispatch(SGT_EVENTS.CLIP_DELETED, { clipId });
            return;
        }
        if (e.target === lane) dispatch(SGT_EVENTS.CLIP_SELECTED, { clipId: null });
    }

    const disposeDrop = attachDropAffordance(lane, getState, dispatch, pxToTime);
    const disposeKeys = attachKeyboard(hostEl, getState, dispatch);
    lane.addEventListener('pointerdown', onLanePointerDown);
    lane.addEventListener('click', onLaneClick);
    ruler.addEventListener('pointerdown', onRulerPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
        disposeDrop();
        disposeKeys();
        lane.removeEventListener('pointerdown', onLanePointerDown);
        lane.removeEventListener('click', onLaneClick);
        ruler.removeEventListener('pointerdown', onRulerPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
    };
}
