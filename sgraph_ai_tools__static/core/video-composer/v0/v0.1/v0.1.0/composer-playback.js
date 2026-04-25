/**
 * composer-playback.js — preview engine using hidden videos + canvas.
 * @module video-composer/composer-playback
 */

import {
    snapToFps,
    clipTimelineEnd,
    getProjectDuration,
    getVideoTracks,
    findActiveClip,
} from './composer-schema.js';

/**
 * Create a playback handle for a project.
 * @param {{ project: object, assets: Map<string, Blob>, canvas: HTMLCanvasElement, fps: number }} opts
 * @returns {{ play: Function, pause: Function, seek: Function, getCurrentTime: Function, getDuration: Function, isPlaying: Function, destroy: Function }}
 */
export function createPlayback({ project, assets, canvas, fps }) {
    const ctx = canvas.getContext('2d');
    const videoTrack = getVideoTracks(project)[0] || null;
    const duration = getProjectDuration(project);
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

    let playhead = 0;
    let playing = false;
    let activeClip = null;
    let activeVideo = null;
    let rvfcHandle = 0;

    function emit(name, detail) {
        canvas.dispatchEvent(new CustomEvent(name, { detail }));
    }

    function drawFrame(video) {
        if (!video || video.readyState < 2) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    function setActive(clip) {
        if (activeVideo) {
            try { activeVideo.pause(); } catch (_) {}
            if (rvfcHandle && activeVideo.cancelVideoFrameCallback) {
                try { activeVideo.cancelVideoFrameCallback(rvfcHandle); } catch (_) {}
            }
        }
        activeClip = clip;
        activeVideo = clip ? videos.get(clip.assetId) : null;
        if (!activeVideo) return;
        const localTime = clip.inPoint + (playhead - clip.timelineStart);
        try { activeVideo.currentTime = Math.max(0, localTime); } catch (_) {}
    }

    function scheduleFrameLoop() {
        if (!activeVideo || !playing) return;
        if (typeof activeVideo.requestVideoFrameCallback !== 'function') {
            const tick = () => {
                if (!playing) return;
                onFrameTick();
                rvfcHandle = requestAnimationFrame(tick);
            };
            rvfcHandle = requestAnimationFrame(tick);
            return;
        }
        const cb = () => {
            if (!playing) return;
            onFrameTick();
            if (activeVideo) rvfcHandle = activeVideo.requestVideoFrameCallback(cb);
        };
        rvfcHandle = activeVideo.requestVideoFrameCallback(cb);
    }

    function onFrameTick() {
        if (!activeVideo || !activeClip) return;
        drawFrame(activeVideo);
        const local = activeVideo.currentTime;
        playhead = activeClip.timelineStart + (local - activeClip.inPoint);
        emit('composer:playhead-changed', { time: playhead });
        if (local >= activeClip.outPoint - 1e-3 || playhead >= duration - 1e-3) {
            advanceClip();
        }
    }

    function advanceClip() {
        const endOfClip = clipTimelineEnd(activeClip);
        playhead = endOfClip;
        if (playhead >= duration - 1e-3) {
            playing = false;
            try { activeVideo.pause(); } catch (_) {}
            emit('composer:ended', { time: playhead });
            return;
        }
        const next = findActiveClip(videoTrack, playhead);
        setActive(next);
        if (activeVideo) {
            activeVideo.play().then(scheduleFrameLoop).catch(() => {});
        }
    }

    function pickFallbackClip() {
        const clips = (videoTrack && Array.isArray(videoTrack.clips)) ? videoTrack.clips : [];
        if (clips.length === 0) return null;
        const sorted = [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
        for (const c of sorted) if (c.timelineStart >= playhead) return c;
        return sorted[0];
    }

    function play() {
        if (playing || !videoTrack) return;
        if (!Array.isArray(videoTrack.clips) || videoTrack.clips.length === 0) return;
        playing = true;
        let current = findActiveClip(videoTrack, playhead);
        if (!current) {
            const fallback = pickFallbackClip();
            if (!fallback) { playing = false; return; }
            playhead = snapToFps(fallback.timelineStart, fps);
            emit('composer:playhead-changed', { time: playhead });
            current = fallback;
        }
        if (!activeClip || activeClip !== current) setActive(current);
        if (activeVideo) {
            activeVideo.play().then(scheduleFrameLoop).catch(() => {});
        }
    }

    function pause() {
        playing = false;
        if (activeVideo) try { activeVideo.pause(); } catch (_) {}
    }

    function seek(t) {
        const snapped = snapToFps(Math.max(0, Math.min(t, duration)), fps);
        playhead = snapped;
        const clip = videoTrack ? findActiveClip(videoTrack, snapped) : null;
        setActive(clip);
        if (activeVideo) {
            const handler = () => {
                drawFrame(activeVideo);
                emit('composer:playhead-changed', { time: snapped });
            };
            if (activeVideo.readyState >= 2) handler();
            else activeVideo.addEventListener('seeked', handler, { once: true });
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            emit('composer:playhead-changed', { time: snapped });
        }
    }

    function destroy() {
        playing = false;
        for (const v of videos.values()) {
            try { v.pause(); } catch (_) {}
            v.removeAttribute('src');
            try { v.load(); } catch (_) {}
        }
        for (const url of urls.values()) URL.revokeObjectURL(url);
        videos.clear();
        urls.clear();
    }

    return {
        play,
        pause,
        seek,
        getCurrentTime: () => playhead,
        getDuration: () => duration,
        isPlaying: () => playing,
        destroy,
    };
}
