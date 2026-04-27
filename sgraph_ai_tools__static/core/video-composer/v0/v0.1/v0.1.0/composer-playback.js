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
 * Wait until a video element has at least HAVE_CURRENT_DATA (readyState >= 2)
 * and its first frame is paintable, then invoke `cb`.
 *
 * Chrome will NOT buffer frame data for a preload='metadata' video sitting at
 * currentTime=0 — it considers itself "already there" (no displacement) and
 * stops after loading metadata (readyState=1). We work around this by nudging
 * currentTime by 1ms once metadata is available, forcing a real seek that
 * triggers data loading. The nudge is imperceptible (< 1 video frame).
 *
 * @param {HTMLVideoElement} video
 * @param {() => void} cb
 * @returns {void}
 */
function waitForVideoFrame(video, cb) {
    if (!video) { cb(); return; }
    if (video.readyState >= 2) { cb(); return; }
    let done = false;
    function run() {
        if (done) return;
        if (video.readyState < 2) return; // seeked fired before frame data — keep waiting
        done = true;
        video.removeEventListener('seeked',     run);
        video.removeEventListener('loadeddata', run);
        video.removeEventListener('canplay',    run);
        cb();
    }
    function kickLoad() {
        if (done) return;
        // Nudge currentTime to force Chrome to buffer frame data. Without this,
        // preload='metadata' at currentTime=0 stays at readyState=1 forever.
        const t = video.currentTime;
        const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
        video.currentTime = (t + 1e-3 < d) ? t + 1e-3 : Math.max(0, t - 1e-3);
    }
    video.addEventListener('seeked',     run);
    video.addEventListener('loadeddata', run);
    video.addEventListener('canplay',    run);
    if (video.readyState < 1) {
        video.addEventListener('loadedmetadata', kickLoad, { once: true });
    } else {
        kickLoad();
    }
}

/**
 * Build a Map<assetId, HTMLVideoElement> covering every video clip on every
 * `kind: 'video'` track. Object URLs are returned in `urls` so callers can
 * revoke them on destroy.
 *
 * Round-9-M memory fix: `preload='metadata'` (not `'auto'`). With a
 * high-resolution screen recording (e.g. 4K MP4) and `preload='auto'`, Chrome
 * eagerly decodes large stretches of the file the moment the element gets a
 * src — combined with the shell's destroy+recreate-on-every-mutation pattern
 * this can stack multiple in-flight decoders on the same blob and balloon
 * heap usage to multiple GB. `'metadata'` defers the heavy decode to the
 * first `currentTime` set / `play()` call, which the scheduler / `seek()`
 * path issues anyway when a clip becomes active.
 *
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
            v.preload = 'metadata';
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
 * @returns {{ play: Function, pause: Function, seek: Function, refresh: Function, updateProject: Function, getCurrentTime: Function, getDuration: Function, isPlaying: Function, destroy: Function }}
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
        if (waitVideo) waitForVideoFrame(waitVideo, () => sched.paintAt(snapped));
        else if (waitImage) waitImage.addEventListener('load', () => sched.paintAt(snapped), { once: true });
        else sched.paintAt(snapped);
        emit('composer:playhead-changed', { time: snapped });
    }

    /** Force a synchronous repaint at the current playhead. Useful after a
     *  project mutation (clip add/remove/move/etc.) to flush a stale frame
     *  without needing a play→pause cycle. Cheap: just calls `paintAt`. */
    function refresh() { sched.paintAt(playhead); }

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

    /** Round-9-M: introspection helpers for the memory debug panel. Cheap;
     *  return current sizes of the composer's internal collections. */
    function getVideoCount() { return videos.size; }
    function getBlobUrlCount() { return urls.size; }
    function getVideoAssetIds() { return Array.from(videos.keys()); }

    return {
        play,
        pause,
        seek,
        refresh,
        updateProject,
        getCurrentTime: () => playhead,
        getDuration: () => duration,
        isPlaying: () => playing,
        getVideoCount,
        getBlobUrlCount,
        getVideoAssetIds,
        destroy,
    };
}
