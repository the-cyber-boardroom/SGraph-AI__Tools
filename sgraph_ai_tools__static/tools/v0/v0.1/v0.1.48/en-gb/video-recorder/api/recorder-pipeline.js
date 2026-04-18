/**
 * recorder-pipeline.js
 * Multi-stream capture + independent recording pipeline.
 *
 * Camera, screen, and audio are each recorded by their own MediaRecorder so every
 * track is available as a separate blob after stop. No PiP compositing happens at
 * record time — compositing is a post-processing concern.
 *
 * @module recorder-pipeline
 */

import { getCameraStream, getAudioStream, getScreenStream, mergeAsPiP } from '/core/sg-capture/v0/v0.1/v0.1.0/sg-capture.js';
import { getBestMimeType }                                   from '/core/sg-video-recorder/v0/v0.1/v0.1.1/sg-video-recorder.js';
import { RecordingConfig, RecordingState }                   from './recorder-state.js';
import { SGA_RECORDER }                                      from './recorder-events.js';

/** @type {RecordingConfig} */
export const config = new RecordingConfig();

/** @type {RecordingState} */
export const state  = new RecordingState();

// ─── Mode → source flags ──────────────────────────────────────────────────────

const MODE_FLAGS = {
    'audio':               { camera: false, audio: true,  screen: false },
    'camera':              { camera: true,  audio: false, screen: false },
    'screen':              { camera: false, audio: false, screen: true  },
    'camera+audio':        { camera: true,  audio: true,  screen: false },
    'screen+audio':        { camera: false, audio: true,  screen: true  },
    'camera+screen':       { camera: true,  audio: false, screen: true  },
    'camera+screen+audio': { camera: true,  audio: true,  screen: true  },
};

// ─── Per-track MediaRecorder state ───────────────────────────────────────────

/** @type {{ camera?: MediaRecorder, screen?: MediaRecorder, audio?: MediaRecorder, combined?: MediaRecorder }} */
const _recorders = {};

/** @type {{ camera?: Blob[], screen?: Blob[], audio?: Blob[], combined?: Blob[] }} */
const _chunks    = {};

/** Stops the PiP canvas compositor if active. @type {Function|null} */
let _pipStop = null;

// ─── Preview ──────────────────────────────────────────────────────────────────

/**
 * Show a camera/audio preview before recording.
 * Only applicable to modes that include camera; for screen-only modes Preview
 * is not possible (getDisplayMedia requires a user gesture at record time).
 *
 * @returns {Promise<void>}
 */
export async function startPreview() {
    if (state.status === 'recording') throw new Error('Cannot preview while recording');
    if (state.previewStream) return;

    const flags = MODE_FLAGS[config.mode] ?? MODE_FLAGS['camera+audio'];
    if (!flags.camera) throw new Error('Preview not available for screen-only modes');

    try {
        const stream = await getCameraStream({ audio: flags.audio });
        state.previewStream = stream;
        state.previewStop   = () => stream.getTracks().forEach(t => t.stop());

        _dispatchOnWindow(SGA_RECORDER.PREVIEW_START, {
            hasVideo: true,
            mode:     config.mode,
            stream,
        });
    } catch (err) {
        state.lastError = err.message;
        _dispatchOnWindow(SGA_RECORDER.ERROR, { step: 'preview', message: err.message });
        throw err;
    }
}

/**
 * Stop any active preview and dispatch PREVIEW_STOP.
 */
export function stopPreview() {
    if (state.previewStop) state.previewStop();
    state.previewStream = null;
    state.previewStop   = null;
    _dispatchOnWindow(SGA_RECORDER.PREVIEW_STOP, {});
}

// ─── Recording ────────────────────────────────────────────────────────────────

/**
 * Begin capture and recording.
 * For modes that include screen capture, this MUST be called directly from a
 * user gesture handler (button click) — getDisplayMedia requires it.
 *
 * Fires tool:record:start when all MediaRecorders have started.
 *
 * @returns {Promise<void>}
 */
