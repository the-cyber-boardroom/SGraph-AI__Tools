/**
 * publisher-state.js
 * Mutable job state for the video-publisher: one PublishJob per loaded
 * video. The transcription item/version store lives in transcribe-store.js.
 * No DOM, no side-effects.
 * @module publisher-state
 */

import { itemStore } from './transcribe-store.js';

/**
 * Job step statuses: 'idle' | 'running' | 'done' | 'error'.
 * Job flow: idle → recording → loaded → (audio → transcript → metadata auto-run)
 *           → ready-to-publish → uploading → published.
 */
export const state = {
    /** 'idle'|'recording'|'loaded'|'ready-to-publish'|'uploading'|'published' */
    phase:      'idle',
    autoRun:    true,
    /** Set by cancelRun(); checked between (and inside) workflow stages. */
    cancelRequested: false,

    /** Loaded video. */
    videoBlob:  null,
    /** Separate audio stream from the recorder (route 1), when present. */
    audioBlob:  null,
    filename:   null,
    source:     null,            // 'record' | 'import' | 'handoff'

    /** Audio routing result: { blob, route: 'native'|'remux'|'decode', mime }. */
    audio:      null,

    /** Per-step status + info: { status, error?, code?, info? }. */
    steps: {
        audio:      { status: 'idle' },
        transcript: { status: 'idle' },
        metadata:   { status: 'idle' },
        publish:    { status: 'idle' },
    },

    transcript:  null,           // last successful transcript text
    metadata:    { title: '', description: '', tags: [], privacy: 'unlisted' },

    /** YouTube session (mirrors youtube-editor state shape). */
    youtube: {
        connected: false, accessToken: null, expiresAt: null, channel: null,
        uploadStatus: 'idle', uploadProgress: 0, lastUploadId: null, lastUrl: null,
    },

    lastError:   null,
};

export function resetJob() {
    state.phase      = 'idle';
    state.cancelRequested = false;
    state.videoBlob  = null;
    state.audioBlob  = null;
    state.filename   = null;
    state.source     = null;
    state.audio      = null;
    state.transcript = null;
    state.metadata   = { title: '', description: '', tags: [], privacy: 'unlisted' };
    state.lastError  = null;
    for (const k of Object.keys(state.steps)) state.steps[k] = { status: 'idle' };
    state.youtube.uploadStatus   = 'idle';
    state.youtube.uploadProgress = 0;
    state.youtube.lastUploadId   = null;
    state.youtube.lastUrl        = null;
    itemStore.clear();
}
