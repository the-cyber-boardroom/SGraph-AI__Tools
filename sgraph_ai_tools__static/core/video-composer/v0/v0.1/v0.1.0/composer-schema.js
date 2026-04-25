/**
 * composer-schema.js — pure helpers for project/clip schema.
 * @module video-composer/composer-schema
 */

/**
 * Snap a time to the nearest frame boundary.
 * @param {number} t Time in seconds.
 * @param {number} fps Frames per second.
 * @returns {number}
 */
export function snapToFps(t, fps) {
    return Math.round(t * fps) / fps;
}

/**
 * Duration of a clip on the source media (outPoint - inPoint).
 * @param {{ inPoint: number, outPoint: number }} clip
 * @returns {number}
 */
export function clipDuration(clip) {
    return clip.outPoint - clip.inPoint;
}

/**
 * End of a clip on the timeline (timelineStart + duration).
 * @param {{ timelineStart: number, inPoint: number, outPoint: number }} clip
 * @returns {number}
 */
export function clipTimelineEnd(clip) {
    return clip.timelineStart + clipDuration(clip);
}

/**
 * Maximum clipTimelineEnd across a track's clips.
 * @param {{ clips: Array<object> }} track
 * @returns {number}
 */
export function getTrackDuration(track) {
    if (!track || !Array.isArray(track.clips) || track.clips.length === 0) return 0;
    let max = 0;
    for (const clip of track.clips) {
        const end = clipTimelineEnd(clip);
        if (end > max) max = end;
    }
    return max;
}

/**
 * Maximum getTrackDuration across all video tracks.
 * @param {{ tracks: Array<object> }} project
 * @returns {number}
 */
export function getProjectDuration(project) {
    let max = 0;
    for (const track of getVideoTracks(project)) {
        const d = getTrackDuration(track);
        if (d > max) max = d;
    }
    return max;
}

/**
 * Find the clip on a track containing the given timeline time.
 * @param {{ clips: Array<object> }} track
 * @param {number} timelineTime
 * @returns {object|null}
 */
export function findActiveClip(track, timelineTime) {
    if (!track || !Array.isArray(track.clips)) return null;
    for (const clip of track.clips) {
        const start = clip.timelineStart;
        const end = clipTimelineEnd(clip);
        if (timelineTime >= start && timelineTime < end) return clip;
    }
    return null;
}

/**
 * Filter project tracks to only video tracks.
 * @param {{ tracks: Array<{ kind: string }> }} project
 * @returns {Array<object>}
 */
export function getVideoTracks(project) {
    if (!project || !Array.isArray(project.tracks)) return [];
    return project.tracks.filter(t => t && t.kind === 'video');
}

/**
 * Validate a project shape; throws on missing required fields.
 * @param {object} project
 * @returns {object} the project
 */
export function validateProject(project) {
    if (!project || typeof project !== 'object') throw new Error('project must be an object');
    if (!Number.isFinite(project.width) || project.width <= 0) throw new Error('project.width must be > 0');
    if (!Number.isFinite(project.height) || project.height <= 0) throw new Error('project.height must be > 0');
    if (!Array.isArray(project.tracks)) throw new Error('project.tracks must be an array');
    for (const track of project.tracks) {
        if (!track || typeof track !== 'object') throw new Error('track must be an object');
        if (typeof track.kind !== 'string') throw new Error('track.kind must be a string');
        if (!Array.isArray(track.clips)) throw new Error('track.clips must be an array');
        for (const clip of track.clips) {
            if (!clip || typeof clip !== 'object') throw new Error('clip must be an object');
            if (typeof clip.assetId !== 'string') throw new Error('clip.assetId must be a string');
            if (!Number.isFinite(clip.timelineStart)) throw new Error('clip.timelineStart must be a number');
            if (!Number.isFinite(clip.inPoint)) throw new Error('clip.inPoint must be a number');
            if (!Number.isFinite(clip.outPoint)) throw new Error('clip.outPoint must be a number');
            if (clip.outPoint <= clip.inPoint) throw new Error('clip.outPoint must be > clip.inPoint');
        }
    }
    return project;
}
