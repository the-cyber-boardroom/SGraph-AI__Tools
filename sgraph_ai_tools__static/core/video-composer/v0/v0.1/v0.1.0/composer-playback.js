/**
 * composer-playback.js — public createPlayback factory; delegates the tick loop to composer-scheduler.
 * @module video-composer/composer-playback
 */

import {
    snapToFps,
    getProjectDuration,
    getVideoTracks,
    findActiveClip,
} from './composer-schema.js';
import { createScheduler } from './composer-scheduler.js';

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

    function emit(name, detail) {
        canvas.dispatchEvent(new CustomEvent(name, { detail }));
    }

    const sched = createScheduler({
        getPlaying: () => playing,
        setPlaying: (v) => { playing = v; },
        getTime: () => playhead,
        setTime: (t) => { playhead = t; },
        getDuration: () => duration,
        getTrack: () => videoTrack,
        getVideos: () => videos,
        ctx, canvas, emit,
    });

    function pauseAllVideos() {
        for (const v of videos.values()) {
            try { v.pause(); } catch (_) {}
        }
    }

    function play() {
        if (playing || !videoTrack || duration <= 0) return;
        if (playhead >= duration - 1e-3) playhead = 0;
        playing = true;
        emit('composer:state-changed', { playing: true });
        sched.start();
    }

    function pause() {
        if (!playing) return;
        playing = false;
        sched.stop();
        pauseAllVideos();
        emit('composer:state-changed', { playing: false });
    }

    function seek(t) {
        const snapped = snapToFps(Math.max(0, Math.min(t, duration || 0)), fps);
        playhead = snapped;
        const clip = videoTrack ? findActiveClip(videoTrack, snapped) : null;
        if (clip) {
            const v = videos.get(clip.assetId);
            if (v) {
                const local = clip.inPoint + (snapped - clip.timelineStart);
                try { v.currentTime = Math.max(0, local); } catch (_) {}
                if (v.readyState >= 2) sched.paintAt(snapped);
                else v.addEventListener('seeked', () => sched.paintAt(snapped), { once: true });
            } else {
                sched.paintAt(snapped);
            }
        } else {
            sched.paintAt(snapped);
        }
        emit('composer:playhead-changed', { time: snapped });
    }

    function destroy() {
        playing = false;
        sched.stop();
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
