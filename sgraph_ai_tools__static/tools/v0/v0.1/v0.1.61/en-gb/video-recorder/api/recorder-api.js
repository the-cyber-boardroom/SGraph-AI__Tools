/**
 * recorder-api.js
 * Entry point — registers SgToolApi, calls activate() before UI init.
 * All window.__tool methods are live as soon as tool:ready fires.
 *
 * JS-API-first rule: activate() must be called before any UI init.
 *
 * @module recorder-api
 */

import { SgToolApi }                                             from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { config, state, startPipeline, stopPipeline, pausePipeline, resumePipeline,
         startPreview, stopPreview, resetPipeline }              from './recorder-pipeline.js';
import { RecordingConfig }                                       from './recorder-state.js';
import { SGA_RECORDER }                                          from './recorder-events.js';
import { saveSendFile }                                          from './save-sg-send.js';
import { saveFolder }                                            from './save-folder.js';
import { isCameraSupported, isScreenSupported }                  from '/core/sg-capture/v0/v0.1/v0.1.1/sg-capture.js';
import { init as initShell }                                     from '../ui/ui-shell.js';

// ─── API instance ─────────────────────────────────────────────────────────────

const api = new SgToolApi({
    name:     'video-recorder',
    version:  { api: '0.1.0', ui: '0.1.61', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './skills/SKILL-human.md',
        browser: './skills/SKILL-browser.md',
        api:     './skills/SKILL-api.md',
    },
});

function emit(eventName, detail = {}) {
    api._emit(eventName, detail);
}

// ─── Method implementations ───────────────────────────────────────────────────

async function connect() {
    return { ok: true };
}

/**
 * Set the recording mode (one of 9 combinations — full UI parity, incl. the two viz modes).
 * Viz modes require an audio source; if audioSource is 'none' it is bumped to 'mic'
 * so a headless caller (no UI) still records something.
 * @param {{ mode: string }} params
 * @returns {{ mode: string, supported: boolean }}
 */
function setMode({ mode }) {
    const VALID_MODES = [
        'audio', 'camera', 'screen',
        'camera+audio', 'screen+audio', 'camera+screen', 'camera+screen+audio',
        'viz+audio', 'screen+viz+audio',
    ];
    if (!VALID_MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);

    const needsScreen = mode.includes('screen');
    const needsCamera = mode.includes('camera');
    const supported   = (!needsScreen || isScreenSupported()) && (!needsCamera || isCameraSupported());

    config.mode = mode;
    // Viz and every '+audio' mode need an audio source; don't leave it at 'none'.
    if ((mode.includes('viz') || mode.includes('audio')) && config.audioSource === 'none') {
        config.audioSource = 'mic';
    }
    emit(SGA_RECORDER.MODE_SET, { mode });
    return { mode, supported };
}

/**
 * Show a camera preview before recording. Requests permissions early.
 * @returns {Promise<{}>}
 */
async function startPreviewApi() {
    await startPreview();
    return {};
}

/**
 * Stop any active camera preview.
 * @returns {{}}
 */
function stopPreviewApi() {
    stopPreview();
    return {};
}

/**
 * Begin recording. Must be called directly from a user gesture if screen mode is active.
 * @param {{ format?: 'webm'|'mp4' }} [params]
 * @returns {Promise<{}>}
 */
async function startRecording({ format } = {}) {
    if (format) config.format = format;
    await startPipeline();
    return {};
}

/**
 * Stop recording and release all media streams.
 * @returns {Promise<{ durationMs: number, sizeBytes: number }>}
 */
async function stopRecording() {
    return stopPipeline();
}

/**
 * Pause an active recording. Timer stops; chunks stop arriving until resumed.
 * @returns {{}}
 */
function pauseRecording() {
    pausePipeline();
    return {};
}

/**
 * Resume a paused recording.
 * @returns {{}}
 */
function resumeRecording() {
    resumePipeline();
    return {};
}

/**
 * Reset to idle so a new recording can be started.
 * @returns {{}}
 */
function newRecording() {
    resetPipeline();
    return {};
}

