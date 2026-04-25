/**
 * composer-export.js — export pipeline using captureStream + MediaRecorder.
 * @module video-composer/composer-export
 */

import {
    clipTimelineEnd,
    getProjectDuration,
    getVideoTracks,
    findActiveClip,
} from './composer-schema.js';

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

    const videos = new Map();
    const urls = new Map();
    for (const clip of (videoTrack?.clips ?? [])) {
        if (videos.has(clip.assetId)) continue;
        const blob = assets.get(clip.assetId);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        const v = document.createElement('video');
        v.src = url;
        v.playsInline = true;
        v.preload = 'auto';
        v.crossOrigin = 'anonymous';
        videos.set(clip.assetId, v);
        urls.set(clip.assetId, url);
    }

    const audioCtx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    const audioDest = audioCtx.createMediaStreamDestination();
    const audioSources = new Map();
    function connectAudio(video) {
        if (!video) return;
        let src = audioSources.get(video);
        if (!src) {
            try {
                src = audioCtx.createMediaElementSource(video);
                audioSources.set(video, src);
            } catch (_) { return; }
        }
        try { src.connect(audioDest); } catch (_) {}
    }
    function disconnectAudio(video) {
        const src = audioSources.get(video);
        if (src) try { src.disconnect(audioDest); } catch (_) {}
    }

    const videoStream = canvas.captureStream(fps);
    const tracks = [...videoStream.getVideoTracks()];
    const audioTracks = audioDest.stream.getAudioTracks();
    if (audioTracks.length > 0) tracks.push(audioTracks[0]);
    const stream = new MediaStream(tracks);

    const recorder = new MediaRecorder(stream, { mimeType, bitsPerSecond });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    return new Promise((resolve, reject) => {
        let activeClip = null;
        let activeVideo = null;
        let rvfcHandle = 0;
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
            if (local >= activeClip.outPoint - 1e-3 || tl >= total - 1e-3) {
                onClipEnd();
                return;
            }
            scheduleNext();
        }

        function scheduleNext() {
            if (stopped || !activeVideo) return;
            if (typeof activeVideo.requestVideoFrameCallback === 'function') {
                rvfcHandle = activeVideo.requestVideoFrameCallback(drawAndAdvance);
            } else {
                rvfcHandle = requestAnimationFrame(drawAndAdvance);
            }
        }

        function setActive(clip) {
            if (activeVideo) {
                try { activeVideo.pause(); } catch (_) {}
                disconnectAudio(activeVideo);
            }
            activeClip = clip;
            activeVideo = clip ? videos.get(clip.assetId) : null;
            if (!activeVideo) return;
            try { activeVideo.currentTime = clip.inPoint; } catch (_) {}
            connectAudio(activeVideo);
        }

        function onClipEnd() {
            if (!activeClip) return;
            const next = findActiveClip(videoTrack, clipTimelineEnd(activeClip));
            if (!next) { finish(); return; }
            setActive(next);
            activeVideo.play().then(scheduleNext).catch(reject);
        }

        function finish() {
            if (stopped) return;
            stopped = true;
            progress(total, 'finalizing');
            try { recorder.stop(); } catch (e) { reject(e); }
        }

        recorder.onstop = () => {
            for (const v of videos.values()) {
                try { v.pause(); } catch (_) {}
                v.removeAttribute('src');
                try { v.load(); } catch (_) {}
            }
            for (const url of urls.values()) URL.revokeObjectURL(url);
            try { audioCtx.close(); } catch (_) {}
            resolve(new Blob(chunks, { type: mimeType }));
        };
        recorder.onerror = (e) => reject(e.error || new Error('MediaRecorder error'));

        log('starting');
        recorder.start(100);

        const first = videoTrack ? findActiveClip(videoTrack, 0) : null;
        if (!first) { finish(); return; }
        setActive(first);
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        activeVideo.play().then(scheduleNext).catch(reject);
    });
}
