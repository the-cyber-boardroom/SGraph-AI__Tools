/** state-clip-ops.js — pure clip-mutation operations on a project. */

import { snapToFps } from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }

/** Locate a clip and its enclosing track inside a project. */
export function findClipLocation(p, clipId) {
    for (const t of p.tracks) {
        const i = t.clips.findIndex(c => c.id === clipId);
        if (i >= 0) return { track: t, index: i };
    }
    return null;
}

/** Sum the longest end across a track's clips. */
export function trackEnd(track) {
    let max = 0;
    for (const c of track.clips) {
        const end = c.timelineStart + (c.outPoint - c.inPoint);
        if (end > max) max = end;
    }
    return max;
}

/** Find a track by id. */
export function findTrack(p, trackId) { return p.tracks.find(t => t.id === trackId) || null; }

/** Find an asset by id. */
export function findAsset(p, assetId) { return p.assets.find(a => a.id === assetId) || null; }

/** Append a new clip referencing an existing asset. Returns its id. */
export function addClipOp(project, params, genId) {
    const { trackId, assetId, timelineStart, inPoint, outPoint, clipId } = params;
    const track = findTrack(project, trackId);
    if (!track) throw badArg(`unknown trackId: ${trackId}`);
    const asset = findAsset(project, assetId);
    if (!asset) throw badArg(`unknown assetId: ${assetId}`);
    const fps = project.project.fps;
    const inP = snapToFps(Number.isFinite(inPoint) ? inPoint : 0, fps);
    const outP = snapToFps(Number.isFinite(outPoint) ? outPoint : asset.duration, fps);
    if (outP <= inP) throw badArg('outPoint must be > inPoint');
    const tStart = snapToFps(Number.isFinite(timelineStart) ? timelineStart : trackEnd(track), fps);
    const id = clipId || genId('c');
    track.clips.push({ id, assetId, timelineStart: tStart, inPoint: inP, outPoint: outP });
    return id;
}

/** Trim a clip's in/out, clamped to asset duration and snapped to fps. */
export function trimClipOp(project, { clipId, inPoint, outPoint }) {
    const loc = findClipLocation(project, clipId);
    if (!loc) throw badArg(`unknown clipId: ${clipId}`);
    const clip = loc.track.clips[loc.index];
    const asset = findAsset(project, clip.assetId);
    const fps = project.project.fps;
    const maxOut = asset ? asset.duration : Infinity;
    const inP = snapToFps(Math.max(0, Number.isFinite(inPoint) ? inPoint : clip.inPoint), fps);
    const outP = snapToFps(Math.min(maxOut, Number.isFinite(outPoint) ? outPoint : clip.outPoint), fps);
    if (outP <= inP) throw badArg('outPoint must be > inPoint');
    clip.inPoint = inP;
    clip.outPoint = outP;
    return { inPoint: inP, outPoint: outP };
}

/** Move a clip's timelineStart, clamped to >= 0 and snapped to fps. */
export function moveClipOp(project, { clipId, timelineStart }) {
    const loc = findClipLocation(project, clipId);
    if (!loc) throw badArg(`unknown clipId: ${clipId}`);
    const fps = project.project.fps;
    const t = snapToFps(Math.max(0, Number(timelineStart) || 0), fps);
    loc.track.clips[loc.index].timelineStart = t;
    return { timelineStart: t };
}

/** Apply or clear a clip's colour override. */
export function setClipColorOp(project, { clipId, color }) {
    const loc = findClipLocation(project, clipId);
    if (!loc) throw badArg(`unknown clipId: ${clipId}`);
    if (color != null && typeof color !== 'string') throw badArg('color must be a string or null');
    const clip = loc.track.clips[loc.index];
    if (color == null || color === '') delete clip.color;
    else clip.color = color;
    return { clipId, color: color == null ? null : color };
}

/** Remove a clip by id. */
export function removeClipOp(project, { clipId }) {
    const loc = findClipLocation(project, clipId);
    if (!loc) throw badArg(`unknown clipId: ${clipId}`);
    loc.track.clips.splice(loc.index, 1);
}
