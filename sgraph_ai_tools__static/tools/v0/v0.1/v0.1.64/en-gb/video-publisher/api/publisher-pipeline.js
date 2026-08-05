/**
 * publisher-pipeline.js
 * Orchestration: record/import → audio route → transcribe → metadata →
 * ready-to-publish → upload. Composes the extracted core engines
 * (sg-recorder, sg-transcribe) — the UI never imports core directly.
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

export { listModels };

import { state, itemStore, resetJob } from './publisher-state.js';
import { VP_EVENTS } from './publisher-events.js';
import { routeAudio } from './audio-router.js';
import { generateMetadata as genMeta } from './metadata-gen.js';
import * as YT from './publisher-youtube.js';

export const KEY_STORAGE = 'sg-openrouter-mgmt-key';   // shared with audio-transcribe

let _emit = () => {};
let _transcribeMethods = null;
let _sendToLlm = null;

// ── Boot ─────────────────────────────────────────────────────────────────────

/** Wire the pipeline: emit fn + hidden LLM bus host. Call once at entry. */
export function boot({ emit }) {
    _emit = emit;

    const host = document.createElement('div');
    host.setAttribute('data-vp-llm-host', '');
    host.style.display = 'none';
    document.body.appendChild(host);
    _sendToLlm = makeIsolatedTransport(host, getApiKey);

    itemStore.setActiveModel(DEFAULT_MODEL);
    _transcribeMethods = buildTranscribeMethods({
        state: itemStore,
        emit:  (name, detail) => _emit(name, detail),   // AT_EVENTS pass through unchanged
        sendToLlm: _sendToLlm,
        getActiveModel: () => itemStore.getActiveModel(),
        fetchCost: fetchGenerationCostDeferred,
    });

    // In-tool recording: when the engine stops, its blobs land in the job.
    window.addEventListener(SGA_RECORDER.RECORD_STOP, () => {
        if (state.phase !== 'recording') return;
        _loadBlobs({
            videoBlob: recState.blob,
            audioBlob: recState.blobs?.audio || null,
            filename:  `${(recConfig.recordingName || 'recording').replace(/[^\w-]+/g, '_')}.webm`,
            source:    'record',
        });
    });

    YT.hydrate({ emit: _emit });
}

export function getApiKey()        { return localStorage.getItem(KEY_STORAGE) || ''; }
export function setApiKey(apiKey)  {
    if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey.trim());
    else        localStorage.removeItem(KEY_STORAGE);
}
export function getSendToLlm()     { return _sendToLlm; }

// ── Job intake ───────────────────────────────────────────────────────────────

function _setStep(step, status, extra = {}) {
    state.steps[step] = { status, ...extra };
    _emit(VP_EVENTS.STEP_CHANGED, { step, status, ...extra });
}

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
    for (const k of ['audio', 'transcript', 'metadata', 'publish']) state.steps[k] = { status: 'idle' };
    _emit(VP_EVENTS.JOB_LOADED, {
        source, filename: state.filename,
        byteSize: videoBlob.size, hasAudioBlob: !!audioBlob,
    });
    if (state.autoRun) _autoRun();
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

export { startPreview, stopPreview, pausePipeline as pauseRecording, resumePipeline as resumeRecording, recState };

// ── Steps ────────────────────────────────────────────────────────────────────

async function _autoRun() {
    try {
        await extractAudio();
        if (!getApiKey()) return;            // no key — stop before billable steps
        await transcribe();
        await generateMetadata();
    } catch (_e) { /* recorded on the step; user can retry from the UI */ }
}

export async function extractAudio() {
    if (!state.videoBlob) throw new Error('No video loaded.');
    _setStep('audio', 'running');
    _emit(VP_EVENTS.AUDIO_START, {});
    try {
        const r = await routeAudio(
            { videoBlob: state.videoBlob, audioBlob: state.audioBlob, filename: state.filename },
            { onProgress: info => _emit(VP_EVENTS.STEP_CHANGED, { step: 'audio', status: 'running', ...info }) },
        );
        state.audio = r;
        itemStore.setAudioItem({ blob: r.blob, name: r.name });
        _setStep('audio', 'done', { info: { route: r.route, bytes: r.blob.size } });
        _emit(VP_EVENTS.AUDIO_COMPLETE, { route: r.route, bytes: r.blob.size, mime: r.mime });
        return { route: r.route, bytes: r.blob.size, mime: r.mime };
    } catch (err) {
        _setStep('audio', 'error', { error: err.message, code: err.code });
        _emit(VP_EVENTS.STEP_ERROR, { step: 'audio', code: err.code || 'audio-error', message: err.message });
        throw err;
    }
}

