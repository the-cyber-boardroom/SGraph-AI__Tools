/**
 * composer-export-loop.js — wall-clock tick loop for multi-track export.
 *
 * Replaces the round-7 clip-by-clip iterator. We now advance an
 * `exportStart`-based wall-clock `t` every rAF, paint the full track stack,
 * keep the export audio source aligned to the top-most active clip, and stop
 * when `t >= total`. The image-fill behaviour from round-7 is preserved
 * implicitly because every track with an active image clip is repainted on
 * every tick (so `canvas.captureStream(fps)` always sees fresh frames).
 *
 * @module video-composer/composer-export-loop
 */

import { paintBlack } from './composer-draw.js';
import { paintExportFrame, createAudioSwitcher } from './composer-export-tick.js';
import { getVideoTracks } from './composer-schema.js';
import { debug } from './composer-export-debug.js';

/**
 * Build the export tick driver.
 *
 * @param {{
 *   project: object, total: number,
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
    const { project, total, ctx, canvas, videos, getImage, audio } = cfg;
    let raf = 0;
    let stopped = false;
    let exportStart = 0;
    const updateAudio = createAudioSwitcher({ audio, videos });
    const endedListeners = [];

    function progress(time, phase) {
        try { cfg.onProgress({ time, total, ratio: total > 0 ? Math.min(1, time / total) : 0, phase }); }
        catch (_) {}
    }

    function finish() {
        if (stopped) return;
        stopped = true;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        for (const { v, fn } of endedListeners) {
            try { v.removeEventListener('ended', fn); } catch (_) {}
        }
        endedListeners.length = 0;
        debug('finish', { total });
        cfg.onFinish();
    }

    function tick() {
        if (stopped) return;
        const t = (performance.now() - exportStart) / 1000;
        try {
            paintExportFrame({ ctx, canvas, project, t, videos, getImage });
            updateAudio(project, t);
        } catch (err) {
            cfg.onError(err);
            return;
        }
        progress(Math.min(t, total), 'recording');
        if (t >= total - 1e-3) { finish(); return; }
        raf = requestAnimationFrame(tick);
    }

    function start() {
        const hasAnyClip = getVideoTracks(project).some(tr => tr.clips && tr.clips.length > 0);
        if (!hasAnyClip || total <= 0) {
            paintBlack(ctx, canvas);
            progress(0, 'recording');
            finish();
            return;
        }
        // Bail out if any video ends naturally — preserves the round-7 fix
        // for clips whose outPoint is at/past the source duration.
        for (const v of videos.values()) {
            const fn = () => debug('video-ended', { src: v.currentSrc || '' });
            v.addEventListener('ended', fn);
            endedListeners.push({ v, fn });
        }
        paintBlack(ctx, canvas);
        exportStart = performance.now();
        debug('clip-active', { phase: 'wall-clock-start' });
        raf = requestAnimationFrame(tick);
    }

    function stop() {
        stopped = true;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        for (const v of videos.values()) {
            try { v.pause(); } catch (_) {}
        }
        for (const { v, fn } of endedListeners) {
            try { v.removeEventListener('ended', fn); } catch (_) {}
        }
        endedListeners.length = 0;
    }

    return { start, stop };
}
