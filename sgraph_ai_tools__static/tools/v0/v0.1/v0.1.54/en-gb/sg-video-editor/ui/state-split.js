/** state-split.js — pure splitClip operation extracted from state.js. */

import { snapToFps } from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { assertTrackUnlocked } from './state-track-ops.js';

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }

/**
 * Split the clip at `clipId` at timeline-time `atTime`.
 * Mutates `track.clips` in place: truncates the left half and inserts the
 * right half immediately after.
 *
 * @param {{tracks: Array<{clips: Array<object>}>, project: {fps: number}}} project
 * @param {{clipId: string, atTime: number}} params
 * @param {(prefix: string) => string} genId
 * @returns {{newClipId: string, atTime: number}}
 */
export function splitClipOp(project, { clipId, atTime }, genId) {
    let loc = null;
    for (const t of project.tracks) {
        const i = t.clips.findIndex(c => c.id === clipId);
        if (i >= 0) { loc = { track: t, index: i }; break; }
    }
    if (!loc) throw badArg(`unknown clipId: ${clipId}`);
    // Lock check (sweep introduced in d412dda missed this op — see task 6).
    // Splitting mutates clip.outPoint AND inserts a new clip on the same
    // track, so it's a content mutation that must respect the lock flag.
    assertTrackUnlocked(project, loc.track.id);
    const clip = loc.track.clips[loc.index];
    const fps = project.project.fps;
    const t = snapToFps(Number(atTime), fps);
    const clipEnd = clip.timelineStart + (clip.outPoint - clip.inPoint);
    if (!(t > clip.timelineStart && t < clipEnd)) {
        throw badArg('split point must be strictly inside the clip');
    }
    const splitOffset = t - clip.timelineStart;
    const newOutPoint = snapToFps(clip.inPoint + splitOffset, fps);
    if (newOutPoint <= clip.inPoint || newOutPoint >= clip.outPoint) {
        throw badArg('split point must be strictly inside the clip');
    }
    const newId = genId('c');
    const right = {
        id: newId,
        inPoint: newOutPoint,
        outPoint: clip.outPoint,
        timelineStart: t,
    };
    // Carry over the kind-specific fields so the right half is a valid clip
    // of the same kind (asset / shape / text).
    if (clip.kind === 'shape' && clip.shape) {
        right.kind = 'shape';
        right.shape = { ...clip.shape };
    } else if (clip.kind === 'text' && clip.text) {
        right.kind = 'text';
        right.text = { ...clip.text };
    } else {
        right.assetId = clip.assetId;
    }
    if (clip.color) right.color = clip.color;
    if (clip.name) right.name = clip.name;
    if (clip.transform) right.transform = { ...clip.transform };
    if (clip.crop) right.crop = { ...clip.crop };
    clip.outPoint = newOutPoint;
    loc.track.clips.splice(loc.index + 1, 0, right);
    return { newClipId: newId, atTime: t };
}
