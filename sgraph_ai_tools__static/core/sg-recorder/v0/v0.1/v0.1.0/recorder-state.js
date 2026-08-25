/**
 * recorder-state.js
 * Pure data classes for recording state and configuration.
 * No DOM, no side-effects.
 * @module recorder-state
 */

/**
 * @typedef {'idle'|'requesting-permissions'|'recording'|'paused'|'stopped'|'saving'|'error'} RecordingStatus
 */

export class RecordingConfig {
    constructor() {
        /** @type {'camera'|'audio'|'screen'|'camera+audio'|'screen+audio'|'camera+screen'|'camera+screen+audio'} */
        this.mode               = 'camera+audio';
        /** @type {'webm'|'mp4'} */
        this.format             = 'webm';
        this.fps                = 30;
        this.videoBitsPerSecond = 2_500_000;
        this.audioBitsPerSecond = 128_000;
        /** @type {{ position?: 'tr'|'tl'|'br'|'bl', scale?: number }} */
        this.pipOptions         = { position: 'br', scale: 0.2 };
        /** Controls which MediaRecorders run.
         *  'combined'          — one output file (lowest CPU, best compatibility)
         *  'combined+separate' — combined file plus each track individually
         *  'separate'          — individual tracks only, no composite
         * @type {'combined'|'combined+separate'|'separate'} */
        this.recordingMode      = 'combined';
        /** Name used for download filenames and the recording tab title. */
        this.recordingName      = '';
        /** Visualization mode used when recording mode is 'viz+audio'. */
        this.vizMode            = 'smooth-eq';
        /** Provided by ui-shell — { start(micStream,fps):Promise<MediaStream>, stop():void }
         *  Called by the pipeline when mode is 'viz+audio'. Not serialised. */
        this.vizProvider        = null;
        /** Composite layout for camera+screen modes.
         *  'landscape' — standard PiP (camera overlay on screen, 16:9)
         *  'shorts'    — vertical 9:16 canvas with title, screen, camera, footer
         * @type {'landscape'|'shorts'} */
        this.layout             = 'landscape';
        /** Audio source — mutually exclusive, pick one.
         *  'mic'    — microphone / camera audio (default)
         *  'screen' — audio from the shared tab/screen (getDisplayMedia audio constraint)
         *  'none'   — no audio
         * @type {'mic'|'screen'|'none'} */
        // Design note: mode strings already encode an audio on/off bit (e.g. 'screen+audio'
        // vs 'screen'), and audioSource encodes the same choice differently. The intended
        // invariant is: mode's audio flag === (audioSource !== 'none'). Both fields are kept
        // in sync by _applyModeState() in ui-controls.js; the pipeline reads audioSource for
        // routing and ignores the redundancy rather than trying to derive one from the other.
        this.audioSource        = 'mic';
    }
}

export class RecordingState {
    constructor() {
        /** @type {RecordingStatus} */
        this.status        = 'idle';

        /** Primary blob for video player (screen > camera > audio). @type {Blob|null} */
        this.blob          = null;

        /** Per-track blobs produced by the multi-recorder pipeline.
         *  @type {{ camera?: Blob, screen?: Blob, audio?: Blob }} */
        this.blobs         = {};

        /** Raw acquired MediaStreams keyed by track type, kept for cleanup.
         *  @type {{ camera?: MediaStream, screen?: MediaStream, audio?: MediaStream }} */
        this.streams       = {};

        this.durationMs       = 0;
        this.sizeBytes        = 0;
        this.startedAt        = null;
        /** Total milliseconds spent paused during this recording. @type {number} */
        this.pausedDurationMs = 0;
        /** Timestamp when the current pause began (null when not paused). @type {number|null} */
        this.lastPausedAt     = null;

        /** Stream shown in the live preview panel during recording. @type {MediaStream|null} */
        this.stream        = null;

        /** Primary MediaRecorder (screen > camera > audio) for sg-recording-size.
         *  @type {MediaRecorder|null} */
        this.mediaRecorder = null;

        /** Pre-recording camera preview stream. @type {MediaStream|null} */
        this.previewStream = null;
        /** Stops the preview stream. @type {Function|null} */
        this.previewStop   = null;

        /** @type {string|null} */
        this.lastError     = null;
    }

    reset() {
        this.status        = 'idle';
        this.blob          = null;
        this.blobs         = {};
        this.streams       = {};
        this.durationMs       = 0;
        this.sizeBytes        = 0;
        this.startedAt        = null;
        this.pausedDurationMs = 0;
        this.lastPausedAt     = null;
        this.stream           = null;
        this.mediaRecorder = null;
        this.previewStream = null;
        this.previewStop   = null;
        this.lastError     = null;
    }
}
