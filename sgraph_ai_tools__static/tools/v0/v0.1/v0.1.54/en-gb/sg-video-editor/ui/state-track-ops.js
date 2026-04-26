/** state-track-ops.js — pure track-mutation operations on a project. */

import { snapToFps } from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { wouldOverlap, snapToClearSlot } from './state-overlap.js';

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }
function overlapErr() {
    return Object.assign(new Error('Clip would overlap with another clip on the same track'), { code: 'overlap' });
}
function lockedErr(trackId) {
    return Object.assign(
        new Error(`Track ${trackId} is locked — unlock it to modify`),
        { code: 'locked', trackId },
    );
}

/**
 * Throw `Error{code:'locked'}` if the named track is locked. Used by clip ops
 * + cross-track moves to block all content mutations on locked tracks. Mute
 * + lock-toggle + rename + colour overrides are intentionally NOT gated.
 *
 * @param {object} project
 * @param {string|null|undefined} trackId
 * @returns {void}
 */
export function assertTrackUnlocked(project, trackId) {
    if (!trackId) return;
    const track = project.tracks.find(t => t && t.id === trackId);
    if (track && track.locked) throw lockedErr(trackId);
}

/** Filter to `kind === 'video'` tracks while preserving array order. */
function videoTracks(project) {
    return project.tracks.filter(t => t && t.kind === 'video');
}

/** Update each track's `index` field to mirror its position in the array. */
function reindex(project) {
    project.tracks.forEach((t, i) => { if (t) t.index = i; });
}

/** Generate a `t-video-N` id that doesn't collide with existing tracks. */
function nextTrackId(project) {
    const existing = new Set(project.tracks.map(t => t && t.id));
    for (let i = 1; i < 10000; i++) {
        const id = `t-video-${i}`;
        if (!existing.has(id)) return id;
    }
    return `t-video-${Date.now()}`;
}

/**
 * Append a new track. Returns `{ project, trackId }` (project mutated in place).
 *
 * When `params.insertAboveTrackId` is provided, the new track is inserted at
 * `index = pos + 1` of the named track (i.e. directly above it in z-order,
 * since `tracks[]` is bottom-up). When omitted the track is appended to the
 * top of the stack as before. Unknown `insertAboveTrackId` falls back to
 * appending — easier on callers that race against concurrent removals.
 *
 * @param {object} project
 * @param {{ kind?: string, name?: string, insertAboveTrackId?: string }} [params]
 * @returns {{ trackId: string }}
 */
export function addTrackOp(project, params = {}) {
    const kind = params.kind || 'video';
    if (kind !== 'video') throw badArg(`unsupported track kind: ${kind}`);
    const trackId = nextTrackId(project);
    const track = { id: trackId, kind, muted: false, clips: [] };
    if (typeof params.name === 'string') track.name = params.name;
    let insertAt = project.tracks.length;
    if (typeof params.insertAboveTrackId === 'string') {
        const i = project.tracks.findIndex(t => t && t.id === params.insertAboveTrackId);
        if (i >= 0) insertAt = i + 1;
    }
    track.index = insertAt;
    project.tracks.splice(insertAt, 0, track);
    reindex(project);
    return { trackId };
}

/**
 * Remove a track and all its clips. Throws if it would leave zero video tracks.
 * @param {object} project
 * @param {{ trackId: string }} params
 * @returns {{ trackId: string }}
 */
export function removeTrackOp(project, { trackId }) {
    const idx = project.tracks.findIndex(t => t && t.id === trackId);
    if (idx < 0) throw badArg(`unknown trackId: ${trackId}`);
    const track = project.tracks[idx];
    if (track.locked) throw lockedErr(trackId);
    if (track.kind === 'video' && videoTracks(project).length <= 1) {
        throw badArg('cannot remove the last video track');
    }
    project.tracks.splice(idx, 1);
    reindex(project);
    return { trackId };
}

/**
 * Move a clip to a different track. Atomically positions the clip at
 * `params.timelineStart` (when supplied) on the destination track, so a
 * cross-track drag-drop tests overlap against the *user's chosen position*
 * rather than the clip's stale source position.
 *
 *  - When `timelineStart` is provided, it overrides the clip's current start
 *    on the destination track. Snapped to fps and clamped to ≥ 0.
 *  - When `snap === true`, an overlapping placement is auto-resolved by
 *    flush-abutting the nearest neighbour on the destination track (see
 *    `snapToClearSlot`). If both sides still collide, throws overlap so the
 *    caller can fall back to the auto-track-above behaviour.
 *  - When neither is provided, behaviour matches the pre-existing op:
 *    keep the clip's source `timelineStart` and reject on overlap.
 *
 * @param {object} project
 * @param {{ clipId: string, toTrackId: string, timelineStart?: number, snap?: boolean }} params
 * @returns {{ clipId: string, fromTrackId: string, toTrackId: string, timelineStart: number }}
 */
