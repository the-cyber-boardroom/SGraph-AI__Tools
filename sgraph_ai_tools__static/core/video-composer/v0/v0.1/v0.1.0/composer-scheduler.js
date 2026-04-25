/**
 * composer-scheduler.js — wall-clock tick loop driving canvas paint + clip video sync.
 * @module video-composer/composer-scheduler
 */

import { findActiveClip } from './composer-schema.js';

/**
 * Paint the canvas with solid black (gap fill).
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @returns {void}
 */
export function paintBlack(ctx, canvas) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Paint the active video frame, or black if not ready.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLVideoElement|null} video
 * @returns {void}
 */
export function paintVideo(ctx, canvas, video) {
    if (!video || video.readyState < 2) { paintBlack(ctx, canvas); return; }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

/**
 * Pause every video element except `keep`.
 * @param {Map<string, HTMLVideoElement>} videos
 * @param {HTMLVideoElement|null} keep
 * @returns {void}
 */
export function pauseOthers(videos, keep) {
    for (const v of videos.values()) {
        if (v === keep) continue;
        try { v.pause(); } catch (_) {}
    }
}

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
 * Create a wall-clock tick scheduler.
 * On each rAF tick: advance time, decide active clip, paint, emit events.
 * @param {{
 *   getPlaying: () => boolean,
 *   setPlaying: (v: boolean) => void,
 *   getTime: () => number,
 *   setTime: (t: number) => void,
 *   getDuration: () => number,
 *   getTrack: () => object|null,
 *   getVideos: () => Map<string, HTMLVideoElement>,
 *   ctx: CanvasRenderingContext2D,
 *   canvas: HTMLCanvasElement,
 *   emit: (name: string, detail: object) => void,
 * }} cfg
 * @returns {{ start: () => void, stop: () => void, paintAt: (t: number) => void }}
 */
export function createScheduler(cfg) {
    let raf = 0;
    let lastWall = 0;
    let lastEmittedSec = -1;

    function paintAt(t) {
        const track = cfg.getTrack();
        const clip = track ? findActiveClip(track, t) : null;
        const videos = cfg.getVideos();
        if (clip) {
            const v = videos.get(clip.assetId) || null;
            pauseOthers(videos, v);
            paintVideo(cfg.ctx, cfg.canvas, v);
        } else {
            pauseOthers(videos, null);
            paintBlack(cfg.ctx, cfg.canvas);
        }
    }

    function tick(now) {
        if (!cfg.getPlaying()) { raf = 0; return; }
        const dt = lastWall ? Math.max(0, (now - lastWall) / 1000) : 0;
        lastWall = now;
        let t = cfg.getTime() + dt;
        const dur = cfg.getDuration();
        const track = cfg.getTrack();
        const clip = track ? findActiveClip(track, t) : null;
        const videos = cfg.getVideos();
        if (clip) {
            const v = videos.get(clip.assetId);
            if (v) {
                pauseOthers(videos, v);
                syncClipVideo(v, clip, t);
                paintVideo(cfg.ctx, cfg.canvas, v);
            } else {
                pauseOthers(videos, null);
                paintBlack(cfg.ctx, cfg.canvas);
            }
        } else {
            pauseOthers(videos, null);
            paintBlack(cfg.ctx, cfg.canvas);
        }
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
        const sec = Math.floor(t);
        if (sec !== lastEmittedSec) {
            lastEmittedSec = sec;
            cfg.emit('composer:playhead-changed', { time: t });
        }
        raf = requestAnimationFrame(tick);
    }

    function start() {
        if (raf) return;
        lastWall = 0;
        lastEmittedSec = -1;
        raf = requestAnimationFrame(tick);
    }
    function stop() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
    }
    return { start, stop, paintAt };
}
