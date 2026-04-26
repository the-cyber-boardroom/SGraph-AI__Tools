/** state-clip-ops.js — pure clip-mutation operations on a project. */

import {
    snapToFps, clampTransform, clampCrop,
    clampShape, clampText, defaultClipDuration,
    isShapeClip, isTextClip,
} from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { assertNoOverlap, snapToClearSlot } from './state-overlap.js';

/**
 * Resolve `[proposedStart, proposedEnd)` against existing clips on `track`. If
 * the range overlaps a neighbour, return the snap-abut placement (flush before
 * or flush after) snapped to fps. Returns the original (fps-snapped) start if
 * no overlap. Returns `null` if neither side clears, signalling the caller to
 * raise the usual overlap error.
 *
 * Centralised here so `addClipOp` / `moveClipOp` (and the shape/text/track
 * variants) all share the same heuristic.
 */
function resolveSnapStart(track, proposedStart, duration, fps, excludeClipId) {
    const next = snapToClearSlot(track, proposedStart, proposedStart + duration, excludeClipId);
    if (next == null) return null;
    return snapToFps(Math.max(0, next), fps);
}

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

const DEFAULT_IMAGE_DURATION_SEC = 5;

/** Append a new clip referencing an existing asset. Returns its id.
 *  When `params.snap === true`, an overlapping placement is auto-resolved by
 *  flush-abutting the nearest neighbour edge (see `snapToClearSlot`); the
 *  user-chosen `timelineStart` is preserved when there is no overlap. */
export function addClipOp(project, params, genId) {
    const { trackId, assetId, timelineStart, inPoint, outPoint, clipId, snap } = params;
    const track = findTrack(project, trackId);
    if (!track) throw badArg(`unknown trackId: ${trackId}`);
    const asset = findAsset(project, assetId);
    if (!asset) throw badArg(`unknown assetId: ${assetId}`);
    const fps = project.project.fps;
    const isImage = asset.assetType === 'image';
    const defaultIn = 0;
    const defaultOut = isImage ? DEFAULT_IMAGE_DURATION_SEC : asset.duration;
    const inP = snapToFps(Number.isFinite(inPoint) ? inPoint : defaultIn, fps);
    const outP = snapToFps(Number.isFinite(outPoint) ? outPoint : defaultOut, fps);
    if (outP <= inP) throw badArg('outPoint must be > inPoint');
    let tStart = snapToFps(Number.isFinite(timelineStart) ? timelineStart : trackEnd(track), fps);
    const id = clipId || genId('c');
    if (snap) {
        const dur = outP - inP;
        const adj = resolveSnapStart(track, tStart, dur, fps, id);
        if (adj == null) assertNoOverlap(track, tStart, tStart + dur, id); // throws
        else tStart = adj;
    } else {
        assertNoOverlap(track, tStart, tStart + (outP - inP), id);
    }
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
    const isImage = asset && asset.assetType === 'image';
    const maxOut = (asset && Number.isFinite(asset.duration) && !isImage) ? asset.duration : Infinity;
    const inP = snapToFps(Math.max(0, Number.isFinite(inPoint) ? inPoint : clip.inPoint), fps);
    const outP = snapToFps(Math.min(maxOut, Number.isFinite(outPoint) ? outPoint : clip.outPoint), fps);
    if (outP <= inP) throw badArg('outPoint must be > inPoint');
    assertNoOverlap(loc.track, clip.timelineStart, clip.timelineStart + (outP - inP), clipId);
    clip.inPoint = inP;
    clip.outPoint = outP;
    return { inPoint: inP, outPoint: outP };
}

/** Move a clip's timelineStart, clamped to >= 0 and snapped to fps.
 *  When `params.snap === true`, an overlapping placement is auto-resolved by
 *  flush-abutting the nearest neighbour edge (see `snapToClearSlot`); the
 *  user-chosen `timelineStart` is preserved when there is no overlap. */
