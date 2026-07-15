/**
 * recorder-pipeline.js
 * Multi-stream capture + independent recording pipeline.
 *
 * Camera, screen, and audio are each recorded by their own MediaRecorder so every
 * track is available as a separate blob after stop. No PiP compositing happens at
 * record time — compositing is a post-processing concern.
 *
 * Resilience design:
 *   - All per-recording state lives in a RecordingSession instance, never module globals.
 *     No state leaks between recordings regardless of how the previous one ended.
 *   - stopAll() uses Promise.allSettled — a hung recorder times out without blocking others.
 *   - Every MediaRecorder.onerror is wired and dispatches tool:error.
 *   - disposeAll() is a guaranteed-safe teardown callable from any code path (catch blocks,
 *     reset, early error before all streams were acquired).
 *
 * @module recorder-pipeline
 */

import { getCameraStream, getAudioStream, getScreenStream, mergeAsPiP } from '/core/sg-capture/v0/v0.1/v0.1.1/sg-capture.js';
import { mergeAsShorts }                                                 from './merge-vertical.js';
import { mergeAsInfographic }                                            from './merge-infographic.js';
import { warmUpCameraStream }                                            from './camera-warmup.js';
import { getBestMimeType }                                   from '/core/sg-video-recorder/v0/v0.1/v0.1.2/sg-video-recorder.js';
import { RecordingConfig, RecordingState }                   from './recorder-state.js';
import { SGA_RECORDER }                                      from './recorder-events.js';

/** @type {RecordingConfig} */
export const config = new RecordingConfig();

/** @type {RecordingState} */
export const state  = new RecordingState();

// ─── Mode → source flags ──────────────────────────────────────────────────────

const MODE_FLAGS = {
    'audio':               { camera: false, audio: true,  screen: false, viz: false },
    'camera':              { camera: true,  audio: false, screen: false, viz: false },
    'screen':              { camera: false, audio: false, screen: true,  viz: false },
    'camera+audio':        { camera: true,  audio: true,  screen: false, viz: false },
    'screen+audio':        { camera: false, audio: true,  screen: true,  viz: false },
    'camera+screen':       { camera: true,  audio: false, screen: true,  viz: false },
    'camera+screen+audio': { camera: true,  audio: true,  screen: true,  viz: false },
    'viz+audio':           { camera: false, audio: true,  screen: false, viz: true  },
    'screen+viz+audio':    { camera: false, audio: true,  screen: true,  viz: true  },
};

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout.
 * @template T
 * @param {Promise<T>} promise
 * @param {number}     ms
 * @param {string}     label   Included in the rejection message.
 * @returns {Promise<T>}
 */
function _withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        ),
    ]);
}

/**
 * Choose the video mime type for a recorder.
 *
 * Fixed-size sources (canvas composites, camera) keep getBestMimeType() as-is —
 * on Chrome/Safari that is MP4/avc1, which QuickTime plays. Do NOT "upgrade" these
 * to avc3: Chrome accepts it, but QuickTime has no avc3 support, so downloads were
 * reported as "media isn't compatible with QuickTime Player" (Chrome-recorded files
 * only — Safari rejects the avc3 variant and stayed on avc1, masking the bug).
 *
 * Resize-prone sources (screen capture — the user can resize the shared window
 * mid-recording) can't use avc1: its codec params live in the container header and a
 * resolution change kills the encoder. For those, prefer WebM (handles resolution
 * changes natively AND plays back in the recording browser), then avc3 (in-band
 * SPS/PPS — survives resizes; plays in Chrome/VLC but not QuickTime), then best.
 *
 * Exported for tests.
 * @param {{ resizable?: boolean }} [opts]
 * @returns {string}
 */
