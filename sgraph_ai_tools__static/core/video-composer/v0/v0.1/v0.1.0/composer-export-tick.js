/**
 * composer-export-tick.js — per-tick multi-track render + audio source swap
 * for the export pipeline. Mirrors the playback scheduler-frame, but routes
 * audio through the export AudioContext graph (MediaStreamDestination).
 *
 * @module video-composer/composer-export-tick
 */

import {
    findActiveClipsPerTrack,
    findTopmostActiveAudioClip,
    getAssetById,
    isImageAsset,
    isShapeClip,
    isTextClip,
    getClipTransform,
    getClipCrop,
} from './composer-schema.js';
import { paintBlack, paintImage, paintVideo, paintShape, paintText, pauseUnused } from './composer-draw.js';
import { debug } from './composer-export-debug.js';

/**
 * Sync a hidden video to the desired timeline-time and ensure it plays.
 * @param {HTMLVideoElement} v
 * @param {{ inPoint: number, timelineStart: number }} clip
 * @param {number} t
 * @returns {void}
 */
function ensureSynced(v, clip, t) {
    const target = Math.max(0, clip.inPoint + (t - clip.timelineStart));
    if (Math.abs(v.currentTime - target) > 0.12) {
        try { v.currentTime = target; } catch (_) {}
    }
    if (v.paused) {
        try { v.play().catch(() => {}); } catch (_) {}
    }
}

/**
 * Render the full track stack at time `t` to the export canvas. Returns the
 * set of asset ids that contributed video frames this tick (used to pause
 * everything else and to spot videos that ended early).
 *
 * @param {{
 *   ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, project: object,
 *   t: number, videos: Map<string, HTMLVideoElement>,
 *   getImage: (id: string) => HTMLImageElement|null,
 * }} cfg
 * @returns {{ activeAssetIds: Set<string>, perTrack: Array<{track: object, clip: object|null}> }}
 */
export function paintExportFrame(cfg) {
    const { ctx, canvas, project, t, videos, getImage } = cfg;
    paintBlack(ctx, canvas);
    const perTrack = findActiveClipsPerTrack(project, t);
    const activeClipIds = new Set();
    for (const { clip } of perTrack) {
        if (!clip) continue;
        const tf = getClipTransform(clip);
        const cr = getClipCrop(clip);
        if (isShapeClip(clip)) { paintShape(ctx, canvas, clip, tf, cr); continue; }
        if (isTextClip(clip))  { paintText (ctx, canvas, clip, tf, cr); continue; }
        const asset = getAssetById(project, clip.assetId);
        if (isImageAsset(asset)) {
            paintImage(ctx, canvas, getImage ? getImage(clip.assetId) : null, tf, cr);
            continue;
        }
        const v = videos.get(clip.id);
        if (!v) continue;
        activeClipIds.add(clip.id);
        ensureSynced(v, clip, t);
        if (v.readyState >= 2) paintVideo(ctx, canvas, v, tf, cr);
    }
    pauseUnused(videos, activeClipIds);
    return { activeClipIds, perTrack };
}

/**
 * Build a per-tick audio-source switcher. Connects the top-most active
 * unmuted clip's <video> to the export audio graph; disconnects the previous
 * source on switch. No-op if the source hasn't changed.
 * @param {{ audio: { connect: Function, disconnect: Function }, videos: Map<string, HTMLVideoElement> }} cfg
 * @returns {(project: object, t: number) => void}
 */
export function createAudioSwitcher({ audio, videos }) {
    let connected = null;
    let connectedClipId = null;
    return function update(project, t) {
        const top = findTopmostActiveAudioClip(project, t);
        const nextVideo = top ? (videos.get(top.clip.id) || null) : null;
        const nextClipId = top ? top.clip.id : null;
        if (nextVideo === connected && nextClipId === connectedClipId) return;
        if (connected) audio.disconnect(connected);
        if (nextVideo) audio.connect(nextVideo);
        if (nextClipId !== connectedClipId) {
            debug('clip-active', { clipId: nextClipId, audioOnly: false });
            if (connectedClipId) debug('clip-end', { clipId: connectedClipId });
        }
        connected = nextVideo;
        connectedClipId = nextClipId;
    };
}
