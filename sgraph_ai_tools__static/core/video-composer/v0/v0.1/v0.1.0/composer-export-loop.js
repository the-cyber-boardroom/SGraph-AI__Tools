/**
 * composer-export-loop.js — per-clip activation + tick loop for export.
 * Splits image vs. video render strategy and exposes a small driver API
 * the orchestrator (composer-export.js) can wire into a Promise.
 * @module video-composer/composer-export-loop
 */

import {
    clipDuration,
    getAssetById,
    isImageAsset,
} from './composer-schema.js';
import { paintBlack, paintImage } from './composer-draw.js';
import { debug } from './composer-export-debug.js';

/**
 * Find the clip strictly after the just-ended `prevClip` on a track,
 * by track index. Returns null if there is none.
 * @param {object|null} track
 * @param {object} prevClip
 * @returns {object|null}
 */
export function nextClipAfter(track, prevClip) {
    if (!track || !Array.isArray(track.clips) || !prevClip) return null;
    const i = track.clips.findIndex(c => c.id === prevClip.id);
    if (i < 0 || i + 1 >= track.clips.length) return null;
    return track.clips[i + 1];
}

/**
 * Build the export tick driver. Image clips redraw the canvas every rAF
 * (so canvas.captureStream emits frames even while paint content is static);
 * video clips redraw on requestVideoFrameCallback (or rAF fallback).
 *
 * @param {{
 *   project: object, videoTrack: object|null, total: number,
 *   ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement,
 *   videos: Map<string, HTMLVideoElement>,
 *   getImage: (assetId: string) => HTMLImageElement|null,
 *   audio: { connect: Function, disconnect: Function },
 *   onProgress: (info: {time:number,total:number,ratio:number,phase:string}) => void,
 *   onError: (err: Error) => void,
 *   onFinish: () => void,
 * }} cfg
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createExportLoop(cfg) {
    const { project, videoTrack, total, ctx, canvas, videos, getImage, audio } = cfg;
    let activeClip = null;
    let activeVideo = null;
    let imageRaf = 0;
    let imageStart = 0;
    let stopped = false;

    function progress(time, phase) {
        try { cfg.onProgress({ time, total, ratio: total > 0 ? Math.min(1, time / total) : 0, phase }); }
        catch (_) {}
    }

    function clipEnd() {
        if (!activeClip) return;
        const next = nextClipAfter(videoTrack, activeClip);
        if (!next) { stop(); cfg.onFinish(); return; }
        debug('clip-end', { clipId: activeClip.id });
        setActive(next);
    }

    function tickImage() {
        if (stopped || !activeClip) return;
        const elapsed = (performance.now() - imageStart) / 1000;
        const dur = clipDuration(activeClip);
        const tl = activeClip.timelineStart + Math.min(elapsed, dur);
        // Repaint every tick so captureStream(fps) sees a fresh frame.
        paintImage(ctx, canvas, getImage(activeClip.assetId));
        progress(tl, 'recording');
        if (elapsed >= dur - 1e-3 || tl >= total - 1e-3) { clipEnd(); return; }
        imageRaf = requestAnimationFrame(tickImage);
    }

    function drawVideo() {
        if (stopped || !activeVideo || !activeClip) return;
        if (activeVideo.readyState >= 2) {
            ctx.drawImage(activeVideo, 0, 0, canvas.width, canvas.height);
        }
        const local = activeVideo.currentTime;
        const tl = activeClip.timelineStart + (local - activeClip.inPoint);
        progress(tl, 'recording');
        if (local >= activeClip.outPoint - 1e-3 || tl >= total - 1e-3) { clipEnd(); return; }
        scheduleVideoFrame();
    }

    function scheduleVideoFrame() {
        if (stopped || !activeVideo) return;
        if (typeof activeVideo.requestVideoFrameCallback === 'function') {
            activeVideo.requestVideoFrameCallback(drawVideo);
        } else {
            requestAnimationFrame(drawVideo);
        }
    }

    function setActive(clip) {
        if (activeVideo) { try { activeVideo.pause(); } catch (_) {} audio.disconnect(activeVideo); }
        if (imageRaf) { cancelAnimationFrame(imageRaf); imageRaf = 0; }
        activeClip = clip;
        const asset = clip ? getAssetById(project, clip.assetId) : null;
        debug('clip-active', { clipId: clip ? clip.id : null, isImage: isImageAsset(asset) });
        if (clip && isImageAsset(asset)) {
            activeVideo = null;
            imageStart = performance.now();
            imageRaf = requestAnimationFrame(tickImage);
            return;
        }
        activeVideo = clip ? videos.get(clip.assetId) : null;
        if (!activeVideo) { paintBlack(ctx, canvas); progress(clip ? clip.timelineStart : 0, 'recording'); return; }
        try { activeVideo.currentTime = clip.inPoint; } catch (_) {}
        audio.connect(activeVideo);
        activeVideo.play().then(scheduleVideoFrame).catch((e) => {
            debug('video-play-error', { clipId: clip.id, message: e && e.message });
            // Fall back to rAF tick so the recorder still gets canvas frames for this clip.
            scheduleVideoFrame();
        });
    }

    function start() {
        const first = (videoTrack && Array.isArray(videoTrack.clips) && videoTrack.clips.length > 0)
            ? videoTrack.clips[0]
            : null;
        if (!first) { stop(); cfg.onFinish(); return; }
        // If the first clip starts after t=0, paint black during the leading gap.
        if (first.timelineStart > 0) paintBlack(ctx, canvas);
        setActive(first);
    }

    function stop() {
        stopped = true;
        if (imageRaf) { cancelAnimationFrame(imageRaf); imageRaf = 0; }
        if (activeVideo) { try { activeVideo.pause(); } catch (_) {} }
    }

    return { start, stop };
}
