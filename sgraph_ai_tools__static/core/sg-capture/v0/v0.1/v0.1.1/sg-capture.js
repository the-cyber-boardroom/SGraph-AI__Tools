/**
 * sg-capture.js
 * Unified MediaStream acquisition — camera, microphone, screen, and PiP compositing.
 *
 * Produces MediaStream objects consumed by sg-video-recorder.js startRecordingStream().
 * This module only acquires and composes streams; it never records.
 *
 * Supported modes (all 7 combinations of camera / audio / screen):
 *   audio-only, camera-only, screen-only,
 *   camera+audio, screen+audio, camera+screen (PiP), camera+screen+audio
 *
 * @module sg-capture
 * @version 0.1.1
 *
 * v0.1.1 — Background-tab fix for canvas compositing.
 *   Chrome throttles main-thread setInterval to <=1Hz (and, after 5 min, to 1/min)
 *   for hidden tabs, and idles canvas.captureStream(fps) auto-capture. During a
 *   screen recording the recorder tab is normally hidden (the user works in the
 *   shared tab), so the old setInterval-driven compositor dropped to ~0.5 fps while
 *   audio stayed fine. mergeAsPiP() now drives its draw loop from a Web Worker timer
 *   (not visibility-throttled) and pushes each frame explicitly via
 *   CanvasCaptureMediaStreamTrack.requestFrame() on a manual-capture stream
 *   (captureStream(0)), falling back to auto-capture where requestFrame is absent.
 *   The ticker is exported as startBackgroundSafeTicker() for reuse by other
 *   canvas compositors (e.g. the tool's Shorts layout).
 */

// ─── Support detection ────────────────────────────────────────────────────────

/**
 * Returns true if getUserMedia camera/mic capture is available.
 * @returns {boolean}
 */
export function isCameraSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Returns true if getDisplayMedia screen capture is available.
 * @returns {boolean}
 */
export function isScreenSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

// ─── Stream acquisition ───────────────────────────────────────────────────────

/**
 * Request a camera (video) and optionally microphone (audio) stream.
 *
 * @param {{ width?: number, height?: number, frameRate?: number, audio?: boolean }} [constraints]
 * @returns {Promise<MediaStream>}
 * @throws {Error} If camera is not supported or permission is denied
 */
export async function getCameraStream(constraints = {}) {
    if (!isCameraSupported()) {
        throw new Error('Camera capture is not supported in this browser');
    }

    const { width = 1280, height = 720, frameRate = 30, audio = false } = constraints;

    return navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate } },
        audio,
    });
}

/**
 * Request microphone audio only.
 *
 * @param {{ sampleRate?: number, echoCancellation?: boolean, noiseSuppression?: boolean }} [options]
 * @returns {Promise<MediaStream>}
 * @throws {Error} If getUserMedia is unavailable or permission is denied
 */
export async function getAudioStream(options = {}) {
    if (!isCameraSupported()) {
        throw new Error('getUserMedia is not supported in this browser');
    }

    const { sampleRate = 48000, echoCancellation = true, noiseSuppression = true } = options;

    return navigator.mediaDevices.getUserMedia({
        audio: { sampleRate, echoCancellation, noiseSuppression },
        video: false,
    });
}

/**
 * Request a screen / window / tab capture stream.
 * The browser shows its own source-picker UI — this cannot be triggered
 * programmatically and must be called directly from a user gesture handler.
 *
 * @param {{ audio?: boolean, preferCurrentTab?: boolean }} [options]
 * @returns {Promise<MediaStream>}
 * @throws {Error} If screen capture is not supported or user cancels
 */
export async function getScreenStream(options = {}) {
    if (!isScreenSupported()) {
        throw new Error('Screen capture is not supported in this browser');
    }

    const { audio = false, preferCurrentTab = false } = options;

    const displayOptions = {
        video: { cursor: 'always' },
        audio,
    };

    if (preferCurrentTab && 'preferCurrentTab' in displayOptions) {
        displayOptions.preferCurrentTab = true;
    }

    return navigator.mediaDevices.getDisplayMedia(displayOptions);
}

// ─── Background-safe canvas pumping ────────────────────────────────────────────

