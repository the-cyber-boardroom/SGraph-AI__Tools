/**
 * composer-playback.js — public createPlayback factory; delegates the tick loop to composer-scheduler.
 * @module video-composer/composer-playback
 */

import {
    snapToFps,
    getProjectDuration,
    getVideoTracks,
    findActiveClip,
    getAssetById,
    isImageAsset,
} from './composer-schema.js';
import { createScheduler } from './composer-scheduler.js';
import { createImageRegistry } from './composer-images.js';

/**
 * Build a Map<assetId, HTMLVideoElement> covering every video clip on every
 * `kind: 'video'` track. Object URLs are returned in `urls` so callers can
 * revoke them on destroy.
 * @param {object} project
 * @param {Map<string, Blob>} assets
 * @returns {{ videos: Map<string, HTMLVideoElement>, urls: Map<string, string> }}
 */
function buildAllTrackVideos(project, assets) {
    const videos = new Map();
    const urls = new Map();
    for (const track of getVideoTracks(project)) {
        for (const clip of (track.clips || [])) {
            if (videos.has(clip.assetId)) continue;
            const asset = getAssetById(project, clip.assetId);
            if (isImageAsset(asset)) continue;
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
    }
    return { videos, urls };
}

/**
 * Create a playback handle for a project.
 * @param {{ project: object, assets: Map<string, Blob>, canvas: HTMLCanvasElement, fps: number }} opts
 * @returns {{ play: Function, pause: Function, seek: Function, getCurrentTime: Function, getDuration: Function, isPlaying: Function, destroy: Function }}
 */
export function createPlayback({ project, assets, canvas, fps }) {
    const ctx = canvas.getContext('2d');
    let liveProject = project;
    const videoTracks = getVideoTracks(project);
    const duration = getProjectDuration(project);
    const { videos, urls } = buildAllTrackVideos(project, assets);
    const imageReg = createImageRegistry(project.assets || [], assets);

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
        getProject: () => liveProject,
        getVideos: () => videos,
        getImage: (id) => imageReg.getImage(id),
        ctx, canvas, emit,
    });

    /** Swap in a new project shape (same assets/clips, only mutated transform/crop)
     *  and repaint the current frame. Cheap alternative to destroy+recreate. */
    function updateProject(next) {
        if (!next) return;
        liveProject = next;
        sched.paintAt(playhead);
    }

    function pauseAllVideos() {
        for (const v of videos.values()) {
            try { v.pause(); } catch (_) {}
        }
    }

    function play() {
        if (playing || videoTracks.length === 0 || duration <= 0) return;
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
        // Pre-seek every track's active video, and remember any not-yet-loaded
        // image so we can repaint when its decode lands. Otherwise a freshly
        // dropped image would paint black (paintAt runs before decode).
        let waitVideo = null;
        let waitImage = null;
        for (const track of videoTracks) {
            const clip = findActiveClip(track, snapped);
            if (!clip) continue;
            const asset = getAssetById(project, clip.assetId);
            if (isImageAsset(asset)) {
                const img = imageReg.getImage(clip.assetId);
                if (img && !img.complete) waitImage = img;
                continue;
            }
            const v = videos.get(clip.assetId);
            if (!v) continue;
            const local = clip.inPoint + (snapped - clip.timelineStart);
            try { v.currentTime = Math.max(0, local); } catch (_) {}
            if (v.readyState < 2) waitVideo = v;
        }
        if (waitVideo) waitVideo.addEventListener('seeked', () => sched.paintAt(snapped), { once: true });
        else if (waitImage) waitImage.addEventListener('load', () => sched.paintAt(snapped), { once: true });
        else sched.paintAt(snapped);
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
        imageReg.destroy();
    }

    return {
        play,
        pause,
        seek,
        updateProject,
        getCurrentTime: () => playhead,
        getDuration: () => duration,
        isPlaying: () => playing,
        destroy,
    };
}
