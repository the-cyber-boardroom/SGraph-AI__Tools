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
 * @version 0.1.0
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

    let intervalId = null;

    function draw() {
        ctx.drawImage(screenVideo, 0, 0, width, height);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(pipX, pipY, pipW, pipH, 8);
        ctx.clip();
        ctx.drawImage(camVideo, pipX, pipY, pipW, pipH);
        ctx.restore();
    }

    // setInterval instead of requestAnimationFrame: rAF is throttled to ~1fps
    // when the tab is in the background, which is almost always the case during
    // screen recording (user has switched to the window being captured).
    intervalId = setInterval(draw, 1000 / fps);
    draw(); // draw first frame immediately

    // Combine canvas video with audio tracks from both inputs
    const canvasStream = canvas.captureStream(fps);
    const audioTracks  = [
        ...screenStream.getAudioTracks(),
        ...cameraStream.getAudioTracks(),
    ];
    const merged = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

    function stop() {
        if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
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
