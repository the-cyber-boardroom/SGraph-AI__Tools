/**
 * composer-scheduler-frame.js — per-tick multi-track render + audio swap.
 * Bottom-up paint loop: top-most active clip wins visually. Audio comes from
 * the top-most active clip's track (unless that track is muted).
 *
 * @module video-composer/composer-scheduler-frame
 */

import {
    findActiveClipsPerTrack,
    findTopmostActiveAudioClip,
    getAssetById,
    isImageAsset,
    getClipTransform,
    getClipCrop,
} from './composer-schema.js';
import { paintBlack, paintImage, paintVideo, pauseUnused } from './composer-draw.js';

/**
 * Sync a hidden video element to the desired timeline-time.
 * @param {HTMLVideoElement} video
 * @param {{ inPoint: number, timelineStart: number }} clip
 * @param {number} t
 * @param {boolean} ensurePlaying
 * @returns {void}
 */
export function syncVideo(video, clip, t, ensurePlaying) {
    const target = Math.max(0, clip.inPoint + (t - clip.timelineStart));
    if (Math.abs(video.currentTime - target) > 0.12) {
        try { video.currentTime = target; } catch (_) {}
    }
    if (ensurePlaying && video.paused) {
        try { video.play().catch(() => {}); } catch (_) {}
    }
}

/**
 * Render the full track stack (bottom-up) at time `t`. The first paint is
 * solid black so gaps on lower layers don't carry stale pixels; each track
 * with an active clip then overlays a video frame or image.
 *
 * @param {{
 *   ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement,
 *   project: object, t: number,
 *   videos: Map<string, HTMLVideoElement>,
 *   getImage: (assetId: string) => HTMLImageElement|null,
 *   advance?: boolean,
 * }} cfg
 * @returns {{ activeAssetIds: Set<string>, perTrack: Array<{track: object, clip: object|null}> }}
 */
export function paintTrackStack(cfg) {
    const { ctx, canvas, project, t, videos, getImage, advance } = cfg;
    paintBlack(ctx, canvas);
    const perTrack = findActiveClipsPerTrack(project, t);
    const activeAssetIds = new Set();
    for (const { clip } of perTrack) {
        if (!clip) continue;
        const tf = getClipTransform(clip);
        const cr = getClipCrop(clip);
        const asset = getAssetById(project, clip.assetId);
        if (isImageAsset(asset)) {
            paintImage(ctx, canvas, getImage ? getImage(clip.assetId) : null, tf, cr);
            continue;
        }
        const v = videos.get(clip.assetId);
        if (!v) continue;
        activeAssetIds.add(clip.assetId);
        if (advance) syncVideo(v, clip, t, true);
        if (v.readyState >= 2) paintVideo(ctx, canvas, v, tf, cr);
    }
    pauseUnused(videos, activeAssetIds);
    return { activeAssetIds, perTrack };
}

/**
 * Resolve the audio source for time `t`. Returns the active video element
 * driving audio (top-most active, unmuted track), or null for silence.
 * @param {object} project
 * @param {number} t
 * @param {Map<string, HTMLVideoElement>} videos
 * @returns {{ video: HTMLVideoElement|null, clipId: string|null }}
 */
export function resolveAudioSource(project, t, videos) {
    const top = findTopmostActiveAudioClip(project, t);
    if (!top) return { video: null, clipId: null };
    const v = videos.get(top.clip.assetId) || null;
    return { video: v, clipId: top.clip.id };
}
