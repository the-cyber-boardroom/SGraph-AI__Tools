// timeline-clip-drag.js — clip pointer-drag math for sg-timeline (v0.1.0)

import { snapToFps } from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';

/**
 * Compute the current drag preview (ghost geometry + pending values) for a
 * pointer-move event. Mutates `drag` in place to record the latest pending
 * values so the pointer-up handler can dispatch the right event.
 *
 * @param {object} drag Active drag state.
 * @param {number} dx Pointer deltaX in CSS px.
 * @param {number} pps
 * @param {number} fps
 * @returns {{ leftPx: number, widthPx: number, time: number, inPoint?: number, outPoint?: number }|null}
 */
export function computeDragPreview(drag, dx, pps, fps) {
    const f = fps || 30;
    const dt = snapToFps(dx / pps, f);
    if (drag.kind === 'move') {
        const newStart = Math.max(0, drag.origStart + dt);
        drag.pendingStart = newStart;
        const width = (drag.origOut - drag.origIn) * pps;
        return { leftPx: newStart * pps, widthPx: width, time: newStart };
    }
    if (drag.kind === 'trim-left') {
        const newIn = Math.max(0, Math.min(drag.origOut - 1 / f, drag.origIn + dt));
        const newStart = Math.max(0, drag.origStart + (newIn - drag.origIn));
        const width = (drag.origOut - newIn) * pps;
        drag.pendingIn = newIn;
        drag.pendingStart = newStart;
        return { leftPx: newStart * pps, widthPx: width, time: newStart, inPoint: newIn, outPoint: drag.origOut };
    }
    if (drag.kind === 'trim-right') {
        const newOut = Math.max(drag.origIn + 1 / f, Math.min(drag.assetDur, drag.origOut + dt));
        const width = (newOut - drag.origIn) * pps;
        drag.pendingOut = newOut;
        return { leftPx: drag.origStart * pps, widthPx: width, time: drag.origStart, inPoint: drag.origIn, outPoint: newOut };
    }
    return null;
}

/**
 * Look up a clip object (and its track) by id from any video track.
 * @param {object} state
 * @param {string} clipId
 * @returns {{ clip: object, track: object }|null}
 */
export function findClipAndTrack(state, clipId) {
    const project = state.project;
    if (!project || !Array.isArray(project.tracks)) return null;
    for (const t of project.tracks) {
        if (t && t.kind === 'video' && Array.isArray(t.clips)) {
            for (const c of t.clips) if (c && c.id === clipId) return { clip: c, track: t };
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
export function assetDuration(state, assetId) {
    const a = state.project && state.project.assets;
    if (!a) return Infinity;
    const rec = Array.isArray(a) ? a.find(x => x && x.id === assetId) : a[assetId];
    return (rec && Number.isFinite(rec.duration)) ? rec.duration : Infinity;
}
