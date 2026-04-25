/** state-track-ops.js — pure track-mutation operations on a project. */

import { wouldOverlap } from './state-overlap.js';

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }
function overlapErr() {
    return Object.assign(new Error('Clip would overlap with another clip on the same track'), { code: 'overlap' });
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
 * @param {object} project
 * @param {{ kind?: string, name?: string }} [params]
 * @returns {{ trackId: string }}
 */
export function addTrackOp(project, params = {}) {
    const kind = params.kind || 'video';
    if (kind !== 'video') throw badArg(`unsupported track kind: ${kind}`);
    const trackId = nextTrackId(project);
    const track = { id: trackId, kind, index: project.tracks.length, muted: false, clips: [] };
    if (typeof params.name === 'string') track.name = params.name;
    project.tracks.push(track);
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
    if (track.kind === 'video' && videoTracks(project).length <= 1) {
        throw badArg('cannot remove the last video track');
    }
    project.tracks.splice(idx, 1);
    reindex(project);
    return { trackId };
}

/**
 * Move a clip to a different track at the same timelineStart.
 * Throws Error{code:'overlap'} if the move collides on the target track.
 * @param {object} project
 * @param {{ clipId: string, toTrackId: string }} params
 * @returns {{ clipId: string, fromTrackId: string, toTrackId: string }}
 */
export function moveClipToTrackOp(project, { clipId, toTrackId }) {
    const target = project.tracks.find(t => t && t.id === toTrackId);
    if (!target) throw badArg(`unknown trackId: ${toTrackId}`);
    let fromTrack = null; let clipIdx = -1;
    for (const t of project.tracks) {
        const i = t.clips.findIndex(c => c.id === clipId);
        if (i >= 0) { fromTrack = t; clipIdx = i; break; }
    }
    if (!fromTrack) throw badArg(`unknown clipId: ${clipId}`);
    if (fromTrack.id === toTrackId) return { clipId, fromTrackId: fromTrack.id, toTrackId };
    const clip = fromTrack.clips[clipIdx];
    const end = clip.timelineStart + (clip.outPoint - clip.inPoint);
    if (wouldOverlap(target, clip.timelineStart, end, null)) throw overlapErr();
    fromTrack.clips.splice(clipIdx, 1);
    target.clips.push(clip);
    return { clipId, fromTrackId: fromTrack.id, toTrackId };
}

/**
 * Set or clear a track's mute flag. Throws if trackId is unknown.
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
