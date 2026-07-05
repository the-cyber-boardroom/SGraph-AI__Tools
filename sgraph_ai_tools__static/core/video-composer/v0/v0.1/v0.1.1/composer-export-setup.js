/**
 * composer-export-setup.js — setup helpers for the export pipeline.
 * @module video-composer/composer-export-setup
 */

import { getAssetById, isImageAsset, getVideoTracks } from './composer-schema.js';

/**
 * Build a Map<clipId, HTMLVideoElement> covering every video clip on every
 * `kind: 'video'` track in the project.
 *
 * v0.1.1 FIX — the map is keyed by **clip.id**, matching how the export tick
 * (`composer-export-tick.js`: `videos.get(clip.id)`) and the audio switcher
 * look elements up, and matching the playback path (`composer-playback.js`).
 * v0.1.0 keyed this map by `clip.assetId`, so every export-time lookup missed:
 * no video was ever painted (the canvas kept its black fill) and no clip audio
 * was ever connected — every export with video clips came out black + silent.
 * One element per clip (not per asset) is also required for correctness: two
 * clips of the same asset can be active simultaneously at different times.
 *
 * @param {object} project
 * @param {Map<string, Blob>} assets
 * @returns {{ videos: Map<string, HTMLVideoElement>, urls: Map<string, string> }}
 */
export function buildVideoElements(project, assets) {
    const videos = new Map();
    const urls = new Map();
    for (const track of getVideoTracks(project)) {
        for (const clip of (track.clips || [])) {
            if (!clip.assetId || videos.has(clip.id)) continue;   // shape/text clips have no asset
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
            videos.set(clip.id, v);
            urls.set(clip.id, url);
        }
    }
    return { videos, urls };
}

/**
 * Build an AudioContext + MediaStreamDestination with connect/disconnect helpers.
 * Always connects a near-silent oscillator (gain ~1e-4) so the audio track
 * stays live for the entire export even when no video clip is connected
 * (e.g. image-only projects); some browsers refuse to deliver an audio
 * track in captureStream without a continuously-playing source.
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
    let osc = null; let oscGain = null;
    try {
        osc = audioCtx.createOscillator();
        oscGain = audioCtx.createGain();
        oscGain.gain.value = 0.0001;
        osc.frequency.value = 20;
        osc.connect(oscGain).connect(audioDest);
        osc.start();
    } catch (_) { /* best-effort silent keepalive */ }
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
    function close() {
        try { if (osc) osc.stop(); } catch (_) {}
        try { audioCtx.close(); } catch (_) {}
    }
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