export function moveClipOp(project, { clipId, timelineStart, snap }) {
    const loc = findClipLocation(project, clipId);
    if (!loc) throw badArg(`unknown clipId: ${clipId}`);
    const fps = project.project.fps;
    const clip = loc.track.clips[loc.index];
    let t = snapToFps(Math.max(0, Number(timelineStart) || 0), fps);
    const dur = clip.outPoint - clip.inPoint;
    if (snap) {
        const adj = resolveSnapStart(loc.track, t, dur, fps, clipId);
        if (adj == null) assertNoOverlap(loc.track, t, t + dur, clipId); // throws
        else t = adj;
    } else {
        assertNoOverlap(loc.track, t, t + dur, clipId);
    }
    clip.timelineStart = t;
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

/** Apply or clear a clip's per-frame transform (x/y centre + scale; 0..1). */
export function setClipTransformOp(project, { clipId, transform }) {
    const loc = findClipLocation(project, clipId);
    if (!loc) throw badArg(`unknown clipId: ${clipId}`);
    const clip = loc.track.clips[loc.index];
    if (transform == null) { delete clip.transform; return { clipId, transform: null }; }
    if (typeof transform !== 'object') throw badArg('transform must be an object or null');
    const next = clampTransform(transform);
    clip.transform = next;
    return { clipId, transform: { ...next } };
}

/** Apply or clear a clip's per-frame source crop (x/y/w/h; 0..1). */
export function setClipCropOp(project, { clipId, crop }) {
    const loc = findClipLocation(project, clipId);
    if (!loc) throw badArg(`unknown clipId: ${clipId}`);
    const clip = loc.track.clips[loc.index];
    if (crop == null) { delete clip.crop; return { clipId, crop: null }; }
    if (typeof crop !== 'object') throw badArg('crop must be an object or null');
    const next = clampCrop(crop);
    clip.crop = next;
    return { clipId, crop: { ...next } };
}

/** Append a shape clip (no asset). Returns its id.
 *  Honours `params.snap` like `addClipOp`. */
export function addShapeClipOp(project, params, genId) {
    const { trackId, timelineStart, duration, clipId, shape, snap } = params;
    const track = findTrack(project, trackId);
    if (!track) throw badArg(`unknown trackId: ${trackId}`);
    const fps = project.project.fps;
    const dur = (Number.isFinite(duration) && duration > 0) ? duration : defaultClipDuration();
    let tStart = snapToFps(Number.isFinite(timelineStart) ? timelineStart : trackEnd(track), fps);
    const id = clipId || genId('s');
    if (snap) {
        const adj = resolveSnapStart(track, tStart, dur, fps, id);
        if (adj == null) assertNoOverlap(track, tStart, tStart + dur, id);
        else tStart = adj;
    } else {
        assertNoOverlap(track, tStart, tStart + dur, id);
    }
    track.clips.push({
        id, kind: 'shape', shape: clampShape(shape),
        timelineStart: tStart, inPoint: 0, outPoint: dur,
    });
    return id;
}

/** Append a text clip (no asset). Returns its id.
 *  Honours `params.snap` like `addClipOp`. */
export function addTextClipOp(project, params, genId) {
    const { trackId, timelineStart, duration, clipId, text, snap } = params;
    const track = findTrack(project, trackId);
    if (!track) throw badArg(`unknown trackId: ${trackId}`);
    const fps = project.project.fps;
    const dur = (Number.isFinite(duration) && duration > 0) ? duration : defaultClipDuration();
    let tStart = snapToFps(Number.isFinite(timelineStart) ? timelineStart : trackEnd(track), fps);
    const id = clipId || genId('t');
    if (snap) {
        const adj = resolveSnapStart(track, tStart, dur, fps, id);
        if (adj == null) assertNoOverlap(track, tStart, tStart + dur, id);
        else tStart = adj;
    } else {
        assertNoOverlap(track, tStart, tStart + dur, id);
    }
    track.clips.push({
        id, kind: 'text', text: clampText(text),
        timelineStart: tStart, inPoint: 0, outPoint: dur,
    });
    return id;
}

/** Patch a shape clip's shape config and/or transform atomically. */
export function setShapePropsOp(project, { clipId, shape, transform }) {
    const loc = findClipLocation(project, clipId);
    if (!loc) throw badArg(`unknown clipId: ${clipId}`);
    const clip = loc.track.clips[loc.index];
    if (!isShapeClip(clip)) throw badArg(`clip ${clipId} is not a shape clip`);
    if (shape && typeof shape === 'object') {
        clip.shape = clampShape({ ...clip.shape, ...shape });
    }
    if (transform && typeof transform === 'object') {
        clip.transform = clampTransform({ ...(clip.transform || {}), ...transform });
    }
    return {
        clipId,
        shape: { ...clip.shape },
        transform: clip.transform ? { ...clip.transform } : null,
    };
}

/** Patch a text clip's text config and/or transform atomically. */
export function setTextPropsOp(project, { clipId, text, transform }) {
    const loc = findClipLocation(project, clipId);
    if (!loc) throw badArg(`unknown clipId: ${clipId}`);
    const clip = loc.track.clips[loc.index];
    if (!isTextClip(clip)) throw badArg(`clip ${clipId} is not a text clip`);
    if (text && typeof text === 'object') {
        clip.text = clampText({ ...clip.text, ...text });
    }
    if (transform && typeof transform === 'object') {
        clip.transform = clampTransform({ ...(clip.transform || {}), ...transform });
    }
    return {
        clipId,
        text: { ...clip.text },
        transform: clip.transform ? { ...clip.transform } : null,
    };
}

/** Remove a clip by id. */
export function removeClipOp(project, { clipId }) {
    const loc = findClipLocation(project, clipId);
    if (!loc) throw badArg(`unknown clipId: ${clipId}`);
    loc.track.clips.splice(loc.index, 1);
}

/** Remove an asset by id. Refuses (`code: 'asset-in-use'`) if any clip
 *  references it. Caller is responsible for evicting the Blob from the
 *  registry once this returns. */
export function removeAssetOp(project, { assetId }) {
    if (!assetId) throw badArg('assetId required');
    if (!Array.isArray(project.assets)) throw badArg('project.assets must be an array');
    const idx = project.assets.findIndex(a => a && a.id === assetId);
    if (idx < 0) throw badArg(`unknown assetId: ${assetId}`);
    for (const t of project.tracks) {
        if (!t || !Array.isArray(t.clips)) continue;
        for (const c of t.clips) {
            if (c && c.assetId === assetId) {
                throw Object.assign(
                    new Error(`Asset ${assetId} is in use by clip ${c.id}`),
                    { code: 'asset-in-use', clipId: c.id },
                );
            }
        }
    }
    project.assets.splice(idx, 1);
    return { assetId };
}

/** Append an asset entry; caller wires the Blob into its registry. */
export function addAssetOp(project, params) {
    const { assetId, name, mime, duration, width, height, bytes, assetType } = params;
    if (!assetId || typeof assetId !== 'string') throw badArg('assetId required');
    const kind = assetType === 'image' ? 'image' : 'video';
    if (kind === 'video' && (!Number.isFinite(duration) || duration <= 0)) {
        throw badArg('duration must be > 0');
    }
    const entry = { id: assetId, name, mime, width, height, bytes, assetType: kind };
    if (Number.isFinite(duration)) entry.duration = duration;
    project.assets.push(entry);
    return { assetId, assetType: kind };
}
