/**
 * nr-pipeline.js
 * Two lanes over the pair list:
 *   - TRANSCRIBE (parallel): a pair's bounds close → PCM slice → WAV →
 *     core/sg-transcribe isolated transport → raw text. Segments are
 *     independent, so they stream to 'raw' while capture continues.
 *   - CLEAN (sequential, seq order): the rolling summary is order-dependent
 *     (Decision 7), so cleanup runs one pair at a time via nr-cleanup.
 *
 * @module nr-pipeline
 */

import { makeIsolatedTransport } from '/core/sg-transcribe/v0/v0.1/v0.1.0/llm-transport.js';
import { toSupportedDataUrl } from '/core/sg-transcribe/v0/v0.1/v0.1.0/audio-format.js';
import { DEFAULT_MODEL, listModels as listCoreModels } from '/core/sg-transcribe/v0/v0.1/v0.1.0/audio-models.js';
import { fetchGenerationCostDeferred } from '/core/sg-transcribe/v0/v0.1/v0.1.0/openrouter-cost.js';
import { encodeWav } from '/core/sg-audio-decode/v0/v0.1/v0.1.0/sg-wav-encoder.js';
import { state, config, getPairById, checkSpendCap } from './nr-state.js';
import { slicePcm } from './nr-capture.js';
import { runCleanup } from './nr-cleanup.js';
import { billed } from './nr-billing.js';

const KEY_STORAGE = 'sg-openrouter-mgmt-key';
const TRANSCRIBE_PROMPT =
    'Transcribe the following audio to plain text. Return only the transcript, with no preamble, commentary, or formatting.';

let transport = null;
let emitFn = () => {};

/** pairId → in-flight transcription promise (so transcribeAll can await them). */
const inFlight = new Map();

/** @param {{ emit: Function }} deps */
export function initPipeline({ emit }) {
    emitFn = emit;
    const host = document.createElement('div');
    host.style.display = 'none';
    document.body.appendChild(host);
    // Wrapped, so every paid call lands in the billing ledger with no per-call
    // bookkeeping to forget.
    transport = billed(makeIsolatedTransport(host, getApiKey), { scope: 'transcribe' });
}

/** The shared BYOK key (same slot as the other media tools). */
export function getApiKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ''; } catch (_) { return ''; }
}

/** @param {{ apiKey: string }} p */
export function setApiKey({ apiKey } = {}) {
    if (!apiKey) throw Object.assign(new Error('apiKey is required'), { code: 'bad-params' });
    try { localStorage.setItem(KEY_STORAGE, apiKey); } catch (_) { /* */ }
    return { ok: true, present: true };
}

/** Curated STT models from the core engine (cleanup uses the same list). */
export function listModels() {
    return listCoreModels();
}

/** Extract WAV blob for a bounded pair. */
export function pairWav(pair) {
    if (pair.tEnd == null) throw Object.assign(new Error(`Pair ${pair.id} bounds not closed yet`), { code: 'unknown-pair' });
    return encodeWav(slicePcm(pair.tStart, pair.tEnd));
}

/** Resolve the exact charged cost later; never throws. */
function deferCost(generationId, apply) {
    if (!generationId) return;
    fetchGenerationCostDeferred(generationId, getApiKey())
        .then(cost => { if (cost != null) apply(cost); })
        .catch(() => {});
}

/**
 * Transcribe one bounded pair (the parallel lane). Retranscribe keeps the old
 * raw in rawVersions — raw is never silently replaced.
 * @param {{ id: string, model?: string }} p
 * @returns {Promise<{ id, text, model, generationId }>}
 */
export function transcribePair({ id, model } = {}) {
    const p = _transcribePair({ id, model });
    // Track a settled-only copy so transcribeAll can await streaming work
    // without ever creating an unhandled rejection; callers see the real p.
    const tracked = p.then(() => {}, () => {}).then(() => { inFlight.delete(id); });
    inFlight.set(id, tracked);
    return p;
}

async function _transcribePair({ id, model } = {}) {
    const pair = getPairById(id);
    if (!pair) throw Object.assign(new Error(`Unknown pair: ${id}`), { code: 'unknown-pair' });
    if (!getApiKey()) throw Object.assign(new Error('No OpenRouter key — setApiKey() first'), { code: 'no-key' });
    checkSpendCap();

    const useModel = model || config.transcribeModel || DEFAULT_MODEL;
    if (pair.raw) { pair.rawVersions.push(pair.raw); pair.raw = null; }
    pair.status = 'transcribing'; pair.error = null;
    emitFn('nr:transcribe:started', { id: pair.id, model: useModel });

    try {
        const wav = pairWav(pair);
        const audio = await toSupportedDataUrl(wav, `${pair.id}.wav`);
        const messages = [{
            role: 'user',
            content: [
                { type: 'text', text: TRANSCRIBE_PROMPT },
                { type: 'binary_file', name: `${pair.id}.wav`, mime_type: audio.mime, data_url: audio.dataUrl },
            ],
        }];
        const res = await transport({ messages, model: useModel }, { scope: 'transcribe', pairId: pair.id });
        const text = (res.content != null ? String(res.content) : '').trim();
        pair.raw = {
            text, model: useModel, generationId: res.generationId || null,
            costUsd: typeof res.responseCost === 'number' ? res.responseCost : null,
        };
        pair.status = pair.clean ? 'clean' : 'raw';
        deferCost(res.generationId, cost => { if (pair.raw) pair.raw.costUsd = cost; });
        emitFn('nr:transcribe:complete', { id: pair.id, chars: text.length, costUsd: pair.raw.costUsd });
        emitFn('nr:pair:updated', { id: pair.id, field: 'raw' });
        return { id: pair.id, text, model: useModel, generationId: pair.raw.generationId };
    } catch (err) {
        pair.status = 'error';
        pair.error = { code: err.code || 'llm-error', step: 'transcribe' };
        emitFn('nr:transcribe:error', { id: pair.id, code: pair.error.code });
        throw err;
    }
}

