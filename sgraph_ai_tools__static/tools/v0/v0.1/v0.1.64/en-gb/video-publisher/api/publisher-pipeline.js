/**
 * publisher-pipeline.js
 * Orchestration façade: boot wiring, job intake (record / import / handoff),
 * thin recording delegation to core/sg-recorder, and the two publish paths.
 * Step runners live in publisher-steps.js (injected at boot, re-exported
 * here so publisher-api.js has a single import surface); the YouTube session
 * lives in publisher-youtube.js.
 *
 * Auto-run advances through audio/transcript/metadata; it ALWAYS stops at
 * ready-to-publish. Nothing reaches YouTube without an explicit upload().
 * @module publisher-pipeline
 */

import { config as recConfig, state as recState,
         startPipeline, stopPipeline, pausePipeline, resumePipeline,
         resetPipeline, startPreview, stopPreview }
    from '/core/sg-recorder/v0/v0.1/v0.1.0/recorder-pipeline.js';
import { SGA_RECORDER } from '/core/sg-recorder/v0/v0.1/v0.1.0/recorder-events.js';
import { buildTranscribeMethods } from '/core/sg-transcribe/v0/v0.1/v0.1.0/api-transcribe.js';
import { makeIsolatedTransport } from '/core/sg-transcribe/v0/v0.1/v0.1.0/llm-transport.js';
import { fetchGenerationCostDeferred } from '/core/sg-transcribe/v0/v0.1/v0.1.0/openrouter-cost.js';
import { DEFAULT_MODEL, listModels } from '/core/sg-transcribe/v0/v0.1/v0.1.0/audio-models.js';

import { state, resetJob } from './publisher-state.js';
import { itemStore } from './transcribe-store.js';
import { VP_EVENTS } from './publisher-events.js';
import * as Steps from './publisher-steps.js';
import * as YT from './publisher-youtube.js';
import { initAutoPublish, autoPublishFlow, getAutoPublish as _getAutoPublish,
         getDefaultPrivacy as _getDefaultPrivacy } from './publisher-autopublish.js';

export { listModels, recState };
export { extractAudio, transcribe, generateMetadata, setMetadata, getCostSummary }
    from './publisher-steps.js';

export const KEY_STORAGE = 'sg-openrouter-mgmt-key';   // shared with audio-transcribe

let _emit = () => {};

// ── Boot ─────────────────────────────────────────────────────────────────────

/** Wire the pipeline: emit fn + hidden LLM bus host. Call once at entry. */
export function boot({ emit }) {
    _emit = emit;

    const host = document.createElement('div');
    host.setAttribute('data-vp-llm-host', '');
    host.hidden = true;
    document.body.appendChild(host);
    const sendToLlm = makeIsolatedTransport(host, getApiKey);

    itemStore.setActiveModel(DEFAULT_MODEL);
    Steps.initSteps({
        emit: (name, detail) => _emit(name, detail),
        getApiKey,
        sendToLlm,
        transcribeMethods: buildTranscribeMethods({
            state: itemStore,
            emit:  (name, detail) => _emit(name, detail),   // AT_EVENTS pass through unchanged
            sendToLlm,
            getActiveModel: () => itemStore.getActiveModel(),
            fetchCost: fetchGenerationCostDeferred,
        }),
    });

    // In-tool recording: when the engine stops, its blobs land in the job.
    // A cancelled run discards the recording instead (cancelRun handles it).
    window.addEventListener(SGA_RECORDER.RECORD_STOP, () => {
        if (state.phase !== 'recording' || state.cancelRequested) return;
        _loadBlobs({
            videoBlob: recState.blob,
            audioBlob: recState.blobs?.audio || null,
            filename:  `${(recConfig.recordingName || 'recording').replace(/[^\w-]+/g, '_')}.webm`,
            source:    'record',
        });
    });

    initAutoPublish({ emit: (n, d) => _emit(n, d), upload, stopEngine: stopPipeline, resetEngine: resetPipeline });
    state.metadata.privacy = _getDefaultPrivacy();
    YT.hydrate({ emit: _emit });
}

export function getApiKey()        { return localStorage.getItem(KEY_STORAGE) || ''; }
export function setApiKey(apiKey)  {
    if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey.trim());
    else        localStorage.removeItem(KEY_STORAGE);
}

// Publish preferences + auto-publish flow + cancelRun live in
// publisher-autopublish.js (deps injected at boot); re-exported here so the
// UI and publisher-api keep a single import surface.
export { getStoredPrivacy, getDefaultPrivacy, setDefaultPrivacy,
         getAutoPublish, setAutoPublish, cancelRun, AUTOPUBLISH_GRACE_S }
    from './publisher-autopublish.js';

// ── Job intake ───────────────────────────────────────────────────────────────

function _loadBlobs({ videoBlob, audioBlob, filename, source }) {
    if (!videoBlob || !videoBlob.size) {
        _emit(VP_EVENTS.STEP_ERROR, { step: 'load', code: 'empty', message: 'No video data' });
        return;
    }
    state.videoBlob = videoBlob;
    state.audioBlob = audioBlob || null;
    state.filename  = filename || 'recording.webm';
    state.source    = source;
    state.phase     = 'loaded';
    state.cancelRequested = false;
    for (const k of ['audio', 'transcript', 'metadata', 'publish']) state.steps[k] = { status: 'idle' };
    _emit(VP_EVENTS.JOB_LOADED, {
        source, filename: state.filename,
        byteSize: videoBlob.size, hasAudioBlob: !!audioBlob,
    });
    if (state.autoRun) {
        Steps.autoRunSteps().then(ok => {
            // Two-click publish: only a fully completed auto-run continues
            // into the (cancellable, countdown-guarded) auto upload.
            if (ok && _getAutoPublish() && !state.cancelRequested) return autoPublishFlow();
        });
    }
}