export async function startPipeline() {
    if (state.status === 'recording') throw new Error('Recording already in progress');

    state.status = 'requesting-permissions';
    const flags  = MODE_FLAGS[config.mode] ?? MODE_FLAGS['camera+audio'];

    try {
        // ── Acquire raw streams ────────────────────────────────────────────
        // Screen MUST be acquired first while still in the synchronous call
        // path of the user gesture (getDisplayMedia restriction).
        let rawScreen = null;
        if (flags.screen) {
            rawScreen = await getScreenStream({ audio: false });
            // Auto-stop recording when the user clicks "Stop sharing" in the browser UI
            rawScreen.getVideoTracks().forEach(track => {
                track.addEventListener('ended', () => {
                    if (state.status === 'recording') stopPipeline().catch(() => {});
                });
            });
        }

        // Camera (reuse preview stream if available to avoid re-requesting permissions)
        let rawCamera = null;
        if (flags.camera) {
            if (state.previewStream) {
                rawCamera           = state.previewStream;
                state.previewStream = null;
                state.previewStop   = null;
            } else {
                rawCamera = await getCameraStream({ audio: flags.audio });
            }
        }

        // Standalone audio (screen+audio or audio-only modes)
        let rawAudio = null;
        if (flags.audio && !flags.camera) {
            rawAudio = await getAudioStream();
        }

        // ── Store raw streams for cleanup ──────────────────────────────────
        state.streams = {};
        if (rawCamera) state.streams.camera = rawCamera;
        if (rawScreen) state.streams.screen = rawScreen;
        if (rawAudio)  state.streams.audio  = rawAudio;

        // ── Start independent MediaRecorders ───────────────────────────────

        // Audio tracks shared across all recorder decisions below
        const audioTracks = [
            ...(rawCamera ? rawCamera.getAudioTracks() : []),
            ...(rawAudio  ? rawAudio.getAudioTracks()  : []),
        ];

        // Determine whether a combined (composite) output is possible for this capture.
        // When no viable combined exists (e.g. camera-only, screen-only, audio-only),
        // separate recorders are always started regardless of recordingMode.
        const willHaveCombined =
            (rawCamera && rawScreen) // PiP path
            || (
                ((rawCamera?.getVideoTracks().length ?? 0) + (rawScreen?.getVideoTracks().length ?? 0)) > 0
                && audioTracks.length > 0
            );

        const startSeparate = config.recordingMode !== 'combined' || !willHaveCombined;
        const startCombined = config.recordingMode !== 'separate';

        // Camera: video tracks only (audio travels separately)
        if (rawCamera && rawCamera.getVideoTracks().length > 0 && startSeparate) {
            _startRecorder('camera', new MediaStream(rawCamera.getVideoTracks()));
        }

        // Screen: video tracks only
        if (rawScreen && rawScreen.getVideoTracks().length > 0 && startSeparate) {
            _startRecorder('screen', new MediaStream(rawScreen.getVideoTracks()));
        }

        // Audio
        if (audioTracks.length > 0 && startSeparate) {
            _startRecorder('audio', new MediaStream(audioTracks));
        }

        // ── Non-PiP combined recorder (camera+audio or screen+audio) ─────
        // Gives a single video+audio file for the most common recording modes.
        if (!(rawCamera && rawScreen) && startCombined) {
            const videoTracks = [
                ...(rawCamera ? rawCamera.getVideoTracks() : []),
                ...(rawScreen ? rawScreen.getVideoTracks() : []),
            ];
            if (videoTracks.length > 0 && audioTracks.length > 0) {
                _startRecorder('combined', new MediaStream([...videoTracks, ...audioTracks]));
            }
        }

        // ── PiP composite recorder (camera+screen modes only) ─────────────
        // Records camera overlaid on screen in real time alongside the separate tracks.
        if (rawCamera && rawScreen && startCombined) {
            const pip = await mergeAsPiP(rawScreen, rawCamera, config.pipOptions);
            _pipStop = pip.stop;

            // Add all audio tracks to the composite stream
            const combinedStream = audioTracks.length > 0
                ? new MediaStream([...pip.stream.getVideoTracks(), ...audioTracks])
                : pip.stream;

            _startRecorder('combined', combinedStream);
        }

        // ── Update shared state ───────────────────────────────────────────
        // stream for live preview: prefer screen (most informative)
        state.stream        = rawScreen ?? rawCamera ?? rawAudio ?? null;
        // primary recorder for sg-recording-size wiring (prefer combined for single-track modes)
        state.mediaRecorder = _recorders.screen ?? _recorders.camera ?? _recorders.audio ?? _recorders.combined ?? null;
        state.startedAt     = Date.now();
        state.blobs         = {};
        state.status        = 'recording';

        const videoTrack    = state.stream?.getVideoTracks()[0];
        const trackSettings = videoTrack?.getSettings() ?? {};

        _dispatchOnWindow(SGA_RECORDER.RECORD_START, {
            fps:    trackSettings.frameRate ?? config.fps,
            width:  trackSettings.width     ?? 0,
            height: trackSettings.height    ?? 0,
            format: getBestMimeType(),
            tracks: Object.keys(_recorders),
        });

    } catch (err) {
        // Clean up any streams acquired before the error
        Object.values(state.streams).forEach(s => s?.getTracks().forEach(t => t.stop()));
        state.streams   = {};
        state.status    = 'error';
        state.lastError = err.message;
        _dispatchOnWindow(SGA_RECORDER.ERROR, { step: 'capture', message: err.message });
        throw err;
    }
}