export function pickVideoMimeType({ resizable = false } = {}) {
    const best = getBestMimeType();
    if (!resizable) return best;

    if (best.includes('avc1')) {
        for (const m of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']) {
            if (MediaRecorder.isTypeSupported(m)) return m;
        }
        // Replace avc1[.profile] with avc3[.profile] — same codec, different parameter delivery
        const avc3 = best.replace(/avc1(\.[a-fA-F0-9]+)?/, 'avc3$1');
        if (MediaRecorder.isTypeSupported(avc3)) return avc3;
    }
    return best;
}

// ─── RecordingSession ─────────────────────────────────────────────────────────
//
// Encapsulates all mutable state for a single recording run so nothing leaks
// between recordings. A new instance is created on every startPipeline() call.

class RecordingSession {
    constructor() {
        /** @type {Map<string, MediaRecorder>} */
        this._recorders = new Map();
        /** @type {Map<string, Blob[]>} */
        this._chunks    = new Map();
        /** @type {Function|null} Stops the PiP canvas compositor. */
        this._pipStop   = null;
        /** @type {MediaStream|null} Cloned mic stream given to vizProvider. */
        this._vizAudioClone = null;
    }

    /**
     * Create and start a named MediaRecorder for the given stream.
     * @param {string}      name
     * @param {MediaStream} stream
     * @param {{ resizable?: boolean }} [opts]  resizable — the stream carries a raw
     *   screen track whose resolution can change mid-recording (window resize).
     */
    startRecorder(name, stream, { resizable = false } = {}) {
        const isAudioOnly = stream.getVideoTracks().length === 0;
        const mimeType    = isAudioOnly
            ? (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm')
            : pickVideoMimeType({ resizable });
        const opts = isAudioOnly
            ? { mimeType, audioBitsPerSecond: config.audioBitsPerSecond }
            : { mimeType, videoBitsPerSecond: config.videoBitsPerSecond, audioBitsPerSecond: config.audioBitsPerSecond };

        this._chunks.set(name, []);
        const rec = new MediaRecorder(stream, opts);

        rec.ondataavailable = (e) => {
            if (e.data.size > 0) {
                this._chunks.get(name).push(e.data);
                let total = 0;
                for (const arr of this._chunks.values()) {
                    total += arr.reduce((s, b) => s + b.size, 0);
                }
                _dispatchOnWindow(SGA_RECORDER.RECORD_PROGRESS, { totalBytes: total });
            }
        };

        // Wire onerror: MediaRecorder errors are always fatal (encoder won't recover).
        // Dispatch tool:error for UI, then auto-stop so the recording doesn't ghost
        // with 0 KB data while the timer keeps running.
        rec.onerror = (e) => {
            const msg = e.error?.message ?? 'Unknown MediaRecorder error';
            console.error(`[recorder:${name}]`, msg, e.error);
            _dispatchOnWindow(SGA_RECORDER.ERROR, { step: `recorder:${name}`, message: msg });
            // Guard: _session is nulled at the top of stopPipeline before it awaits,
            // so a second concurrent call here would crash on null.stopAll(). Skip if
            // stopPipeline is already in flight.
            if (state.status === 'recording' && _session) {
                console.warn(`[pipeline] recorder:${name} fatal error — auto-stopping pipeline`);
                stopPipeline().catch(err =>
                    console.error('[pipeline] auto-stop after recorder error failed:', err)
                );
            }
        };

        this._recorders.set(name, rec);
        rec.start(100);
    }

    /**
     * Stop a named recorder and return its assembled Blob.
     * Resolves null if the recorder never started or produced no data.
     * Rejects (via timeout) if onstop does not fire within timeoutMs.
     * @param {string} name
     * @param {number} [timeoutMs=10000]
     * @returns {Promise<Blob|null>}
     */
    stopRecorder(name, timeoutMs = 10_000) {
        return new Promise((resolve, reject) => {
            const rec = this._recorders.get(name);
            if (!rec || rec.state === 'inactive') { resolve(null); return; }

            const timer = setTimeout(() => {
                this._chunks.delete(name);
                this._recorders.delete(name);
                reject(new Error(`[recorder:${name}] stop() timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            rec.addEventListener('stop', () => {
                clearTimeout(timer);
                const chunks = this._chunks.get(name) ?? [];
                const blob   = new Blob(chunks, { type: rec.mimeType });
                this._chunks.delete(name);
                this._recorders.delete(name);
                resolve(blob.size > 0 ? blob : null);
            }, { once: true });

            try {
                rec.stop();
            } catch (err) {
                clearTimeout(timer);
                this._chunks.delete(name);
                this._recorders.delete(name);
                reject(err);
            }
        });
    }

    /**
     * Stop all four named recorders in parallel.
     * Promise.allSettled means a timed-out recorder never blocks the others.
     * @returns {Promise<{ camera: Blob|null, screen: Blob|null, audio: Blob|null, combined: Blob|null }>}
     */
    async stopAll() {
        const NAMES   = ['camera', 'screen', 'audio', 'combined'];
        const results = await Promise.allSettled(NAMES.map(n => this.stopRecorder(n)));
        const blobs   = {};
        results.forEach((r, i) => {
            blobs[NAMES[i]] = r.status === 'fulfilled' ? r.value : null;
            if (r.status === 'rejected') {
                console.warn(`[pipeline] ${r.reason?.message}`);
            }
        });
        return blobs;
    }

    /**
     * Force-stop all resources without waiting for chunk flush.
     * Safe to call from any code path including catch blocks.
     * No-op for already-stopped or never-started recorders.
     */
    disposeAll() {
        for (const [, rec] of this._recorders) {
            if (rec.state !== 'inactive') {
                try { rec.stop(); } catch (_) {}
            }
        }
        this._recorders.clear();
        this._chunks.clear();
        if (this._pipStop) {
            try { this._pipStop(); } catch (_) {}
            this._pipStop = null;
        }
        if (this._vizAudioClone) {
            this._vizAudioClone.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
            this._vizAudioClone = null;
        }
    }

    /** Names of all currently active (started) recorders. */
    get recorderNames() {
        return [...this._recorders.keys()];
    }
}

// ─── Active session ───────────────────────────────────────────────────────────

/** @type {RecordingSession|null} Current recording session; null when idle. */
let _session = null;

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
        const stream = await getCameraStream({ audio: flags.audio && config.audioSource === 'mic' });
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

    // Dispose any stale session left by a previous error path
    if (_session) { _session.disposeAll(); _session = null; }

    state.status = 'requesting-permissions';
    const flags   = MODE_FLAGS[config.mode] ?? MODE_FLAGS['camera+audio'];
    const session = new RecordingSession();

    try {
        // ── Acquire raw streams ────────────────────────────────────────────
        // Screen MUST be acquired first while still in the synchronous call
        // path of the user gesture (getDisplayMedia restriction).
        let rawScreen = null;
        if (flags.screen) {
            rawScreen = await getScreenStream({ audio: config.audioSource === 'screen' });
            _watchTracks('screen', rawScreen);
        }

        // Camera (reuse preview stream if available to avoid re-requesting permissions)
        let rawCamera   = null;
        let needsWarmUp = false;
        if (flags.camera) {
            if (state.previewStream) {
                rawCamera           = state.previewStream;
                state.previewStream = null;
                state.previewStop   = null;
            } else {
                rawCamera   = await getCameraStream({ audio: flags.audio && config.audioSource === 'mic' });
                needsWarmUp = true; // fresh sensor — allow auto-exposure to settle
            }
            _watchTracks('camera', rawCamera);
        }

        // Standalone audio (screen+audio, audio-only, and viz+audio modes)
        // Only when mic is the selected source — screen audio is carried by rawScreen instead.
        let rawAudio = null;
        if (flags.audio && !flags.camera && config.audioSource === 'mic') {
            rawAudio = await getAudioStream();
        }

        // Camera warm-up: without a prior preview the sensor needs ~0.5–1 s to
        // settle auto-exposure/AGC; otherwise the first recorded frames are
        // black/very dark — and frame 0 is the poster frame players show, so the
        // whole recording *looks* broken. A fixed 300 ms wait proved too short on
        // real hardware; warmUpCameraStream watches mean frame luma until exposure
        // stabilises (floor 450 ms, hard cap 1.6 s so record start never hangs).
        // Runs BEFORE the compositors are built and any MediaRecorder starts, so
        // every layout (Landscape PiP, Shorts, Infographic) and the raw camera
        // recorders all begin with a settled first frame. state.startedAt is set
        // after this gate — the elapsed timer excludes warm-up time.
        if (needsWarmUp) await warmUpCameraStream(rawCamera);

        // ── Viz canvas stream ──────────────────────────────────────────────
        // Clone rawAudio before handing it to the AudioContext: createMediaStreamSource()
        // on a background tab's suspended AudioContext can block the original tracks from
        // delivering audio to MediaRecorder. The clone is independent; the original is
        // used exclusively by MediaRecorder.
        let rawViz = null;
        if (flags.viz && config.vizProvider) {
            // When audioSource='screen', mic rawAudio is null — use the screen stream's
            // audio tracks instead. A new MediaStream wrapper is needed because clone()
            // on a non-cloneable screen track throws in some browsers.
            const vizAudioStream = config.audioSource === 'screen'
                ? (rawScreen ? new MediaStream(rawScreen.getAudioTracks()) : null)
                : rawAudio;
            if (!vizAudioStream || vizAudioStream.getAudioTracks().length === 0) {
                throw new Error('Viz modes require an audio source — mode configuration error');
            }
            session._vizAudioClone = vizAudioStream.clone();
            rawViz = await config.vizProvider.start(session._vizAudioClone, config.fps);
        }

        // ── Store raw streams for cleanup ──────────────────────────────────
        state.streams = {};
        if (rawCamera) state.streams.camera = rawCamera;
        if (rawScreen) state.streams.screen = rawScreen;
        if (rawAudio)  state.streams.audio  = rawAudio;

        // ── Start independent MediaRecorders ───────────────────────────────

        // Audio tracks shared across all recorder decisions below.
        // Screen-source audio comes from the screen stream; mic-source comes from camera/standalone.
        const audioTracks = config.audioSource === 'screen'
            ? (rawScreen ? rawScreen.getAudioTracks() : [])
            : [
                ...(rawCamera ? rawCamera.getAudioTracks() : []),
                ...(rawAudio  ? rawAudio.getAudioTracks()  : []),
              ];

        // Whether a combined (composite) output is viable for this mode
        const willHaveCombined =
            (rawCamera && rawScreen)
            || (
                ((rawCamera?.getVideoTracks().length ?? 0) + (rawScreen?.getVideoTracks().length ?? 0)) > 0
                && audioTracks.length > 0
            );

        const startSeparate = config.recordingMode !== 'combined' || !willHaveCombined;
        const startCombined = config.recordingMode !== 'separate';

        // ── Viz recorder — fullscreen or PiP over screen ──────────────────
        // A single combined recorder. All other recorder branches are skipped.
        if (rawViz) {
            if (rawScreen) {
                const pip = await mergeAsPiP(rawScreen, rawViz, config.pipOptions);
                session._pipStop = pip.stop;
                const stream = audioTracks.length > 0
                    ? new MediaStream([...pip.stream.getVideoTracks(), ...audioTracks])
                    : pip.stream;
                session.startRecorder('combined', stream);
            } else {
                session.startRecorder('combined', new MediaStream([
                    ...rawViz.getVideoTracks(),
                    ...rawAudio.getAudioTracks(),
                ]));
            }
        }

        // ── Camera: video tracks only (audio travels separately) ──────────
        if (!rawViz && rawCamera && rawCamera.getVideoTracks().length > 0 && startSeparate) {
            session.startRecorder('camera', new MediaStream(rawCamera.getVideoTracks()));
        }

        // ── Screen: video tracks only ─────────────────────────────────────
        // resizable — the shared window can change resolution mid-recording.
        if (!rawViz && rawScreen && rawScreen.getVideoTracks().length > 0 && startSeparate) {
            session.startRecorder('screen', new MediaStream(rawScreen.getVideoTracks()), { resizable: true });
        }

        // ── Audio ─────────────────────────────────────────────────────────
        if (!rawViz && audioTracks.length > 0 && startSeparate) {
            session.startRecorder('audio', new MediaStream(audioTracks));
        }

        // ── Non-PiP combined (camera+audio or screen+audio) ───────────────
        if (!rawViz && !(rawCamera && rawScreen) && startCombined) {
            const videoTracks = [
                ...(rawCamera ? rawCamera.getVideoTracks() : []),
                ...(rawScreen ? rawScreen.getVideoTracks() : []),
            ];
            if (videoTracks.length > 0 && audioTracks.length > 0) {
                // Carries the RAW screen track in screen+audio mode → resize-prone.
                session.startRecorder('combined', new MediaStream([...videoTracks, ...audioTracks]),
                                      { resizable: !!rawScreen });
            }
        }

        // ── PiP / Shorts / Infographic composite recorder (camera+screen modes only) ──
        if (!rawViz && rawCamera && rawScreen && startCombined) {
            // Live elapsed source so burned-in footer clocks exclude paused time.
            const getElapsedMs = () => {
                if (!state.startedAt) return 0;
                let paused = state.pausedDurationMs;
                if (state.status === 'paused' && state.lastPausedAt) {
                    paused += Date.now() - state.lastPausedAt;
                }
                return Date.now() - state.startedAt - paused;
            };
            const vOpts = { fps: config.fps, title: config.recordingName, startedAt: Date.now(), getElapsedMs };

            let composite;
            if (config.layout === 'shorts') {
                composite = await mergeAsShorts(rawScreen, rawCamera, vOpts);
            } else if (config.layout === 'infographic') {
                composite = await mergeAsInfographic(rawScreen, rawCamera, vOpts);
            } else {
                composite = await mergeAsPiP(rawScreen, rawCamera, config.pipOptions);
            }
            session._pipStop = composite.stop;
            // Use canvas video + raw audio tracks (raw quality > canvas-mixed audio)
            const combinedStream = audioTracks.length > 0
                ? new MediaStream([...composite.stream.getVideoTracks(), ...audioTracks])
                : composite.stream;
            session.startRecorder('combined', combinedStream);
        }

        // ── Commit session ─────────────────────────────────────────────────
        _session        = session;
        state.stream    = rawScreen ?? rawCamera ?? rawAudio ?? null;
        state.startedAt = Date.now();
        state.blobs     = {};
        state.status    = 'recording';

        const videoTrack    = state.stream?.getVideoTracks()[0];
        const trackSettings = videoTrack?.getSettings() ?? {};

        _dispatchOnWindow(SGA_RECORDER.RECORD_START, {
            fps:         trackSettings.frameRate ?? config.fps,
            width:       trackSettings.width     ?? 0,
            height:      trackSettings.height    ?? 0,
            format:      getBestMimeType(),
            tracks:      session.recorderNames,
            audioSource: config.audioSource,
        });

    } catch (err) {
        // disposeAll() kills any MediaRecorders started before the error
        session.disposeAll();
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
 * Each recorder has a 10 s timeout; a hung recorder does not block the others.
 * Fires tool:record:stop with per-track blob sizes.
 *
 * @returns {Promise<{ durationMs: number, sizeBytes: number }>}
 */
export async function stopPipeline() {
    if (state.status !== 'recording' && state.status !== 'paused') throw new Error('No active recording');

    const session = _session;
    _session = null;

    try {
        // Stop all recorders in parallel; each times out independently after 10 s
        const { camera: cameraBlob, screen: screenBlob, audio: audioBlob, combined: combinedBlob } =
            await session.stopAll();

        // Tear down PiP canvas compositor after recorders have flushed their data
        if (session._pipStop) { session._pipStop(); session._pipStop = null; }

        // Exclude time spent paused from the recorded duration
        let totalPausedMs = state.pausedDurationMs;
        if (state.status === 'paused' && state.lastPausedAt) {
            totalPausedMs += Date.now() - state.lastPausedAt;
        }
        const durationMs = Date.now() - state.startedAt - totalPausedMs;

        // Patch WebM duration metadata — MediaRecorder writes Duration=0 in the EBML
        // header; fix it so players and upload platforms read the correct length.
        const [fixedCamera, fixedScreen, fixedAudio, fixedCombined] = await Promise.all([
            cameraBlob   ? _fixWebMDuration(cameraBlob,   durationMs) : null,
            screenBlob   ? _fixWebMDuration(screenBlob,   durationMs) : null,
            audioBlob    ? _fixWebMDuration(audioBlob,    durationMs) : null,
            combinedBlob ? _fixWebMDuration(combinedBlob, durationMs) : null,
        ]);

        if (fixedCamera)   state.blobs.camera   = fixedCamera;
        if (fixedScreen)   state.blobs.screen   = fixedScreen;
        if (fixedAudio)    state.blobs.audio    = fixedAudio;
        if (fixedCombined) state.blobs.combined = fixedCombined;

        state.blob = fixedCombined ?? fixedScreen ?? fixedCamera ?? fixedAudio ?? null;

        const totalBytes = [fixedCamera, fixedScreen, fixedAudio, fixedCombined]
            .filter(Boolean)
            .reduce((sum, b) => sum + b.size, 0);

        state.durationMs    = durationMs;
        state.sizeBytes     = totalBytes;
        state.status        = 'stopped';
        state.mediaRecorder = null;

        Object.values(state.streams).forEach(s => s?.getTracks().forEach(t => t.stop()));
        state.streams = {};
        state.stream  = null;

        config.vizProvider?.stop();
        session.disposeAll(); // no-op if already clean; catches any edge cases

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
        session.disposeAll(); // force-release everything even after partial failure
        state.status    = 'error';
        state.lastError = err.message;
        _dispatchOnWindow(SGA_RECORDER.ERROR, { step: 'stop', message: err.message });
        throw err;
    }
}

/**
 * Pause all active MediaRecorders without ending the recording.
 * The elapsed timer in the UI should be paused separately via the RECORD_PAUSE event.
 * Fires tool:record:pause.
 */
export function pausePipeline() {
    if (state.status !== 'recording') throw new Error('Cannot pause — not recording');
    for (const [, rec] of _session._recorders) {
        if (rec.state === 'recording') rec.pause();
    }
    state.lastPausedAt = Date.now();
    state.status = 'paused';
    _dispatchOnWindow(SGA_RECORDER.RECORD_PAUSE, {});
}

/**
 * Resume all paused MediaRecorders and accumulate the paused interval.
 * Fires tool:record:resume.
 */
export function resumePipeline() {
    if (state.status !== 'paused') throw new Error('Cannot resume — not paused');
    for (const [, rec] of _session._recorders) {
        if (rec.state === 'paused') rec.resume();
    }
    state.pausedDurationMs += Date.now() - state.lastPausedAt;
    state.lastPausedAt = null;
    state.status = 'recording';
    _dispatchOnWindow(SGA_RECORDER.RECORD_RESUME, {});
}

/**
 * Reset state for a new recording. Stops any active preview or stale session.
 */
export function resetPipeline() {
    if (_session) { _session.disposeAll(); _session = null; }
    if (state.previewStop) state.previewStop();
    config.vizProvider?.stop();
    state.reset();
    _dispatchOnWindow(SGA_RECORDER.RESET, {});
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Watch all tracks on a stream for unexpected loss during recording.
 * Video track loss → dispatch TRACK_LOST + auto-stop the pipeline immediately.
 * Audio track loss → dispatch TRACK_LOST only (recording can continue without audio).
 * @param {string}      sourceName  'camera' | 'screen'
 * @param {MediaStream} stream
 */
function _watchTracks(sourceName, stream) {
    stream.getTracks().forEach(track => {
        track.addEventListener('ended', () => {
            if (state.status !== 'recording' && state.status !== 'paused') return;

            _dispatchOnWindow(SGA_RECORDER.TRACK_LOST, {
                source: sourceName,
                kind:   track.kind,   // 'video' | 'audio'
            });

            if (track.kind === 'video') {
                console.warn(`[pipeline] ${sourceName} video track ended unexpectedly — stopping`);
                // Guard against re-entry: _session is nulled before stopPipeline awaits,
                // so a concurrent call from onerror or another track would crash on null.stopAll().
                if (_session) {
                    stopPipeline().catch(err =>
                        console.error('[pipeline] auto-stop after track loss failed:', err)
                    );
                }
            } else {
                console.warn(`[pipeline] ${sourceName} audio track ended unexpectedly`);
            }
        });
    });
}

function _dispatchOnWindow(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Patch the EBML Duration element (ID 0x4489) in a WebM blob.
 * MediaRecorder writes Duration=0; this replaces it with the real value
 * scaled correctly using the file's own TimecodeScale (default 1ms/unit).
 * No-op for MP4 blobs (different container) and blobs without Duration element.
 *
 * @param {Blob}   blob
 * @param {number} durationMs
 * @returns {Promise<Blob>}
 */
async function _fixWebMDuration(blob, durationMs) {
    if (!blob.type.includes('webm')) return blob;

    const scanSize = Math.min(blob.size, 65536);
    const header   = await blob.slice(0, scanSize).arrayBuffer();
    const arr      = new Uint8Array(header);

    function readVint(pos) {
        if (pos >= arr.length) return null;
        const b = arr[pos];
        if (b & 0x80) return { value: b & 0x7F,                                                                          bytes: 1 };
        if (b & 0x40) return { value: ((b & 0x3F) << 8)  | arr[pos + 1],                                                 bytes: 2 };
        if (b & 0x20) return { value: ((b & 0x1F) << 16) | (arr[pos + 1] << 8) | arr[pos + 2],                           bytes: 3 };
        if (b & 0x10) return { value: ((b & 0x0F) << 24) | (arr[pos + 1] << 16) | (arr[pos + 2] << 8) | arr[pos + 3],   bytes: 4 };
        return null;
    }

    let timecodeScale   = 1_000_000;
    let durationOffset  = -1;
    let durationFloat32 = false;

    for (let i = 0; i < arr.length - 12; i++) {
        if (arr[i] === 0x2A && arr[i + 1] === 0xD7 && arr[i + 2] === 0xB1) {
            const sz = readVint(i + 3);
            if (sz && sz.value >= 1 && sz.value <= 8) {
                const d = i + 3 + sz.bytes;
                let v = 0;
                for (let b = 0; b < sz.value; b++) v = v * 256 + arr[d + b];
                if (v > 0) timecodeScale = v;
            }
        }
        if (arr[i] === 0x44 && arr[i + 1] === 0x89) {
            const sz = readVint(i + 2);
            if (sz && (sz.value === 8 || sz.value === 4)) {
                durationOffset  = i + 2 + sz.bytes;
                durationFloat32 = sz.value === 4;
                break;
            }
        }
    }

    if (durationOffset < 0) return blob;

    const durationUnits = (durationMs * 1_000_000) / timecodeScale;
    const full = await blob.arrayBuffer();
    const dv   = new DataView(full);
    if (durationFloat32) dv.setFloat32(durationOffset, durationUnits, false);
    else                 dv.setFloat64(durationOffset, durationUnits, false);
    return new Blob([full], { type: blob.type });
}
