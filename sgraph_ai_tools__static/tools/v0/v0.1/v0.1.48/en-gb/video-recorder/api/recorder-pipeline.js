/**
 * recorder-pipeline.js
 * Capture → record orchestration using sg-capture.js and sg-video-recorder.js v0.1.1.
 * @module recorder-pipeline
 */

import { buildStream, getCameraStream, getAudioStream }   from '/core/sg-capture/v0/v0.1/v0.1.0/sg-capture.js';
import { startRecordingStream, stopRecording, getBestMimeType, getRecorder } from '/core/sg-video-recorder/v0/v0.1/v0.1.1/sg-video-recorder.js';
import { RecordingConfig, RecordingState }                 from './recorder-state.js';
import { SGA_RECORDER }                                    from './recorder-events.js';

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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Show a camera/audio preview before recording.
 * For screen-only modes, dispatches PREVIEW_START with no stream.
 * Stores acquired stream in state.previewStream so startPipeline() can reuse it.
 *
 * @returns {Promise<void>}
 */
export async function startPreview() {
    if (state.status === 'recording') throw new Error('Cannot preview while recording');
    if (state.previewStream) return; // already previewing

    const flags = MODE_FLAGS[config.mode] ?? MODE_FLAGS['camera+audio'];

    try {
        let previewStream = null;

        if (flags.camera) {
            // Camera (+ optional audio) preview via getUserMedia
            previewStream = await getCameraStream({ audio: flags.audio });
        } else if (flags.audio && !flags.screen) {
            // Audio-only mode
            previewStream = await getAudioStream();
        }
        // screen-only modes: no preview stream, just dispatch event

        state.previewStream = previewStream;
        state.previewStop   = previewStream
            ? () => previewStream.getTracks().forEach(t => t.stop())
            : null;

        _dispatchOnWindow(SGA_RECORDER.PREVIEW_START, {
            hasVideo: flags.camera,
            mode:     config.mode,
            stream:   previewStream,
        });

    } catch (err) {
        state.lastError = err.message;
        _dispatchOnWindow(SGA_RECORDER.ERROR, { step: 'preview', message: err.message });
        throw err;
    }
}

/**
 * Stop any active preview stream and dispatch PREVIEW_STOP.
 */
export function stopPreview() {
    if (state.previewStop) state.previewStop();
    state.previewStream = null;
    state.previewStop   = null;
    _dispatchOnWindow(SGA_RECORDER.PREVIEW_STOP, {});
}

/**
 * Begin capture and recording for the configured mode.
 * Must be called directly from a user gesture when screen capture is involved.
 * If a preview stream exists and mode doesn't need screen, it is reused.
 * Fires tool:record:start on window when MediaRecorder starts.
 *
 * @returns {Promise<void>}
 */
export async function startPipeline() {
    if (state.status === 'recording') throw new Error('Recording already in progress');

    state.status = 'requesting-permissions';
    _dispatchOnWindow(SGA_RECORDER.MODE_SET, { mode: config.mode });

    const flags = MODE_FLAGS[config.mode] ?? MODE_FLAGS['camera+audio'];

    try {
        let stream, stop;

        if (state.previewStream && !flags.screen) {
            // Reuse the preview stream — permissions already granted, no re-prompt
            stream = state.previewStream;
            stop   = state.previewStop ?? (() => stream.getTracks().forEach(t => t.stop()));
            state.previewStream = null;
            state.previewStop   = null;
        } else {
            // Stop any existing preview before requesting new streams
            if (state.previewStop) state.previewStop();
            state.previewStream = null;
            state.previewStop   = null;

            const result = await buildStream({
                ...flags,
                pipOptions:    config.pipOptions,
                screenOptions: { audio: false },
            });
            stream = result.stream;
            stop   = result.stop;
        }

        state.stream      = stream;
        state.stopCapture = stop;
        state.startedAt   = Date.now();
        state.status      = 'recording';

        const mimeType = getBestMimeType();
        startRecordingStream(stream, {
            mimeType,
            videoBitsPerSecond: config.videoBitsPerSecond,
            audioBitsPerSecond: config.audioBitsPerSecond,
        });

        // Expose recorder so UI components can wire size tracking
        state.mediaRecorder = getRecorder();

        const videoTrack    = stream.getVideoTracks()[0];
        const trackSettings = videoTrack?.getSettings() ?? {};
        _dispatchOnWindow(SGA_RECORDER.RECORD_START, {
            fps:    trackSettings.frameRate ?? config.fps,
            width:  trackSettings.width     ?? 0,
            height: trackSettings.height    ?? 0,
            format: mimeType,
        });

    } catch (err) {
        state.status    = 'error';
        state.lastError = err.message;
        _dispatchOnWindow(SGA_RECORDER.ERROR, { step: 'capture', message: err.message });
        throw err;
    }
}

/**
 * Stop the active recording and release all capture streams.
 * Fires tool:record:stop on window.
 *
 * @returns {Promise<{ durationMs: number, sizeBytes: number }>}
 */
export async function stopPipeline() {
    if (state.status !== 'recording') throw new Error('No active recording');

    try {
        const blob = await stopRecording();

        const durationMs = Date.now() - state.startedAt;
        state.durationMs    = durationMs;
        state.sizeBytes     = blob.size;
        state.blob          = blob;
        state.status        = 'stopped';
        state.mediaRecorder = null;

        // Release all media tracks
        if (state.stopCapture) state.stopCapture();
        if (state.stream) state.stream.getTracks().forEach(t => t.stop());
        state.stream      = null;
        state.stopCapture = null;

        _dispatchOnWindow(SGA_RECORDER.RECORD_STOP, { durationMs, sizeBytes: blob.size });
        return { durationMs, sizeBytes: blob.size };

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
    state.reset();
    _dispatchOnWindow(SGA_RECORDER.RESET, {});
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _dispatchOnWindow(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}
