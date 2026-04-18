/**
 * sg-video-recorder.js
 * Canvas + audio MediaStream capture using MediaRecorder.
 *
 * v0.1.1 — additive: adds startRecordingStream() for recording any MediaStream directly.
 * All v0.1.0 exports are unchanged.
 *
 * @module sg-video-recorder
 * @version 0.1.1
 */

// ─── Module state ─────────────────────────────────────────────────────────────

/** @type {MediaRecorder|null} */
let _recorder = null;
/** @type {Blob[]} */
let _chunks = [];

// ─────────────────────────────────────────────────────────────────────────────
// Public API — v0.1.0 (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if MediaRecorder, canvas.captureStream, and AudioContext are all available.
 * @returns {boolean}
 */
export function isSupported() {
    return (
        typeof MediaRecorder !== 'undefined' &&
        typeof HTMLCanvasElement !== 'undefined' &&
        typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
        (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined')
    );
}

/**
 * Returns the best available MIME type for the current browser.
 * Preference order: vp9+opus → vp8+opus → webm → mp4
 * On Safari, this returns 'video/mp4'.
 * @returns {string}
 */
export function getBestMimeType() {
    const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
    ];
    return candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
}

/**
 * Starts recording a combined canvas video + audio stream.
 * Wires canvas.captureStream(fps) + audioStream into a single MediaStream.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {MediaStream} audioStream   From AudioContext.createMediaStreamDestination().stream
 * @param {object} [options]
 * @param {number}   [options.fps=30]
 * @param {string}   [options.mimeType]             Defaults to getBestMimeType()
 * @param {number}   [options.videoBitsPerSecond=2500000]
 * @throws {Error} If recording is already in progress or canvas.captureStream is unavailable
 */
export function startRecording(canvas, audioStream, options = {}) {
    if (_recorder && _recorder.state !== 'inactive') {
        throw new Error('Recording already in progress — call stopRecording() first');
    }

    const {
        fps                = 30,
        mimeType           = getBestMimeType(),
        videoBitsPerSecond = 2_500_000,
    } = options;

    const videoStream = canvas.captureStream(fps);
    const combined    = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioStream.getAudioTracks(),
    ]);

    _chunks   = [];
    _recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond });
    _recorder.ondataavailable = (e) => { if (e.data.size > 0) _chunks.push(e.data); };
    _recorder.start(100);
}

/**
 * Stops the active MediaRecorder and assembles the recorded Blob.
 * @returns {Promise<Blob>} WebM or MP4 blob depending on getBestMimeType()
 * @throws {Error} If no recording is active
 */
export async function stopRecording() {
    if (!_recorder || _recorder.state === 'inactive') {
        throw new Error('No active recording — call startRecording() or startRecordingStream() first');
    }

    return new Promise((resolve) => {
        _recorder.onstop = () => {
            const mimeType = _recorder.mimeType;
            const blob     = new Blob(_chunks, { type: mimeType });
            _chunks   = [];
            _recorder = null;
            resolve(blob);
        };
        _recorder.stop();
    });
}

/**
 * Returns the current recording state.
 * @returns {'inactive'|'recording'|'paused'|'idle'}
 */
export function getRecordingState() {
    if (!_recorder) return 'idle';
    return _recorder.state;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — v0.1.1 addition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start recording any MediaStream directly (camera, screen, or combined PiP stream).
 * Unlike startRecording(), this does not require a canvas or a separate AudioContext
 * stream — it wraps the full MediaStream (whatever video + audio tracks it contains)
 * directly in MediaRecorder.
 *
 * Intended to be used with streams produced by sg-capture.js buildStream().
 *
 * @param {MediaStream} stream  Any MediaStream — may have video tracks, audio tracks, or both.
 * @param {{ mimeType?: string, videoBitsPerSecond?: number, audioBitsPerSecond?: number }} [options]
 * @throws {Error} If recording is already in progress
 */
export function startRecordingStream(stream, options = {}) {
    if (_recorder && _recorder.state !== 'inactive') {
        throw new Error('Recording already in progress — call stopRecording() first');
    }

    const {
        mimeType           = getBestMimeType(),
        videoBitsPerSecond = 2_500_000,
        audioBitsPerSecond = 128_000,
    } = options;

    _chunks   = [];
    _recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond, audioBitsPerSecond });
    _recorder.ondataavailable = (e) => { if (e.data.size > 0) _chunks.push(e.data); };
    _recorder.start(100);
}
