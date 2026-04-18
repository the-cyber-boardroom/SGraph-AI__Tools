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
        this.mode              = 'camera+audio';
        /** @type {'webm'|'mp4'} */
        this.format            = 'webm';
        this.fps               = 30;
        this.videoBitsPerSecond = 2_500_000;
        this.audioBitsPerSecond = 128_000;
        /** @type {{ position?: 'tr'|'tl'|'br'|'bl', scale?: number }} */
        this.pipOptions        = { position: 'br', scale: 0.2 };
    }
}

export class RecordingState {
    constructor() {
        /** @type {RecordingStatus} */
        this.status        = 'idle';
        /** @type {Blob|null} */
        this.blob          = null;
        this.durationMs    = 0;
        this.sizeBytes     = 0;
        this.startedAt     = null;
        /** @type {MediaStream|null} active recording stream */
        this.stream        = null;
        /** @type {Function|null} stops PiP compositor if active */
        this.stopCapture   = null;
        /** @type {MediaRecorder|null} active MediaRecorder instance */
        this.mediaRecorder = null;
        /** @type {MediaStream|null} pre-recording preview stream */
        this.previewStream = null;
        /** @type {Function|null} stops preview stream */
        this.previewStop   = null;
        /** @type {string|null} last error message */
        this.lastError     = null;
    }

    reset() {
        this.status        = 'idle';
        this.blob          = null;
        this.durationMs    = 0;
        this.sizeBytes     = 0;
        this.startedAt     = null;
        this.stream        = null;
        this.stopCapture   = null;
        this.mediaRecorder = null;
        this.previewStream = null;
        this.previewStop   = null;
        this.lastError     = null;
    }
}