/**
 * Stop all active MediaRecorders and release all streams.
 * Fires tool:record:stop with per-track blob sizes.
 *
 * @returns {Promise<{ durationMs: number, sizeBytes: number }>}
 */
export async function stopPipeline() {
    if (state.status !== 'recording') throw new Error('No active recording');

    try {
        // Stop all recorders in parallel, then tear down the PiP compositor
        const [cameraBlob, screenBlob, audioBlob, combinedBlob] = await Promise.all([
            _stopRecorder('camera'),
            _stopRecorder('screen'),
            _stopRecorder('audio'),
            _stopRecorder('combined'),
        ]);

        // Tear down PiP canvas compositor after recorders have flushed their data
        if (_pipStop) { _pipStop(); _pipStop = null; }

        const durationMs = Date.now() - state.startedAt;

        // Patch WebM duration metadata — MediaRecorder writes Duration=0 in the EBML
        // header; fix it so players and upload platforms (LinkedIn etc.) read correct length.
        const [fixedCamera, fixedScreen, fixedAudio, fixedCombined] = await Promise.all([
            cameraBlob   ? _fixWebMDuration(cameraBlob,   durationMs) : null,
            screenBlob   ? _fixWebMDuration(screenBlob,   durationMs) : null,
            audioBlob    ? _fixWebMDuration(audioBlob,    durationMs) : null,
            combinedBlob ? _fixWebMDuration(combinedBlob, durationMs) : null,
        ]);

        // Collect blobs
        if (fixedCamera)   state.blobs.camera   = fixedCamera;
        if (fixedScreen)   state.blobs.screen   = fixedScreen;
        if (fixedAudio)    state.blobs.audio    = fixedAudio;
        if (fixedCombined) state.blobs.combined = fixedCombined;

        // Primary blob for the video player (combined > screen > camera > audio-only)
        state.blob = fixedCombined ?? fixedScreen ?? fixedCamera ?? fixedAudio ?? null;

        const totalBytes = [fixedCamera, fixedScreen, fixedAudio, fixedCombined]
            .filter(Boolean)
            .reduce((sum, b) => sum + b.size, 0);

        state.durationMs    = durationMs;
        state.sizeBytes     = totalBytes;
        state.status        = 'stopped';
        state.mediaRecorder = null;

        // Release all media tracks
        Object.values(state.streams).forEach(s => s?.getTracks().forEach(t => t.stop()));
        state.streams = {};
        state.stream  = null;

        _dispatchOnWindow(SGA_RECORDER.RECORD_STOP, {
            durationMs,
            sizeBytes: totalBytes,
            tracks: {
                camera:   cameraBlob?.size   ?? null,
                screen:   screenBlob?.size   ?? null,
                audio:    audioBlob?.size    ?? null,
                combined: combinedBlob?.size ?? null,
            },
        });

        return { durationMs, sizeBytes: totalBytes };

    } catch (err) {
        state.status    = 'error';
        state.lastError = err.message;
        _dispatchOnWindow(SGA_RECORDER.ERROR, { step: 'stop', message: err.message });
        throw err;
    }
}