/**
 * Encrypt and upload the recording to SG/Send.
 * Reads access token from localStorage 'sgraph-send-token' or params.accessToken.
 * @param {{ filename?: string, accessToken?: string }} [params]
 * @returns {Promise<{ token: string, shareUrl: string }>}
 */
async function saveSendFileApi({ filename, accessToken } = {}) {
    if (!state.blob) throw new Error('No recording available — call stopRecording() first');
    const token = accessToken ?? localStorage.getItem('sgraph-send-token');
    state.status = 'saving';
    try {
        const result = await saveSendFile(state.blob, { filename, accessToken: token });
        state.status = 'stopped';
        return result;
    } catch (err) {
        state.status = 'error';
        throw err;
    }
}

/**
 * Save recording as a local folder (video + thumbnail + metadata).
 * @param {{ folderName?: string, screenshots?: boolean }} [params]
 * @returns {Promise<{ folderId: string }>}
 */
async function saveFolderApi({ folderName, screenshots } = {}) {
    if (!state.blob) throw new Error('No recording available — call stopRecording() first');
    state.status = 'saving';
    try {
        const result = await saveFolder(state.blob, { folderName, screenshots, durationMs: state.durationMs, mode: config.mode });
        state.status = 'stopped';
        return result;
    } catch (err) {
        state.status = 'error';
        throw err;
    }
}

/**
 * Return a status snapshot.
 * @returns {{ status: string, mode: string, durationMs: number, sizeBytes: number, hasBlob: boolean, lastError: string|null }}
 */
function getStatus() {
    return {
        status:     state.status,
        mode:       config.mode,
        durationMs: state.durationMs,
        sizeBytes:  state.sizeBytes,
        hasBlob:    state.blob !== null,
        lastError:  state.lastError,
    };
}

/** @returns {RecordingConfig} */
function getConfig() {
    return { ...config };
}

/** @param {Partial<RecordingConfig>} params */
function setConfig(params) {
    Object.assign(config, params);
}

/**
 * Set the recording name — used as download filename and tab title.
 * @param {{ name: string }} params
 * @returns {{ name: string }}
 */
function setRecordingName({ name }) {
    config.recordingName = String(name ?? '').trim();
    return { name: config.recordingName };
}

// ─── Registration + activation ────────────────────────────────────────────────

api
    .register('connect',        connect,          { async: true })
    .register('setMode',        setMode,          { async: false, events: [SGA_RECORDER.MODE_SET] })
    .register('startPreview',   startPreviewApi,  { async: true,  events: [SGA_RECORDER.PREVIEW_START] })
    .register('stopPreview',    stopPreviewApi,   { async: false, events: [SGA_RECORDER.PREVIEW_STOP] })
    .register('startRecording',  startRecording,   { async: true,  events: [SGA_RECORDER.RECORD_START] })
    .register('pauseRecording',  pauseRecording,   { async: false, events: [SGA_RECORDER.RECORD_PAUSE] })
    .register('resumeRecording', resumeRecording,  { async: false, events: [SGA_RECORDER.RECORD_RESUME] })
    .register('stopRecording',   stopRecording,    { async: true,  events: [SGA_RECORDER.RECORD_STOP] })
    .register('newRecording',   newRecording,     { async: false, events: [SGA_RECORDER.RESET] })
    .register('saveSendFile',   saveSendFileApi,  { async: true,  events: [SGA_RECORDER.SAVE_PROGRESS, SGA_RECORDER.SAVE_COMPLETE] })
    .register('saveFolder',     saveFolderApi,    { async: true,  events: [SGA_RECORDER.SAVE_PROGRESS, SGA_RECORDER.SAVE_COMPLETE] })
    .register('getStatus',      getStatus,        { async: false })
    .register('getConfig',         getConfig,         { async: false })
    .register('setConfig',         setConfig,         { async: false })
    .register('setRecordingName',  setRecordingName,  { async: false });

// JS-API-first: activate before UI so window.__tool is live from tool:ready
api.activate();

// Hand off to UI shell (async — sg-layout needs LAYOUT_READY before mounting)
await initShell(state, config, api, emit);
