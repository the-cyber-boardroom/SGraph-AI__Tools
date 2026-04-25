/**
 * composer-scheduler.js — wall-clock tick loop driving canvas paint + clip media sync.
 * @module video-composer/composer-scheduler
 */

import { findActiveClip, getAssetById, isImageAsset } from './composer-schema.js';
import { paintBlack, paintVideo, paintImage, pauseOthers } from './composer-draw.js';

export { paintBlack, paintVideo, pauseOthers };

/**
 * Sync the hidden video element to the desired timeline-time and ensure it plays.
 * @param {HTMLVideoElement} video
 * @param {object} clip
 * @param {number} timelineTime
 * @returns {void}
 */
export function syncClipVideo(video, clip, timelineTime) {
    const local = clip.inPoint + (timelineTime - clip.timelineStart);
    const target = Math.max(0, local);
    if (Math.abs(video.currentTime - target) > 0.12) {
        try { video.currentTime = target; } catch (_) {}
    }
    if (video.paused) {
        try { video.play().catch(() => {}); } catch (_) {}
    }
}

/**
 * Render the active clip (image or video) to the canvas.
 * Pauses all videos when the active clip is an image so silent audio plays.
 * @param {{
 *   ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement,
 *   project?: object, clip: object|null,
 *   videos: Map<string, HTMLVideoElement>,
 *   getImage?: (assetId: string) => HTMLImageElement|null,
 *   advance?: boolean, time?: number,
 * }} cfg
 * @returns {void}
 */
export function renderActiveClip(cfg) {
    const { ctx, canvas, project, clip, videos, getImage, advance, time } = cfg;
    if (!clip) {
        pauseOthers(videos, null);
        paintBlack(ctx, canvas);
        return;
    }
    const asset = project ? getAssetById(project, clip.assetId) : null;
    if (isImageAsset(asset)) {
        pauseOthers(videos, null);
        const img = getImage ? getImage(clip.assetId) : null;
        paintImage(ctx, canvas, img);
        return;
    }
    const v = videos.get(clip.assetId) || null;
    pauseOthers(videos, v);
    if (v && advance) syncClipVideo(v, clip, time);
    paintVideo(ctx, canvas, v);
}

/**
 * Create a wall-clock tick scheduler.
 * On each rAF tick: advance time, decide active clip, paint, emit events.
 * @param {{
 *   getPlaying: () => boolean,
 *   setPlaying: (v: boolean) => void,
 *   getTime: () => number,
 *   setTime: (t: number) => void,
 *   getDuration: () => number,
 *   getTrack: () => object|null,
 *   getProject?: () => object|null,
 *   getVideos: () => Map<string, HTMLVideoElement>,
 *   getImage?: (assetId: string) => HTMLImageElement|null,
 *   ctx: CanvasRenderingContext2D,
 *   canvas: HTMLCanvasElement,
 *   emit: (name: string, detail: object) => void,
 * }} cfg
 * @returns {{ start: () => void, stop: () => void, paintAt: (t: number) => void }}
 */
export function createScheduler(cfg) {
    let raf = 0;
    let lastWall = 0;

    function paintAt(t) {
        const track = cfg.getTrack();
        const clip = track ? findActiveClip(track, t) : null;
        renderActiveClip({
            ctx: cfg.ctx, canvas: cfg.canvas,
            project: cfg.getProject ? cfg.getProject() : null,
            clip, videos: cfg.getVideos(), getImage: cfg.getImage,
            advance: false, time: t,
        });
    }

    function tick(now) {
        if (!cfg.getPlaying()) { raf = 0; return; }
        const dt = lastWall ? Math.max(0, (now - lastWall) / 1000) : 0;
        lastWall = now;
        let t = cfg.getTime() + dt;
        const dur = cfg.getDuration();
        const track = cfg.getTrack();
        const clip = track ? findActiveClip(track, t) : null;
        renderActiveClip({
            ctx: cfg.ctx, canvas: cfg.canvas,
            project: cfg.getProject ? cfg.getProject() : null,
            clip, videos: cfg.getVideos(), getImage: cfg.getImage,
            advance: true, time: t,
        });
        if (t >= dur - 1e-3 && dur > 0) {
            t = dur;
            cfg.setTime(t);
            cfg.emit('composer:playhead-changed', { time: t });
            cfg.setPlaying(false);
            cfg.emit('composer:state-changed', { playing: false });
            cfg.emit('composer:ended', { time: t });
            raf = 0;
            return;
        }
        cfg.setTime(t);
        cfg.emit('composer:playhead-changed', { time: t });
        raf = requestAnimationFrame(tick);
    }

    function start() {
        if (raf) return;
        lastWall = 0;
        raf = requestAnimationFrame(tick);
    }
    function stop() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
    }
    return { start, stop, paintAt };
}
