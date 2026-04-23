/**
 * sg-video-recorder.js
 * Pure utility exports for MediaRecorder format detection.
 *
 * v0.1.2 — removes the module-level singleton recorder state that existed in
 * v0.1.0 and v0.1.1 (startRecording, startRecordingStream, stopRecording,
 * getRecordingState, getRecorder). Those functions stored a single _recorder
 * instance at module scope, which prevented running multiple concurrent
 * recorders and caused state leaks between recordings.
 *
 * recorder-pipeline.js manages its own MediaRecorder instances via
 * RecordingSession and only needed the pure utility functions from this module.
 *
 * Consumers that need the full recorder lifecycle should use RecordingSession
 * in recorder-pipeline.js directly.
 *
 * @module sg-video-recorder
 * @version 0.1.2
 */

/**
 * Returns true if MediaRecorder and canvas.captureStream are available.
 * @returns {boolean}
 */
export function isSupported() {
    return (
        typeof MediaRecorder !== 'undefined' &&
        typeof HTMLCanvasElement !== 'undefined' &&
        typeof HTMLCanvasElement.prototype.captureStream === 'function'
    );
}

/**
 * Returns the best available MIME type for the current browser.
 * Preference order: mp4/H.264+AAC → mp4 → vp9+opus → vp8+opus → webm.
 * MP4/H.264 is preferred for QuickTime / macOS compatibility.
 * Firefox only supports WebM so it falls through to vp9/vp8.
 * @returns {string}
 */
export function getBestMimeType() {
    const candidates = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4;codecs=avc1',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
    ];
    return candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
}
