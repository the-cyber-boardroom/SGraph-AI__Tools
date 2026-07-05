/**
 * composer-scheduler.js — wall-clock tick loop driving the multi-track paint.
 * Per tick: advance time, paint the full track stack (bottom-up), emit
 * `composer:playhead-changed`. The top-most active clip wins visually; the
 * top-most active unmuted clip drives audio (playback uses the actual
 * <video> element's audio output — no Web Audio routing here).
 *
 * @module video-composer/composer-scheduler
 */

import { paintTrackStack, resolveAudioSource } from './composer-scheduler-frame.js';
import { paintBlack } from './composer-draw.js';

export { paintBlack };

/**
 * Create a wall-clock tick scheduler for canvas playback.
 * @param {{
 *   getPlaying: () => boolean,
 *   setPlaying: (v: boolean) => void,
 *   getTime: () => number,
 *   setTime: (t: number) => void,
 *   getDuration: () => number,
 *   getProject: () => object|null,
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
    let audioVideo = null;

    function paintAt(t) {
        const project = cfg.getProject ? cfg.getProject() : null;
        if (!project) { paintBlack(cfg.ctx, cfg.canvas); return; }
        paintTrackStack({
            ctx: cfg.ctx, canvas: cfg.canvas, project, t,
            videos: cfg.getVideos(), getImage: cfg.getImage,
            advance: false,
        });
    }

    function updateAudio(project, t, videos) {
        const { video } = resolveAudioSource(project, t, videos);
        if (video === audioVideo) return;
        if (audioVideo) {
            // The new top-most takes over; old top is muted via element.muted=false
            // restore later. We mute the deposed element so multiple tracks
            // don't double up audio output.
            try { audioVideo.muted = true; } catch (_) {}
        }
        if (video) {
            try { video.muted = false; } catch (_) {}
        }
        audioVideo = video;
    }

    function tick(now) {
        if (!cfg.getPlaying()) { raf = 0; return; }
        const dt = lastWall ? Math.max(0, (now - lastWall) / 1000) : 0;
        lastWall = now;
        let t = cfg.getTime() + dt;
        const dur = cfg.getDuration();
        const project = cfg.getProject ? cfg.getProject() : null;
        if (!project) { raf = 0; return; }
        const videos = cfg.getVideos();
        paintTrackStack({
            ctx: cfg.ctx, canvas: cfg.canvas, project, t,
            videos, getImage: cfg.getImage, advance: true,
        });
        updateAudio(project, t, videos);
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
