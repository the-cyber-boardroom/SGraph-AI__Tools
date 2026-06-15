/**
 * api-transcribe — per-item transcription pipeline (the LLM glue).
 *
 * Builds a `binary_file` audio message, fires `llm:send` on the LLM bus, and
 * resolves on `llm:request-complete`. The transport is injectable so the
 * pipeline is testable headlessly without a DOM or network: pass `sendToLlm`
 * (a function that takes `{ messages, model }` and resolves the transcript).
 *
 * @module audio-transcribe/api-transcribe
 */

import { toSupportedDataUrl } from './audio-format.js';
import { AT_EVENTS } from './audio-transcribe-events.js';
import { isAvailableModel } from './audio-models.js';

/** Default instruction sent alongside the audio. */
const TRANSCRIBE_PROMPT =
    'Transcribe the following audio to plain text. Return only the transcript, with no preamble, commentary, or formatting.';

/**
 * Build the per-item transcription methods.
 *
 * @param {object} ctx
 * @param {object} ctx.state
 * @param {(name: string, detail?: object) => void} ctx.emit
 * @param {(req: { messages: object[], model: string, language?: string }) => Promise<{ content: string, latencyMs?: number, model?: string, promptTokens?: number, completionTokens?: number, generationId?: string, responseCost?: number }>} ctx.sendToLlm
 *        - transport. Default (in the tool) bridges to <sg-llm-request> via the bus.
 * @param {() => string} [ctx.getActiveModel]
 * @param {(generationId: string) => Promise<number|null>} [ctx.fetchCost]
 *        - resolves the exact charged cost (USD) for a generation id, a couple
 *          seconds after completion. Optional; cost just stays unknown without it.
 * @param {(exchange: object) => void} [ctx.onExchange]
 *        - records one request/response for the provenance panel. Optional.
 * @returns {{ setModel: Function, transcribeItem: Function, getTranscript: Function }}
 */
