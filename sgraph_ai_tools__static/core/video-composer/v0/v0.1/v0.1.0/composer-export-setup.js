/**
 * composer-export-setup.js — setup helpers for the export pipeline.
 * @module video-composer/composer-export-setup
 */

import { getAssetById, isImageAsset } from './composer-schema.js';

/**
 * Build a Map<assetId, HTMLVideoElement> for every video clip.
 * @param {object|null} videoTrack
 * @param {object} project
 * @param {Map<string, Blob>} assets
 * @returns {{ videos: Map<string, HTMLVideoElement>, urls: Map<string, string> }}
 */
export function buildVideoElements(videoTrack, project, assets) {
    const videos = new Map();
    const urls = new Map();
    for (const clip of (videoTrack?.clips ?? [])) {
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
    return { videos, urls };
}

/**
 * Build an AudioContext + MediaStreamDestination with connect/disconnect helpers.
 * @returns {{
 *   audioCtx: AudioContext, audioDest: MediaStreamAudioDestinationNode,
 *   connect: (v: HTMLVideoElement|null) => void,
 *   disconnect: (v: HTMLVideoElement|null) => void,
 *   close: () => void,
 * }}
 */
export function buildAudioGraph() {
    const audioCtx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    const audioDest = audioCtx.createMediaStreamDestination();
    const sources = new Map();
    function connect(video) {
        if (!video) return;
        let src = sources.get(video);
        if (!src) {
            try {
                src = audioCtx.createMediaElementSource(video);
                sources.set(video, src);
            } catch (_) { return; }
        }
        try { src.connect(audioDest); } catch (_) {}
    }
    function disconnect(video) {
        const src = sources.get(video);
        if (src) try { src.disconnect(audioDest); } catch (_) {}
    }
    function close() { try { audioCtx.close(); } catch (_) {} }
    return { audioCtx, audioDest, connect, disconnect, close };
}

/**
 * Build a recorder + canvas-stream MediaStream merging video + audio tracks.
 * @param {HTMLCanvasElement} canvas
 * @param {number} fps
 * @param {MediaStreamAudioDestinationNode} audioDest
 * @param {string} mimeType
 * @param {number|undefined} bitsPerSecond
 * @returns {{ recorder: MediaRecorder, chunks: Array<Blob> }}
 */
export function buildRecorder(canvas, fps, audioDest, mimeType, bitsPerSecond) {
    const videoStream = canvas.captureStream(fps);
    const tracks = [...videoStream.getVideoTracks()];
    const audioTracks = audioDest.stream.getAudioTracks();
    if (audioTracks.length > 0) tracks.push(audioTracks[0]);
    const stream = new MediaStream(tracks);
    const recorder = new MediaRecorder(stream, { mimeType, bitsPerSecond });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    return { recorder, chunks };
}

/**
 * Tear down hidden videos: pause, clear src, load.
 * @param {Map<string, HTMLVideoElement>} videos
 * @param {Map<string, string>} urls
 * @returns {void}
 */
export function teardownVideos(videos, urls) {
    for (const v of videos.values()) {
        try { v.pause(); } catch (_) {}
        v.removeAttribute('src');
        try { v.load(); } catch (_) {}
    }
    for (const url of urls.values()) URL.revokeObjectURL(url);
}