/**
 * Reset state for a new recording. Stops any active preview.
 */
export function resetPipeline() {
    if (state.previewStop) state.previewStop();
    if (_pipStop) { _pipStop(); _pipStop = null; }
    state.reset();
    _dispatchOnWindow(SGA_RECORDER.RESET, {});
}

// ─── Per-track recorder helpers ───────────────────────────────────────────────

function _startRecorder(name, stream) {
    const isAudioOnly = stream.getVideoTracks().length === 0;
    const mimeType    = isAudioOnly
        ? (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm')
        : getBestMimeType();

    const opts = isAudioOnly
        ? { mimeType, audioBitsPerSecond: config.audioBitsPerSecond }
        : { mimeType, videoBitsPerSecond: config.videoBitsPerSecond, audioBitsPerSecond: config.audioBitsPerSecond };

    _chunks[name]    = [];
    _recorders[name] = new MediaRecorder(stream, opts);
    _recorders[name].ondataavailable = (e) => {
        if (e.data.size > 0) {
            _chunks[name].push(e.data);
            const total = Object.values(_chunks)
                .reduce((sum, arr) => sum + arr.reduce((s, b) => s + b.size, 0), 0);
            _dispatchOnWindow(SGA_RECORDER.RECORD_PROGRESS, { totalBytes: total });
        }
    };
    _recorders[name].start(100);
}

function _stopRecorder(name) {
    return new Promise((resolve) => {
        const rec = _recorders[name];
        if (!rec || rec.state === 'inactive') { resolve(null); return; }

        rec.onstop = () => {
            const blob = new Blob(_chunks[name] ?? [], { type: rec.mimeType });
            _chunks[name]    = [];
            delete _recorders[name];
            resolve(blob.size > 0 ? blob : null);
        };
        rec.stop();
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _dispatchOnWindow(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Patch the EBML Duration element (ID 0x4489) in a WebM blob.
 * MediaRecorder writes Duration=0; this replaces it with the real millisecond value
 * so players and upload platforms read the correct length.
 *
 * @param {Blob} blob
 * @param {number} durationMs
 * @returns {Promise<Blob>}
 */
async function _fixWebMDuration(blob, durationMs) {
    // Duration lives in SegmentInfo, always within the first few KB
    const maxScan = Math.min(blob.size, 4096);
    const header  = await blob.slice(0, maxScan).arrayBuffer();
    const arr     = new Uint8Array(header);

    for (let i = 0; i < arr.length - 11; i++) {
        if (arr[i] !== 0x44 || arr[i + 1] !== 0x89) continue;
        const sz = arr[i + 2];

        if (sz === 0x88) {
            // 8-byte float64 — need the full buffer to write into
            const full = await blob.arrayBuffer();
            new DataView(full).setFloat64(i + 3, durationMs, false);
            return new Blob([full], { type: blob.type });
        }
        if (sz === 0x84) {
            // 4-byte float32
            const full = await blob.arrayBuffer();
            new DataView(full).setFloat32(i + 3, durationMs, false);
            return new Blob([full], { type: blob.type });
        }
    }
    return blob; // Duration element not found; return original unchanged
}
