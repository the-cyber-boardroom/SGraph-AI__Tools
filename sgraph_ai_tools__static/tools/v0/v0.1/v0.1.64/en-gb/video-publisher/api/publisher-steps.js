/**
 * publisher-steps.js
 * The three billable/processing step runners (audio → transcript → metadata),
 * step-status bookkeeping, auto-run, and the cost roll-up. Dependencies
 * (emit, transport, transcribe methods, key getter) are injected once via
 * initSteps() from the pipeline's boot — this module never imports the
 * pipeline, so the dependency graph stays one-directional.
 * @module publisher-steps
 */

import { state } from './publisher-state.js';
import { itemStore } from './transcribe-store.js';
import { VP_EVENTS } from './publisher-events.js';
import { routeAudio } from './audio-router.js';
import { generateMetadata as genMeta, METADATA_DEFAULT_MODEL } from './metadata-gen.js';

let _ctx = { emit: () => {}, getApiKey: () => '', sendToLlm: null, transcribeMethods: null };

/** Inject runtime dependencies. Called once from publisher-pipeline.boot(). */
export function initSteps(ctx) { _ctx = { ..._ctx, ...ctx }; }

/** Record a step transition on state and mirror it as a vp:step:changed event. */
export function setStep(step, status, extra = {}) {
    state.steps[step] = { status, ...extra };
    _ctx.emit(VP_EVENTS.STEP_CHANGED, { step, status, ...extra });
}

function _stepError(step, err, fallbackCode) {
    setStep(step, 'error', { error: err.message, code: err.code });
    _ctx.emit(VP_EVENTS.STEP_ERROR, { step, code: err.code || fallbackCode, message: err.message });
}

/**
 * Auto-advance audio → transcript → metadata. Never uploads itself.
 * @returns {Promise<boolean>} true if all three steps completed (the
 *          auto-publish continuation in the pipeline keys off this).
 */
export async function autoRunSteps() {
    try {
        await extractAudio();
        if (state.cancelRequested || !_ctx.getApiKey()) return false;
        await transcribe();
        if (state.cancelRequested) return false;
        await generateMetadata();
        return !state.cancelRequested;
    } catch (_e) {
        return false;                        // recorded on the step; user can retry from the UI
    }
}

/** Abort any in-flight transcription request (no-op when idle). */
export function cancelTranscribe() {
    try { _ctx.transcribeMethods?.cancelItem({ id: 'job-audio' }); } catch (_e) { /* no-op */ }
}

export async function extractAudio() {
    if (!state.videoBlob) throw new Error('No video loaded.');
    setStep('audio', 'running');
    _ctx.emit(VP_EVENTS.AUDIO_START, {});
    try {
        const r = await routeAudio(
            { videoBlob: state.videoBlob, audioBlob: state.audioBlob, filename: state.filename },
            { onProgress: info => setStep('audio', 'running', info) },
        );
        state.audio = r;
        itemStore.setAudioItem({ blob: r.blob, name: r.name });
        setStep('audio', 'done', { info: { route: r.route, bytes: r.blob.size } });
        _ctx.emit(VP_EVENTS.AUDIO_COMPLETE, { route: r.route, bytes: r.blob.size, mime: r.mime });
        return { route: r.route, bytes: r.blob.size, mime: r.mime };
    } catch (err) {
        _stepError('audio', err, 'audio-error');
        throw err;
    }
}

export async function transcribe({ model } = {}) {
    if (!state.audio) await extractAudio();
    if (!_ctx.getApiKey()) throw Object.assign(new Error('No OpenRouter key set.'), { code: 'key-missing' });
    setStep('transcript', 'running');
    _ctx.emit(VP_EVENTS.TRANSCRIBE_START, { model: model || itemStore.getActiveModel() });
    try {
        const r = await _ctx.transcribeMethods.transcribeItem({ id: 'job-audio', model });
        state.transcript = r.text;
        setStep('transcript', 'done', { info: { model: r.model, costUsd: r.usage?.costUsd } });
        _ctx.emit(VP_EVENTS.TRANSCRIBE_COMPLETE, { model: r.model, costUsd: r.usage?.costUsd, chars: r.text.length });
        return { text: r.text, model: r.model, costUsd: r.usage?.costUsd, generationId: r.generationId };
    } catch (err) {
        _stepError('transcript', err, 'llm-error');
        throw err;
    }
}

export async function generateMetadata({ guidance, model } = {}) {
    if (!state.transcript) throw Object.assign(new Error('No transcript yet.'), { code: 'no-transcript' });
    setStep('metadata', 'running');
    _ctx.emit(VP_EVENTS.METADATA_START, { model: model || METADATA_DEFAULT_MODEL });
    try {
        const r = await genMeta(
            { sendToLlm: _ctx.sendToLlm, onCost: e => itemStore.addAuxCost(e) },
            { transcript: state.transcript, guidance, model },
        );
        state.metadata = { ...state.metadata, title: r.title, description: r.description, tags: r.tags };
        state.phase = 'ready-to-publish';
        setStep('metadata', 'done', { info: { model: r.model, costUsd: r.costUsd } });
        _ctx.emit(VP_EVENTS.METADATA_COMPLETE, { title: r.title, tags: r.tags, costUsd: r.costUsd });
        return r;
    } catch (err) {
        _stepError('metadata', err, 'llm-error');
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

export function getCostSummary() {
    let transcription = 0;
    for (const it of itemStore.getItems()) for (const v of (it.versions || [])) if (typeof v.costUsd === 'number') transcription += v.costUsd;
    let aux = 0;
    for (const a of itemStore.getAuxCosts()) if (typeof a.usd === 'number') aux += a.usd;
    return { transcriptionUsd: transcription, metadataUsd: aux, totalUsd: transcription + aux };
}
