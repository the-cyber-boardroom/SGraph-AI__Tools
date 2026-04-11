/**
 * sg-audio.js
 * MediaRecorder wrapper with segment-based recording and VFS integration.
 * v0.1.0 — initial implementation.
 *
 * Records audio in fixed-duration segments (default 30 s). Each segment blob
 * is delivered via an `onSegment` callback immediately when available — callers
 * should write it to VFS/IndexedDB so data survives device loss.
 *
 * @module sg-audio
 */

// ─────────────────────────────────────────────────────────────────────────────
// MIME type detection
// ─────────────────────────────────────────────────────────────────────────────

const PREFERRED_MIME_TYPES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
];

/**
 * Return the best supported audio MIME type for MediaRecorder, or null.
 * @returns {string|null}
 */
export function getBestMimeType() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const mime of PREFERRED_MIME_TYPES) {
        if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return null;
}

/**
 * Whether MediaRecorder is available and has at least one supported MIME type.
 * @returns {boolean}
 */
export function isMediaRecorderSupported() {
    return typeof MediaRecorder !== 'undefined' && getBestMimeType() !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording session
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RecordingSession
 * @property {MediaRecorder}   recorder
 * @property {MediaStream}     stream
 * @property {string}          sessionId
 * @property {string}          mimeType
 * @property {number}          segmentIndex
 * @property {number}          startTimeMs
 * @property {boolean}         stopped
 */

/**
 * @typedef {Object} SegmentEvent
 * @property {number} index         Segment index (1-based)
 * @property {Blob}   blob          Audio blob
 * @property {string} mimeType      MIME type of the blob
 * @property {number} startTimeMs   Session-relative start time (ms)
 * @property {number} durationMs    Approximate segment duration (ms)
 */

/**
 * Start a segment-based audio recording session.
 *
 * @param {Object}   opts
 * @param {number}   [opts.segmentDurationMs=30000]   Segment length in ms
 * @param {string}   [opts.mimeType]                  Override MIME type (auto-detected if omitted)
 * @param {Function} opts.onSegment                   Called with SegmentEvent for each segment
 * @param {Function} [opts.onError]                   Called with Error if recording fails
 * @returns {Promise<RecordingSession>}
 */
export async function startRecording(opts = {}) {
    const {
        segmentDurationMs = 30_000,
        mimeType: forcedMime,
        onSegment,
        onError,
    } = opts;

    if (!onSegment) throw new Error('onSegment callback is required');

    const mimeType = forcedMime ?? getBestMimeType();
    if (!mimeType) throw new Error('No supported audio MIME type found in this browser');

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    const recorder = new MediaRecorder(stream, { mimeType });
    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    /** @type {RecordingSession} */
    const session = {
        recorder,
        stream,
        sessionId,
        mimeType,
        segmentIndex: 0,
        startTimeMs: Date.now(),
        stopped: false,
    };

    let segmentStartMs = Date.now();

    recorder.addEventListener('dataavailable', (e) => {
        if (!e.data || e.data.size === 0) return;
        session.segmentIndex += 1;
        const durationMs = Date.now() - segmentStartMs;
        segmentStartMs = Date.now();
        onSegment({
            index:       session.segmentIndex,
            blob:        e.data,
            mimeType,
            startTimeMs: segmentStartMs - session.startTimeMs,
            durationMs,
        });
    });

    recorder.addEventListener('error', (e) => {
        if (onError) onError(e.error ?? new Error('MediaRecorder error'));
    });

    // Request data at segment boundaries
    recorder.start(segmentDurationMs);

    return session;
}

/**
 * Stop an active recording session. Returns a promise that resolves once the
 * final segment has been delivered via the onSegment callback.
 *
 * @param {RecordingSession} session
 * @returns {Promise<void>}
 */
export async function stopRecording(session) {
    if (session.stopped) return;
    session.stopped = true;

    return new Promise((resolve) => {
        session.recorder.addEventListener('stop', () => {
            // Stop all tracks so the browser removes the recording indicator
            session.stream.getTracks().forEach(t => t.stop());
            resolve();
        }, { once: true });

        // requestData so we get the final partial segment before stopping
        try { session.recorder.requestData(); } catch (_) { /* ignore */ }
        session.recorder.stop();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} HealthStepEvent
 * @property {number} step    0-based index
 * @property {number} total   Total steps
 * @property {string} label   Human-readable step name
 * @property {'pass'|'fail'|'skip'|'pending'} status
 */

/**
 * @typedef {Object} HealthResult
 * @property {boolean}  passed
 * @property {Array<{label:string, status:string, detail:string, latencyMs:number}>} results
 */

/**
 * Run audio-capture health checks.
 * Mirrors the video-tool runHealthCheck pattern.
 *
 * @param {Function} [onStep]  Called with HealthStepEvent after each step
 * @returns {Promise<HealthResult>}
 */
export async function runHealthCheck(onStep) {
    const results = [];
    let anyFail = false;

    /**
     * @param {string} label
     * @param {Function} fn   Returns {status, detail}
     */
    async function check(label, fn) {
        const step  = results.length;
        const total = 4; // update if you add more checks
        if (onStep) onStep({ step, total, label, status: 'pending' });
        const t0 = performance.now();
        let status = 'fail', detail = '';
        try {
            const r = await fn();
            status = r.status;
            detail = r.detail ?? '';
        } catch (err) {
            status = 'fail';
            detail = err.message;
        }
        const latencyMs = Math.round(performance.now() - t0);
        results.push({ label, status, detail, latencyMs });
        if (status === 'fail') anyFail = true;
        if (onStep) onStep({ step, total, label, status });
    }

    await check('WebAssembly support', async () => {
        const ok = typeof WebAssembly === 'object';
        return { status: ok ? 'pass' : 'skip', detail: ok ? 'Available' : 'Not available (transcription will not work)' };
    });

    await check('AudioContext support', async () => {
        const ok = typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
        return { status: ok ? 'pass' : 'fail', detail: ok ? 'Available' : 'Not available' };
    });

    await check('MediaRecorder support', async () => {
        if (!isMediaRecorderSupported()) {
            return { status: 'fail', detail: 'MediaRecorder not available or no supported MIME type' };
        }
        const mime = getBestMimeType();
        return { status: 'pass', detail: mime };
    });

    await check('Microphone permission', async () => {
        if (!navigator.permissions) return { status: 'skip', detail: 'Permissions API unavailable — will prompt on first record' };
        try {
            const p = await navigator.permissions.query({ name: 'microphone' });
            if (p.state === 'denied') return { status: 'fail', detail: 'Microphone access denied in browser settings' };
            if (p.state === 'granted') return { status: 'pass', detail: 'Already granted' };
            return { status: 'pass', detail: 'Will prompt when recording starts' };
        } catch (_) {
            return { status: 'skip', detail: 'Permission query not supported' };
        }
    });

    return { passed: !anyFail, results };
}