export function buildTranscribeMethods({ state, emit, sendToLlm, getActiveModel, fetchCost, onExchange }) {
    const recordExchange = typeof onExchange === 'function' ? onExchange : () => {};
    /** vid -> cancel fn for in-flight requests (registered by the transport). */
    const cancellers = new Map();
    /**
     * Set the active model, or (with `id`) one item's model.
     * @param {{ model: string, id?: string }} params
     * @returns {{ model: string }}
     */
    function setModel(params = {}) {
        const model = params.model;
        if (!model) throw Object.assign(new Error('model is required'), { code: 'bad-params' });
        if (params.id) {
            state.updateItem(params.id, { model });
            emit(AT_EVENTS.MODEL_CHANGED, { model, id: params.id });
        } else {
            state.setActiveModel(model);
            emit(AT_EVENTS.MODEL_CHANGED, { model });
        }
        return { model };
    }

    /**
     * Build the OpenRouter chat message carrying the audio.
     * @param {{ dataUrl: string, mime: string, name: string }} audio
     * @returns {object[]} messages
     */
    function buildMessages(audio) {
        return [{
            role: 'user',
            content: [
                { type: 'text', text: TRANSCRIBE_PROMPT },
                {
                    type: 'binary_file',
                    name: audio.name,
                    mime_type: audio.mime,
                    data_url: audio.dataUrl,
                },
            ],
        }];
    }

    /**
     * Run ONE transcription as a new version (re-transcribe keeps prior versions).
     * Never throws — a failure is recorded as an `error` version — so parallel
     * multi-model runs don't abort each other. Returns { ok, vid, text? }.
     * @param {object} item  raw item (with blob)
     * @param {string} model
     * @returns {Promise<{ ok: boolean, vid: string, text?: string, error?: string }>}
     */
    async function runVersion(item, model) {
        const vid = state.addVersion(item.id, { model, status: 'transcribing' });
        const reqInfo = { prompt: TRANSCRIBE_PROMPT, audio: { name: item.name, mime: item.mimeType, sizeBytes: item.sizeBytes } };
        emit(AT_EVENTS.TRANSCRIBE_STARTED, { id: item.id, vid });
        // Live provenance: log the request immediately; updated on resolve/cancel.
        recordExchange({ ts: Date.now(), itemId: item.id, itemName: item.name, vid, model, status: 'pending', request: reqInfo });
        try {
            emit(AT_EVENTS.TRANSCRIBE_PROGRESS, { id: item.id, vid, stage: 'encoding' });
            const audio = await toSupportedDataUrl(item.blob, item.name);
            const messages = buildMessages({ ...audio, name: item.name });

            emit(AT_EVENTS.TRANSCRIBE_PROGRESS, { id: item.id, vid, stage: 'sending' });
            const t0 = Date.now();
            const res = (await sendToLlm({ messages, model, registerCancel: (fn) => cancellers.set(vid, fn) })) || {};
            const text = (res.content != null ? String(res.content) : '').trim();
            const latencyMs = res.latencyMs || (Date.now() - t0);
            const generationId = res.generationId || null;

            state.updateVersion(item.id, vid, {
                status: 'done', text, latencyMs, generationId,
                promptTokens: res.promptTokens, completionTokens: res.completionTokens,
                costUsd: (typeof res.responseCost === 'number' ? res.responseCost : undefined),
                costPending: !!(generationId && fetchCost),
            });
            emit(AT_EVENTS.TRANSCRIBE_COMPLETE, { id: item.id, vid, model });
            recordExchange({
                ts: Date.now(), itemId: item.id, itemName: item.name, vid, model, status: 'done', request: reqInfo,
                response: { content: text, promptTokens: res.promptTokens, completionTokens: res.completionTokens, latencyMs, generationId, costUsd: (typeof res.responseCost === 'number' ? res.responseCost : undefined) },
                raw: res.raw || null,
            });

            // Exact charged cost arrives a couple seconds later by generation id.
            if (generationId && fetchCost) {
                Promise.resolve(fetchCost(generationId)).then((cost) => {
                    state.updateVersion(item.id, vid, { costPending: false, ...(cost != null ? { costUsd: cost } : {}) });
                }).catch(() => state.updateVersion(item.id, vid, { costPending: false }));
            }
            return { ok: true, vid, text, model, latencyMs, generationId };
        } catch (err) {
            const cancelled = !!(err && err.code === 'cancelled');
            state.updateVersion(item.id, vid, { status: cancelled ? 'cancelled' : 'error', error: err.message });
            emit(AT_EVENTS.TRANSCRIBE_ERROR, { id: item.id, vid, error: err.message, cancelled });
            recordExchange({ ts: Date.now(), itemId: item.id, itemName: item.name, vid, model, status: cancelled ? 'cancelled' : 'error', error: err.message, request: reqInfo });
            return { ok: false, vid, error: err.message, cancelled };
        } finally {
            cancellers.delete(vid);
        }
    }

    /**
     * Transcribe one queue item (appends a version). Used for retry too. Throws
     * on failure so the batch orchestrator can record it.
     * @param {{ id: string, model?: string, language?: string }} params
     * @returns {Promise<{ id: string, text: string, model: string, latencyMs: number, vid: string }>}
     */
    async function transcribeItem(params = {}) {
        const item = state.getRawItem(params.id);
        if (!item) throw Object.assign(new Error(`Unknown item id: ${params.id}`), { code: 'unknown-item' });
        const model = params.model || item.model || (getActiveModel && getActiveModel()) || '';
        if (!model) throw Object.assign(new Error('No model selected'), { code: 'no-model' });
        if (!isAvailableModel(model)) {
            throw Object.assign(new Error(`Model not available on the chat path: ${model}`), { code: 'model-unavailable' });
        }
        const r = await runVersion(item, model);
        if (!r.ok) throw Object.assign(new Error(r.error || 'Transcription failed'), { code: 'llm-error' });
        return { id: item.id, text: r.text, model, latencyMs: r.latencyMs, vid: r.vid, generationId: r.generationId };
    }

    /**
     * Transcribe one item against MULTIPLE models IN PARALLEL — each result is a
     * separate version (advanced mode). Unavailable models are recorded as error
     * versions and skipped. Safe to parallelise because the tool's transport
     * isolates each request on its own bus.
     * @param {{ id: string, models: string[] }} params
     * @returns {Promise<{ id: string, results: Array<{ vid: string, model: string, ok: boolean }> }>}
     */
    async function transcribeModels(params = {}) {
        const item = state.getRawItem(params.id);
        if (!item) throw Object.assign(new Error(`Unknown item id: ${params.id}`), { code: 'unknown-item' });
        const models = Array.isArray(params.models) ? params.models.filter(Boolean) : [];
        if (!models.length) throw Object.assign(new Error('No models selected'), { code: 'no-model' });

        const results = await Promise.all(models.map(async (model) => {
            if (!isAvailableModel(model)) {
                const vid = state.addVersion(item.id, { model, status: 'error', error: 'Model not available on the chat path' });
                emit(AT_EVENTS.TRANSCRIBE_ERROR, { id: item.id, vid, error: 'model-unavailable' });
                return { vid, model, ok: false };
            }
            const r = await runVersion(item, model);
            return { vid: r.vid, model, ok: r.ok };
        }));
        return { id: item.id, results };
    }

    /**
     * Get one transcript (with id) or all transcripts (without).
     * @param {{ id?: string }} [params]
     * @returns {object|object[]}
     */
    function getTranscript(params = {}) {
        if (params.id) {
            const it = state.getItem(params.id);
            if (!it) return null;
            return { id: it.id, text: it.transcript || '', model: it.model };
        }
        return state.getItems()
            .filter((it) => it.status === 'done')
            .map((it) => ({ id: it.id, text: it.transcript || '', model: it.model }));
    }

    /**
     * Cost roll-up: per transcription is on each version; this sums per audio
     * file and across the whole browser session.
     * @returns {{ sessionUsd: number, sessionPending: boolean, perItem: Array<{ id: string, name: string, usd: number, pending: boolean, versions: number }> }}
     */
    function getCostSummary() {
        let sessionUsd = 0;
        let sessionPending = false;
        const perItem = state.getItems().map((it) => {
            let usd = 0; let pending = false;
            for (const v of (it.versions || [])) {
                if (typeof v.costUsd === 'number') usd += v.costUsd;
                if (v.costPending) pending = true;
            }
            sessionUsd += usd;
            if (pending) sessionPending = true;
            return { id: it.id, name: it.name, usd, pending, versions: (it.versions || []).length };
        });
        return { sessionUsd, sessionPending, perItem };
    }

    /**
     * Cancel any in-flight transcription(s) for one item (aborts the fetch).
     * @param {{ id: string }} params
     * @returns {{ cancelled: number }}
     */
    function cancelItem(params = {}) {
        const it = state.getRawItem(params.id);
        if (!it) return { cancelled: 0 };
        let cancelled = 0;
        for (const v of (it.versions || [])) {
            if (v.status === 'transcribing') {
                const c = cancellers.get(v.vid);
                if (c) { try { c(); cancelled += 1; } catch (_) { /* */ } }
            }
        }
        return { cancelled };
    }

    /**
     * Transcribe a RAW blob (not a queue item) — used by Live mode's polling
     * loop. No versions/state, just text. @returns {Promise<{text,generationId?}>}
     * @param {{ blob: Blob, name?: string, model: string }} params
     */
    async function transcribeBlob(params = {}) {
        const model = params.model || (getActiveModel && getActiveModel()) || '';
        if (!model) throw Object.assign(new Error('No model selected'), { code: 'no-model' });
        const audio = await toSupportedDataUrl(params.blob, params.name || 'live.webm');
        const messages = buildMessages({ ...audio, name: params.name || 'live' });
        const res = (await sendToLlm({ messages, model })) || {};
        return {
            text: (res.content != null ? String(res.content) : '').trim(),
            generationId: res.generationId,
            promptTokens: res.promptTokens, completionTokens: res.completionTokens,
        };
    }

    return { setModel, transcribeItem, transcribeModels, transcribeBlob, getTranscript, getCostSummary, cancelItem };
}
