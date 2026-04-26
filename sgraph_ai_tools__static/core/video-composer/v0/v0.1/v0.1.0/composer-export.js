/**
 * composer-export.js — orchestrator for canvas captureStream + MediaRecorder
 * export pipeline. Wires the per-frame loop (composer-export-loop.js) into
 * a Promise<Blob> and dispatches `composer:export-debug` CustomEvents on
 * `document` at every stage transition (start, recorder-start, clip-active,
 * clip-end, finish, blob, error).
 *
 * Bug history: pre-fix, image-only and image-leading exports stalled at
 * very low progress because canvas.captureStream(fps) only emits frames
 * when the canvas is repainted. Image clips painted once in setActive and
 * then only ticked progress, so the recorder buffer received almost no
 * data. Fix lives in composer-export-loop.js: tickImage now repaints the
 * canvas every rAF. composer-export-setup.js also keeps a near-silent
 * oscillator wired to the audio destination so the audio track stays live
 * even with image-only projects.
 *
 * @module video-composer/composer-export
 */

import {
    getProjectDuration,
} from './composer-schema.js';
import { createImageRegistry } from './composer-images.js';
import {
    buildVideoElements, buildAudioGraph, buildRecorder, teardownVideos,
} from './composer-export-setup.js';
import { createExportLoop } from './composer-export-loop.js';
import { debug } from './composer-export-debug.js';

/**
 * Render the project to a Blob via real-time capture + MediaRecorder.
 * @param {{ project: object, assets: Map<string, Blob>, fps: number, mimeType: string, bitsPerSecond?: number, onProgress?: Function, onLog?: Function }} opts
 * @returns {Promise<Blob>}
 */
export function exportProject({ project, assets, fps, mimeType, bitsPerSecond, onProgress, onLog }) {
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        const err = new Error(`Unsupported mimeType: ${mimeType}`);
        err.code = 'unsupported-mime';
        debug('error', { stage: 'mime', message: err.message, mimeType });
        throw err;
    }

    const total = getProjectDuration(project);
    const canvas = document.createElement('canvas');
    canvas.width = project.width;
    canvas.height = project.height;
    const ctx = canvas.getContext('2d');

    const { videos, urls } = buildVideoElements(project, assets);
    const imageReg = createImageRegistry(project.assets || [], assets);
    const audio = buildAudioGraph();
    const { recorder, chunks } = buildRecorder(canvas, fps, audio.audioDest, mimeType, bitsPerSecond);

    debug('start', { mimeType, fps, total, width: project.width, height: project.height });
    if (typeof onLog === 'function') onLog('starting');

    return new Promise((resolve, reject) => {
        let finished = false;
        const loop = createExportLoop({
            project, total, ctx, canvas, videos,
            getImage: (id) => imageReg.getImage(id),
            audio,
            onProgress: (info) => { if (typeof onProgress === 'function') onProgress(info); },
            onError: (err) => { if (!finished) { finished = true; debug('error', { message: err && err.message }); try { recorder.stop(); } catch (_) {} reject(err); } },
            onFinish: () => {
                if (finished) return;
                finished = true;
                if (typeof onProgress === 'function') {
                    onProgress({ time: total, total, ratio: 1, phase: 'finalizing' });
                }
                debug('finish', { total });
                try { recorder.stop(); } catch (e) { reject(e); }
            },
        });

        recorder.onstop = () => {
            try {
                teardownVideos(videos, urls);
                imageReg.destroy();
                audio.close();
            } catch (_) {}
            const blob = new Blob(chunks, { type: mimeType });
            debug('blob', { size: blob.size, type: blob.type, chunks: chunks.length });
            resolve(blob);
        };
        recorder.onerror = (e) => {
            const err = (e && e.error) || new Error('MediaRecorder error');
            debug('error', { stage: 'recorder', message: err.message });
            reject(err);
        };

        try {
            recorder.start(100);
            debug('recorder-start', { timesliceMs: 100 });
        } catch (e) {
            debug('error', { stage: 'recorder-start', message: e && e.message });
            reject(e); return;
        }
        if (audio.audioCtx.state === 'suspended') audio.audioCtx.resume().catch(() => {});
        loop.start();
    });
}