/**
 * Transcribe every bounded pair — parallel pool. Segments already streaming
 * (started when their bounds closed mid-capture) are awaited rather than
 * re-sent, so after `await transcribeAll()` every bounded pair has settled.
 * Idempotent: a second call is a no-op.
 *
 * @param {{ concurrency?: number }} p
 * @returns {Promise<{ done: number, failed: number }>}
 */
export async function transcribeAll({ concurrency = 4 } = {}) {
    await Promise.all([...inFlight.values()]);                 // let streaming work settle first
    const queue = state.pairs.filter(p => p.tEnd != null && !p.raw);
    let failed = 0;
    async function worker() {
        while (queue.length) {
            const pair = queue.shift();
            try { await transcribePair({ id: pair.id }); }
            catch (err) { failed += 1; if (err && err.code === 'budget-cap') { queue.length = 0; } }
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    await Promise.all([...inFlight.values()]);
    const done = state.pairs.filter(p => p.tEnd != null && p.raw).length;
    return { done, failed };
}

/**
 * Clean one pair against the CURRENT rolling summary (screenshot-grounded,
 * Decision 6). Delegates the call + parse to nr-cleanup.
 * @param {{ id: string, model?: string }} p
 */
export async function cleanPair({ id, model } = {}) {
    const pair = getPairById(id);
    if (!pair) throw Object.assign(new Error(`Unknown pair: ${id}`), { code: 'unknown-pair' });
    if (!pair.raw) throw Object.assign(new Error(`Pair ${id} has no raw transcript yet`), { code: 'unknown-pair' });
    if (config.cleanup === 'off') return { skipped: true };
    if (!getApiKey()) throw Object.assign(new Error('No OpenRouter key — setApiKey() first'), { code: 'no-key' });
    checkSpendCap();

    const useModel = model || config.cleanupModel || config.transcribeModel || DEFAULT_MODEL;
    pair.status = 'cleaning';
    emitFn('nr:clean:started', { id: pair.id, model: useModel, mode: config.cleanup });
    try {
        // nr-cleanup stays unaware of billing: it gets a transport already bound
        // to this pair's ledger context.
        const cleanTransport = req => transport(req, { scope: 'clean', pairId: pair.id });
        const result = await runCleanup({ pair, summary: state.rollingSummary, mode: config.cleanup, model: useModel, transport: cleanTransport });
        pair.clean = {
            text: result.cleanText, marks: result.marks, model: useModel,
            generationId: result.generationId, costUsd: result.costUsd,
        };
        pair.status = 'clean';
        deferCost(result.generationId, cost => { if (pair.clean) pair.clean.costUsd = cost; });
        if (typeof result.summary === 'string' && result.summary) {
            state.rollingSummary = result.summary.slice(0, 2000);
            state.summaryAtSeq = pair.seq;
            emitFn('nr:summary:updated', { length: state.rollingSummary.length, atSeq: pair.seq });
        }
        emitFn('nr:clean:complete', { id: pair.id, marks: result.marks.length, costUsd: result.costUsd });
        emitFn('nr:pair:updated', { id: pair.id, field: 'clean' });
        return { id: pair.id, cleanText: result.cleanText, marks: result.marks };
    } catch (err) {
        // A failed clean NEVER blocks the document — raw stands (Decision 6).
        pair.status = 'raw';
        pair.error = { code: err.code || 'clean-parse', step: 'clean' };
        emitFn('nr:clean:error', { id: pair.id, code: pair.error.code });
        throw err;
    }
}

/**
 * The sequential cleanup lane: every raw pair, in seq order.
 * @returns {Promise<{ done: number, failed: number }>}
 */
export async function cleanAll() {
    let done = 0, failed = 0;
    for (const pair of [...state.pairs].sort((a, b) => a.seq - b.seq)) {
        if (!pair.raw || pair.clean) continue;
        try { await cleanPair({ id: pair.id }); done += 1; }
        catch (err) { failed += 1; if (err && err.code === 'budget-cap') break; }
    }
    return { done, failed };
}