export async function transcribe({ model } = {}) {
    if (!state.audio) await extractAudio();
    if (!getApiKey()) throw Object.assign(new Error('No OpenRouter key set.'), { code: 'key-missing' });
    _setStep('transcript', 'running');
    _emit(VP_EVENTS.TRANSCRIBE_START, { model: model || itemStore.getActiveModel() });
    try {
        const r = await _transcribeMethods.transcribeItem({ id: 'job-audio', model });
        state.transcript = r.text;
        _setStep('transcript', 'done', { info: { model: r.model, costUsd: r.usage?.costUsd } });
        _emit(VP_EVENTS.TRANSCRIBE_COMPLETE, { model: r.model, costUsd: r.usage?.costUsd, chars: r.text.length });
        return { text: r.text, model: r.model, costUsd: r.usage?.costUsd, generationId: r.generationId };
    } catch (err) {
        _setStep('transcript', 'error', { error: err.message, code: err.code });
        _emit(VP_EVENTS.STEP_ERROR, { step: 'transcript', code: err.code || 'llm-error', message: err.message });
        throw err;
    }
}

export async function generateMetadata({ guidance, model } = {}) {
    if (!state.transcript) throw Object.assign(new Error('No transcript yet.'), { code: 'no-transcript' });
    _setStep('metadata', 'running');
    _emit(VP_EVENTS.METADATA_START, { model: model || DEFAULT_MODEL });
    try {
        const r = await genMeta(
            { sendToLlm: _sendToLlm, onCost: e => itemStore.addAuxCost(e) },
            { transcript: state.transcript, guidance, model },
        );
        state.metadata = { ...state.metadata, title: r.title, description: r.description, tags: r.tags };
        state.phase = 'ready-to-publish';
        _setStep('metadata', 'done', { info: { model: r.model, costUsd: r.costUsd } });
        _emit(VP_EVENTS.METADATA_COMPLETE, { title: r.title, tags: r.tags, costUsd: r.costUsd });
        return r;
    } catch (err) {
        _setStep('metadata', 'error', { error: err.message, code: err.code });
        _emit(VP_EVENTS.STEP_ERROR, { step: 'metadata', code: err.code || 'llm-error', message: err.message });
        throw err;
    }
}

export function setMetadata({ title, description, tags, privacy } = {}) {
    if (title !== undefined)       state.metadata.title = String(title).slice(0, 100);
    if (description !== undefined) state.metadata.description = String(description);
    if (tags !== undefined)        state.metadata.tags = Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean);
    if (privacy !== undefined)     state.metadata.privacy = privacy;
    if (state.videoBlob && state.metadata.title && state.phase === 'loaded') state.phase = 'ready-to-publish';
    return { ...state.metadata };
}

// ── Publish ──────────────────────────────────────────────────────────────────

export async function upload() {
    if (!state.videoBlob) throw new Error('No video loaded.');
    if (!state.metadata.title) throw Object.assign(new Error('Set a title first.'), { code: 'no-title' });
    _setStep('publish', 'running');
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
        _setStep('publish', 'done', { info: { id: result.id, url: result.url } });
        return { id: result.id, url: result.url };
    } catch (err) {
        state.phase = 'ready-to-publish';
        _setStep('publish', 'error', { error: err.message, code: err.code });
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
    if (!state.audio)      await extractAudio();
    if (!state.transcript) await transcribe({ model });
    if (!state.metadata.title || guidance) await generateMetadata({ guidance, model });
    if (privacy) setMetadata({ privacy });
    if (confirm !== true) return { phase: state.phase, metadata: { ...state.metadata }, note: 'Stopped at ready-to-publish — pass confirm:true to upload.' };
    if (!state.youtube.connected) await YT.connect({ emit: _emit });
    return await upload();
}

export function getCostSummary() {
    let transcription = 0;
    for (const it of itemStore.getItems()) for (const v of (it.versions || [])) if (typeof v.costUsd === 'number') transcription += v.costUsd;
    let aux = 0;
    for (const a of itemStore.getAuxCosts()) if (typeof a.usd === 'number') aux += a.usd;
    return { transcriptionUsd: transcription, metadataUsd: aux, totalUsd: transcription + aux };
}
