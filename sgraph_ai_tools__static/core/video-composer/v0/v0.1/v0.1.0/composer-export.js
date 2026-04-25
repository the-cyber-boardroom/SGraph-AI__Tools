/**
 * composer-export.js — export pipeline using captureStream + MediaRecorder.
 * @module video-composer/composer-export
 */

import {
    clipDuration,
    clipTimelineEnd,
    getProjectDuration,
    getVideoTracks,
    findActiveClip,
    getAssetById,
    isImageAsset,
} from './composer-schema.js';
import { createImageRegistry } from './composer-images.js';
import { paintBlack, paintImage } from './composer-draw.js';
import {
    buildVideoElements, buildAudioGraph, buildRecorder, teardownVideos,
} from './composer-export-setup.js';

/**
 * Render the project to a Blob via real-time capture + MediaRecorder.
 * @param {{ project: object, assets: Map<string, Blob>, fps: number, mimeType: string, bitsPerSecond?: number, onProgress?: Function, onLog?: Function }} opts
 * @returns {Promise<Blob>}
 */
export function exportProject({ project, assets, fps, mimeType, bitsPerSecond, onProgress, onLog }) {
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        const err = new Error(`Unsupported mimeType: ${mimeType}`);
        err.code = 'unsupported-mime';
        throw err;
    }

    const total = getProjectDuration(project);
    const videoTrack = getVideoTracks(project)[0] || null;

    const canvas = document.createElement('canvas');
    canvas.width = project.width;
    canvas.height = project.height;
    const ctx = canvas.getContext('2d');

    const { videos, urls } = buildVideoElements(videoTrack, project, assets);
    const imageReg = createImageRegistry(project.assets || [], assets);
    const audio = buildAudioGraph();
    const { recorder, chunks } = buildRecorder(canvas, fps, audio.audioDest, mimeType, bitsPerSecond);

    return new Promise((resolve, reject) => {
        let activeClip = null;
        let activeVideo = null;
        let imageTimer = 0;
        let imageStart = 0;
        let stopped = false;

        function log(msg) { if (typeof onLog === 'function') onLog(msg); }
        function progress(time, phase) {
            if (typeof onProgress === 'function') {
                onProgress({ time, total, ratio: total > 0 ? Math.min(1, time / total) : 0, phase });
            }
        }

        function drawAndAdvance() {
            if (stopped || !activeVideo || !activeClip) return;
            if (activeVideo.readyState >= 2) {
                ctx.drawImage(activeVideo, 0, 0, canvas.width, canvas.height);
            }
            const local = activeVideo.currentTime;
            const tl = activeClip.timelineStart + (local - activeClip.inPoint);
            progress(tl, 'recording');
            if (local >= activeClip.outPoint - 1e-3 || tl >= total - 1e-3) { onClipEnd(); return; }
            scheduleNext();
        }

        function scheduleNext() {
            if (stopped || !activeVideo) return;
            if (typeof activeVideo.requestVideoFrameCallback === 'function') {
                activeVideo.requestVideoFrameCallback(drawAndAdvance);
            } else {
                requestAnimationFrame(drawAndAdvance);
            }
        }

        function tickImage() {
            if (stopped || !activeClip) return;
            const elapsed = (performance.now() - imageStart) / 1000;
            const dur = clipDuration(activeClip);
            const tl = activeClip.timelineStart + Math.min(elapsed, dur);
            progress(tl, 'recording');
            if (elapsed >= dur - 1e-3 || tl >= total - 1e-3) { onClipEnd(); return; }
            imageTimer = requestAnimationFrame(tickImage);
        }

        function setActive(clip) {
            if (activeVideo) { try { activeVideo.pause(); } catch (_) {} audio.disconnect(activeVideo); }
            if (imageTimer) { cancelAnimationFrame(imageTimer); imageTimer = 0; }
            activeClip = clip;
            const asset = clip ? getAssetById(project, clip.assetId) : null;
            if (clip && isImageAsset(asset)) {
                activeVideo = null;
                paintImage(ctx, canvas, imageReg.getImage(clip.assetId));
                imageStart = performance.now();
                imageTimer = requestAnimationFrame(tickImage);
                return;
            }
            activeVideo = clip ? videos.get(clip.assetId) : null;
            if (!activeVideo) { paintBlack(ctx, canvas); return; }
            try { activeVideo.currentTime = clip.inPoint; } catch (_) {}
            audio.connect(activeVideo);
        }

        function onClipEnd() {
            if (!activeClip) return;
            const next = findActiveClip(videoTrack, clipTimelineEnd(activeClip));
            if (!next) { finish(); return; }
            const nextAsset = getAssetById(project, next.assetId);
            setActive(next);
            if (isImageAsset(nextAsset)) return;
            if (activeVideo) activeVideo.play().then(scheduleNext).catch(reject);
        }

        function finish() {
            if (stopped) return;
            stopped = true;
            if (imageTimer) { cancelAnimationFrame(imageTimer); imageTimer = 0; }
            progress(total, 'finalizing');
            try { recorder.stop(); } catch (e) { reject(e); }
        }

        recorder.onstop = () => {
            teardownVideos(videos, urls);
            imageReg.destroy();
            audio.close();
            resolve(new Blob(chunks, { type: mimeType }));
        };
        recorder.onerror = (e) => reject(e.error || new Error('MediaRecorder error'));

        log('starting');
        recorder.start(100);

        const first = videoTrack ? findActiveClip(videoTrack, 0) : null;
        if (!first) { finish(); return; }
        const firstAsset = getAssetById(project, first.assetId);
        setActive(first);
        if (audio.audioCtx.state === 'suspended') audio.audioCtx.resume().catch(() => {});
        if (isImageAsset(firstAsset)) return;
        if (activeVideo) activeVideo.play().then(scheduleNext).catch(reject);
        else finish();
    });
}