/**
 * Start a ticker that fires `onTick` ~fps times per second and KEEPS FIRING at
 * that rate even when the owning tab is hidden.
 *
 * A hidden tab has its main-thread setInterval/setTimeout throttled by Chrome to at
 * most once per second (once per minute after ~5 min). A dedicated Web Worker's
 * timer is not subject to that throttling, and the message it posts back to the main
 * thread is delivered on the (unthrottled) message task source — so the main-thread
 * `onTick` (which does the actual drawImage work) runs at the requested cadence.
 *
 * Falls back to a plain setInterval if a Worker cannot be created (e.g. a strict CSP
 * blocks blob: workers) — no worse than the previous behaviour in that case.
 *
 * @param {number}   fps
 * @param {Function} onTick   Runs on the main thread every tick.
 * @returns {() => void} stop function — call once to end the ticker and free the worker.
 */
export function startBackgroundSafeTicker(fps, onTick) {
    const intervalMs = Math.max(4, Math.round(1000 / (fps || 30)));
    try {
        const src  = 'onmessage=e=>{setInterval(()=>postMessage(0),e.data);};';
        const url  = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = () => onTick();
        worker.postMessage(intervalMs);
        return () => { try { worker.terminate(); } catch (_) {} };
    } catch (_) {
        const id = setInterval(onTick, intervalMs);
        return () => clearInterval(id);
    }
}

/**
 * Create a MediaStream from a canvas with explicit per-frame control when the browser
 * supports it. With requestFrame() available we use captureStream(0) (no automatic
 * capture — the page's compositor is idle when hidden, so auto-capture starves) and
 * emit frames only when the caller calls `pushFrame()`. Where requestFrame() is
 * absent (older Safari), we fall back to captureStream(fps) and `pushFrame` is a no-op.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number}            fps
 * @returns {{ stream: MediaStream, videoTrack: MediaStreamTrack, pushFrame: () => void }}
 */
export function captureCanvasStream(canvas, fps) {
    let stream = canvas.captureStream(0);
    let track  = stream.getVideoTracks()[0];
    if (track && typeof track.requestFrame === 'function') {
        return { stream, videoTrack: track, pushFrame: () => track.requestFrame() };
    }
    // requestFrame unsupported — captureStream(0) would never emit; recapture at fps.
    stream.getTracks().forEach(t => t.stop());
    stream = canvas.captureStream(fps);
    track  = stream.getVideoTracks()[0];
    return { stream, videoTrack: track, pushFrame: () => {} };
}

// ─── PiP compositing ─────────────────────────────────────────────────────────

/**
 * Merge a camera stream as a PiP overlay onto a screen stream using canvas compositing.
 * Returns a single MediaStream (from the compositing canvas) plus a stop function.
 *
 * The stop function MUST be called when recording ends to release resources.
 *
 * @param {MediaStream} screenStream
 * @param {MediaStream} cameraStream
 * @param {{ position?: 'tr'|'tl'|'br'|'bl', scale?: number, fps?: number }} [options]
 * @returns {Promise<{ stream: MediaStream, stop: () => void }>}
 */
export async function mergeAsPiP(screenStream, cameraStream, options = {}) {
    const { position = 'br', scale = 0.2, fps = 30 } = options;

    // Derive canvas dimensions from the screen video track
    const screenTrack = screenStream.getVideoTracks()[0];
    const settings    = screenTrack.getSettings();
    const width       = settings.width  || 1280;
    const height      = settings.height || 720;

    const canvas      = document.createElement('canvas');
    canvas.width      = width;
    canvas.height     = height;
    const ctx         = canvas.getContext('2d');

    const screenVideo = _createVideoEl(screenStream);
    const camVideo    = _createVideoEl(cameraStream);

    await Promise.all([_waitForVideoReady(screenVideo), _waitForVideoReady(camVideo)]);

    const pipW = Math.round(width  * scale);
    const pipH = Math.round(height * scale);
    const pad  = 16;

    const pipX = _pipX(position, width,  pipW, pad);
    const pipY = _pipY(position, height, pipH, pad);

    function draw() {
        ctx.drawImage(screenVideo, 0, 0, width, height);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(pipX, pipY, pipW, pipH, 8);
        ctx.clip();
        ctx.drawImage(camVideo, pipX, pipY, pipW, pipH);
        ctx.restore();
    }

    // Manual-capture stream + worker-driven ticker: keeps compositing at ~fps even
    // when the recorder tab is hidden (the normal case during a screen recording).
    // A plain setInterval here is throttled to <=1Hz by Chrome for hidden tabs, and
    // captureStream(fps) auto-capture idles too — hence the previous ~0.5fps bug.
    const { stream: canvasStream, videoTrack, pushFrame } = captureCanvasStream(canvas, fps);
    draw();       // draw first frame immediately
    pushFrame();  // …and emit it

    const stopTicker = startBackgroundSafeTicker(fps, () => { draw(); pushFrame(); });

    // Combine canvas video with audio tracks from both inputs
    const audioTracks = [
        ...screenStream.getAudioTracks(),
        ...cameraStream.getAudioTracks(),
    ];
    const merged = new MediaStream([videoTrack, ...audioTracks]);

    function stop() {
        stopTicker();
        screenVideo.srcObject = null;
        camVideo.srcObject    = null;
    }

    return { stream: merged, stop };
}

