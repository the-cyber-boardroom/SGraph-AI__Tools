/**
 * recorder-state.js
 * Pure data classes for recording state and configuration.
 * No DOM, no side-effects.
 * @module recorder-state
 */

/**
 * @typedef {'idle'|'requesting-permissions'|'recording'|'stopped'|'saving'|'error'} RecordingStatus
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
        this.vizMode            = 'mirror-eq';
        /** Provided by ui-shell — { start(micStream,fps):Promise<MediaStream>, stop():void }
         *  Called by the pipeline when mode is 'viz+audio'. Not serialised. */
        this.vizProvider        = null;
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

        this.durationMs    = 0;
        this.sizeBytes     = 0;
        this.startedAt     = null;

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
        this.durationMs    = 0;
        this.sizeBytes     = 0;
        this.startedAt     = null;
        this.stream        = null;
        this.mediaRecorder = null;
        this.previewStream = null;
        this.previewStop   = null;
        this.lastError     = null;
    }
}