/** Load a video file (drag-drop / file pick / API). */
export function importFile(file) {
    if (state.phase === 'recording') throw new Error('Stop the recording first.');
    _loadBlobs({ videoBlob: file, audioBlob: null, filename: file.name, source: 'import' });
    return { filename: state.filename, byteSize: file.size };
}

/** Load an incoming handoff payload ({ blob, audioBlob?, suggestedTitle?, … }). */
export function acceptHandoff(handoff) {
    _emit(VP_EVENTS.HANDOFF_RECEIVED, {
        sourceTool: handoff.sourceTool, filename: handoff.filename,
        byteSize: handoff.blob.size, hasAudioBlob: !!handoff.audioBlob,
    });
    if (handoff.suggestedTitle) state.metadata.title = handoff.suggestedTitle;
    _loadBlobs({ videoBlob: handoff.blob, audioBlob: handoff.audioBlob || null,
                 filename: handoff.filename, source: 'handoff' });
}

export function reset() {
    resetJob();
    resetPipeline();
    state.metadata.privacy = _getDefaultPrivacy();
    _emit(VP_EVENTS.JOB_RESET, {});
}

// ── Recording (thin delegation to core/sg-recorder) ──────────────────────────

export function setRecordConfig({ mode, quality, layout, recordingMode, recordingName } = {}) {
    if (mode)          recConfig.mode = mode;
    if (quality)       recConfig.videoBitsPerSecond = quality;
    if (layout)        recConfig.layout = layout;
    if (recordingMode) recConfig.recordingMode = recordingMode;
    if (recordingName !== undefined) recConfig.recordingName = recordingName;
    return getRecordConfig();
}

export function getRecordConfig() {
    const { mode, videoBitsPerSecond, layout, recordingMode, recordingName } = recConfig;
    return { mode, quality: videoBitsPerSecond, layout, recordingMode, recordingName };
}

export async function startRecording() {
    if (state.phase === 'recording') throw new Error('Already recording');
    state.phase = 'recording';
    try { await startPipeline(); }
    catch (err) { state.phase = 'idle'; throw err; }
}

/** Resolves once the engine's blobs have landed in the job. */
export async function stopRecording() {
    if (state.phase !== 'recording') throw new Error('Not recording');
    const landed = new Promise(resolve => {
        const on = () => { window.removeEventListener(VP_EVENTS.JOB_LOADED, on); clearTimeout(guard); resolve(); };
        window.addEventListener(VP_EVENTS.JOB_LOADED, on);
        // Guard: an empty recording emits STEP_ERROR instead of JOB_LOADED —
        // don't leave the caller hanging.
        const guard = setTimeout(() => { window.removeEventListener(VP_EVENTS.JOB_LOADED, on); resolve(); }, 5000);
    });
    await stopPipeline();
    await landed;
    if (state.phase === 'recording') state.phase = 'idle';
    return { filename: state.filename, byteSize: state.videoBlob?.size || 0, hasAudioBlob: !!state.audioBlob };
}

export { startPreview, stopPreview, pausePipeline as pauseRecording, resumePipeline as resumeRecording };

// ── Publish ──────────────────────────────────────────────────────────────────

export async function upload() {
    if (!state.videoBlob) throw new Error('No video loaded.');
    if (!state.metadata.title) throw Object.assign(new Error('Set a title first.'), { code: 'no-title' });
    Steps.setStep('publish', 'running');
    state.phase = 'uploading';
    try {
        const file = state.videoBlob instanceof File
            ? state.videoBlob
            : new File([state.videoBlob], state.filename, { type: state.videoBlob.type || 'video/webm' });
        const result = await YT.uploadVideo(file, {
            title: state.metadata.title, description: state.metadata.description,
            tags: state.metadata.tags, privacyStatus: state.metadata.privacy,
        }, { emit: _emit });
        state.phase = 'published';
        Steps.setStep('publish', 'done', { info: { id: result.id, url: result.url } });
        return { id: result.id, url: result.url };
    } catch (err) {
        state.phase = 'ready-to-publish';
        Steps.setStep('publish', 'error', { error: err.message, code: err.code });
        _emit(VP_EVENTS.STEP_ERROR, { step: 'publish', code: err.code || 'upload-failed', message: err.message });
        throw err;
    }
}

/** One-shot: run the whole chain. Requires confirm:true to actually upload. */
export async function publish({ file, model, guidance, privacy, confirm } = {}) {
    if (file) {
        // Drive the chain ourselves — suspend autoRun so steps don't double-run.
        const wasAuto = state.autoRun;
        state.autoRun = false;
        try { importFile(file); } finally { state.autoRun = wasAuto; }
    }
    if (!state.videoBlob) throw new Error('No video loaded.');
    if (!state.audio)      await Steps.extractAudio();
    if (!state.transcript) await Steps.transcribe({ model });
    if (!state.metadata.title || guidance) await Steps.generateMetadata({ guidance, model });
    if (privacy) Steps.setMetadata({ privacy });
    if (confirm !== true) return { phase: state.phase, metadata: { ...state.metadata }, note: 'Stopped at ready-to-publish — pass confirm:true to upload.' };
    if (!state.youtube.connected) await YT.connect({ emit: _emit });
    return await upload();
}
