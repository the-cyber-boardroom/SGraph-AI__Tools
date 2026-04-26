/**
 * composer-schema.js — pure helpers for project/clip schema.
 * @module video-composer/composer-schema
 */

export {
    defaultTransform, defaultCrop,
    getClipTransform, getClipCrop,
    clampTransform, clampCrop,
} from './composer-clip-fields.js';

export {
    isAssetClip, isShapeClip, isTextClip,
    getClipKind, getClipIntrinsicDims,
    defaultShape, defaultText, defaultClipDuration,
    clampShape, clampText,
} from './composer-clip-kinds.js';

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
 * Look up an asset by id within a project.
 * @param {{ assets?: Array<{ id: string }> }} project
 * @param {string} assetId
 * @returns {object|undefined}
 */
export function getAssetById(project, assetId) {
    if (!project || !Array.isArray(project.assets)) return undefined;
    return project.assets.find(a => a && a.id === assetId);
}

/**
 * Determine whether an asset entry represents an image.
 * @param {{ assetType?: string }|null|undefined} asset
 * @returns {boolean}
 */
export function isImageAsset(asset) {
    return asset?.assetType === 'image';
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
 * For a given timeline-time, list the active clip on each video track.
 * Returns one entry per `kind === 'video'` track in array order (bottom-up).
 * @param {{ tracks: Array<object> }} project
 * @param {number} t
 * @returns {Array<{ track: object, clip: object|null }>}
 */
export function findActiveClipsPerTrack(project, t) {
    return getVideoTracks(project).map(track => ({
        track,
        clip: findActiveClip(track, t),
    }));
}

/**
 * Determine which clip drives audio at timeline-time `t`. Top-most active
 * (highest array index) wins; if the topmost track is muted, audio is silent
 * (returns null). If the topmost track has no active clip, fall back down.
 * @param {{ tracks: Array<object> }} project
 * @param {number} t
 * @returns {{ track: object, clip: object }|null}
 */
export function findTopmostActiveAudioClip(project, t) {
    const videoTracks = getVideoTracks(project);
    for (let i = videoTracks.length - 1; i >= 0; i--) {
        const track = videoTracks[i];
        const clip = findActiveClip(track, t);
        // Shape/text clips have no audio — fall through to the next layer so
        // a graphic on top doesn't silence the video below.
        if (!clip || clip.kind === 'shape' || clip.kind === 'text') continue;
        return track.muted ? null : { track, clip };
    }
    return null;
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
            const hasAsset = typeof clip.assetId === 'string';
            const isShape = clip.kind === 'shape';
            const isText  = clip.kind === 'text';
            if (!hasAsset && !isShape && !isText) {
                throw new Error('clip must have assetId or kind=shape|text');
            }
            if (isShape && (!clip.shape || typeof clip.shape !== 'object')) {
                throw new Error('shape clip must carry a shape object');
            }
            if (isText && (!clip.text || typeof clip.text !== 'object')) {
                throw new Error('text clip must carry a text object');
            }
            if (!Number.isFinite(clip.timelineStart)) throw new Error('clip.timelineStart must be a number');
            if (!Number.isFinite(clip.inPoint)) throw new Error('clip.inPoint must be a number');
            if (!Number.isFinite(clip.outPoint)) throw new Error('clip.outPoint must be a number');
            if (clip.outPoint <= clip.inPoint) throw new Error('clip.outPoint must be > clip.inPoint');
        }
    }
    return project;
}