export function moveClipToTrackOp(project, { clipId, toTrackId, timelineStart, snap }) {
    const target = project.tracks.find(t => t && t.id === toTrackId);
    if (!target) throw badArg(`unknown trackId: ${toTrackId}`);
    if (target.locked) throw lockedErr(toTrackId);
    let fromTrack = null; let clipIdx = -1;
    for (const t of project.tracks) {
        const i = t.clips.findIndex(c => c.id === clipId);
        if (i >= 0) { fromTrack = t; clipIdx = i; break; }
    }
    if (!fromTrack) throw badArg(`unknown clipId: ${clipId}`);
    if (fromTrack.locked && fromTrack.id !== toTrackId) throw lockedErr(fromTrack.id);
    const clip = fromTrack.clips[clipIdx];
    const fps = (project.project && project.project.fps) || 30;
    const dur = clip.outPoint - clip.inPoint;
    let tStart = Number.isFinite(timelineStart)
        ? snapToFps(Math.max(0, timelineStart), fps)
        : clip.timelineStart;
    if (fromTrack.id === toTrackId) {
        // Same track: nothing to test (clip already lives there).
        if (Number.isFinite(timelineStart) && tStart !== clip.timelineStart) {
            // Caller wanted to move on the same lane — handle via the snap path
            // so we don't trip on ourselves.
            if (snap) {
                const adj = snapToClearSlot(target, tStart, tStart + dur, clipId);
                if (adj == null) throw overlapErr();
                tStart = snapToFps(Math.max(0, adj), fps);
            } else if (wouldOverlap(target, tStart, tStart + dur, clipId)) {
                throw overlapErr();
            }
            clip.timelineStart = tStart;
        }
        return { clipId, fromTrackId: fromTrack.id, toTrackId, timelineStart: clip.timelineStart };
    }
    if (snap) {
        const adj = snapToClearSlot(target, tStart, tStart + dur, null);
        if (adj == null) throw overlapErr();
        tStart = snapToFps(Math.max(0, adj), fps);
    } else if (wouldOverlap(target, tStart, tStart + dur, null)) {
        throw overlapErr();
    }
    fromTrack.clips.splice(clipIdx, 1);
    clip.timelineStart = tStart;
    target.clips.push(clip);
    return { clipId, fromTrackId: fromTrack.id, toTrackId, timelineStart: tStart };
}

/**
 * Set or clear a track's mute flag. Throws if trackId is unknown.
 * Lock state does NOT block muting (mute is a transient/preview thing).
 * @param {object} project
 * @param {{ trackId: string, muted: boolean }} params
 * @returns {{ trackId: string, muted: boolean }}
 */
export function setTrackMutedOp(project, { trackId, muted }) {
    const track = project.tracks.find(t => t && t.id === trackId);
    if (!track) throw badArg(`unknown trackId: ${trackId}`);
    track.muted = !!muted;
    return { trackId, muted: !!muted };
}

/**
 * Set or clear a track's lock flag. Throws if trackId is unknown.
 * Toggling the lock flag itself is intentionally NOT gated by the lock — that
 * would make it impossible to unlock a track once locked.
 * @param {object} project
 * @param {{ trackId: string, locked: boolean }} params
 * @returns {{ trackId: string, locked: boolean }}
 */
export function setTrackLockedOp(project, { trackId, locked }) {
    const track = project.tracks.find(t => t && t.id === trackId);
    if (!track) throw badArg(`unknown trackId: ${trackId}`);
    track.locked = !!locked;
    return { trackId, locked: !!locked };
}

/**
 * Rename a track. Empty / whitespace-only names clear the override (UI then
 * falls back to the default `Track N` label). Locked tracks may still be
 * renamed — the label is not content.
 * @param {object} project
 * @param {{ trackId: string, name: string }} params
 * @returns {{ trackId: string, name: string|null }}
 */
export function renameTrackOp(project, { trackId, name }) {
    const track = project.tracks.find(t => t && t.id === trackId);
    if (!track) throw badArg(`unknown trackId: ${trackId}`);
    const trimmed = (typeof name === 'string') ? name.trim() : '';
    if (trimmed === '') { delete track.name; return { trackId, name: null }; }
    track.name = trimmed;
    return { trackId, name: trimmed };
}

/**
 * Reorder the project's video tracks (bottom-up) to match `trackIds`.
 * The set of ids must match exactly the existing video-track ids.
 * @param {object} project
 * @param {{ trackIds: Array<string> }} params
 * @returns {{ trackIds: Array<string> }}
 */
export function reorderTracksOp(project, { trackIds }) {
    if (!Array.isArray(trackIds)) throw badArg('trackIds must be an array');
    const current = videoTracks(project);
    if (trackIds.length !== current.length) throw badArg('trackIds length mismatch');
    const currentIds = new Set(current.map(t => t.id));
    for (const id of trackIds) if (!currentIds.has(id)) throw badArg(`unknown trackId: ${id}`);
    const seen = new Set(); for (const id of trackIds) {
        if (seen.has(id)) throw badArg(`duplicate trackId: ${id}`);
        seen.add(id);
    }
    const byId = new Map(current.map(t => [t.id, t]));
    const nonVideo = project.tracks.filter(t => !t || t.kind !== 'video');
    project.tracks = [...trackIds.map(id => byId.get(id)), ...nonVideo];
    reindex(project);
    return { trackIds: [...trackIds] };
}