// ─── Unified builder ──────────────────────────────────────────────────────────

/**
 * Build a MediaStream for any of the 7 source combinations.
 * All getDisplayMedia calls must happen within a user gesture — if `screen` is true,
 * call this function directly from a click handler.
 *
 * @param {{
 *   camera?:     boolean,
 *   audio?:      boolean,
 *   screen?:     boolean,
 *   pipOptions?: { position?: 'tr'|'tl'|'br'|'bl', scale?: number, fps?: number },
 *   cameraConstraints?: { width?: number, height?: number, frameRate?: number },
 *   audioOptions?: { sampleRate?: number, echoCancellation?: boolean, noiseSuppression?: boolean },
 *   screenOptions?: { audio?: boolean, preferCurrentTab?: boolean },
 * }} sources
 * @returns {Promise<{ stream: MediaStream, stop: () => void }>}
 *   `stop()` must be called when done to release all acquired tracks.
 */
export async function buildStream(sources = {}) {
    const {
        camera       = false,
        audio        = false,
        screen       = false,
        pipOptions   = {},
        cameraConstraints = {},
        audioOptions = {},
        screenOptions = {},
    } = sources;

    if (!camera && !audio && !screen) {
        throw new Error('buildStream: at least one source (camera, audio, screen) must be true');
    }

    let cameraStream = null;
    let audioStream  = null;
    let screenStream = null;
    let pipStop      = null;

    // Acquire all requested streams in parallel where possible.
    // Screen must be acquired first (user gesture constraint — can't be inside Promise.all
    // after async work has happened). Audio/camera can follow.
    if (screen) {
        screenStream = await getScreenStream({ audio: false, ...screenOptions });
    }

    const [cs, as] = await Promise.all([
        camera ? getCameraStream({ audio: false, ...cameraConstraints }) : null,
        audio  ? getAudioStream(audioOptions)                            : null,
    ]);
    cameraStream = cs;
    audioStream  = as;

    function stopAll() {
        if (pipStop) pipStop();
        [cameraStream, audioStream, screenStream].forEach(s => s && stopStream(s));
    }

    // PiP composite: camera overlay on screen
    if (camera && screen) {
        // Merge audio from the standalone audio stream into the PiP stream
        const pip = await mergeAsPiP(screenStream, cameraStream, pipOptions);
        pipStop = pip.stop;
        let finalStream = pip.stream;

        if (audio && audioStream) {
            finalStream = new MediaStream([
                ...pip.stream.getVideoTracks(),
                ...audioStream.getAudioTracks(),
            ]);
        }

        return { stream: finalStream, stop: stopAll };
    }

    // Non-PiP: assemble tracks directly
    const videoTracks = [
        ...(cameraStream ? cameraStream.getVideoTracks() : []),
        ...(screenStream ? screenStream.getVideoTracks() : []),
    ];
    const audioTracks = [
        ...(audioStream  ? audioStream.getAudioTracks()  : []),
        ...(screenStream && screenOptions.audio ? screenStream.getAudioTracks() : []),
    ];

    const stream = new MediaStream([...videoTracks, ...audioTracks]);
    return { stream, stop: stopAll };
}

// ─── Stream lifecycle ─────────────────────────────────────────────────────────

/**
 * Stop all tracks on a MediaStream. Safe to call multiple times.
 * @param {MediaStream} stream
 */
export function stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach(t => t.stop());
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _createVideoEl(stream) {
    const v         = document.createElement('video');
    v.srcObject     = stream;
    v.muted         = true;
    v.autoplay      = true;
    v.playsInline   = true;
    return v;
}

function _waitForVideoReady(videoEl) {
    return new Promise((resolve) => {
        if (videoEl.readyState >= 2) { resolve(); return; }
        videoEl.onloadeddata = resolve;
        videoEl.play().catch(() => {});
    });
}

function _pipX(position, canvasW, pipW, pad) {
    return (position === 'tl' || position === 'bl') ? pad : canvasW - pipW - pad;
}

function _pipY(position, canvasH, pipH, pad) {
    return (position === 'tl' || position === 'tr') ? pad : canvasH - pipH - pad;
}
