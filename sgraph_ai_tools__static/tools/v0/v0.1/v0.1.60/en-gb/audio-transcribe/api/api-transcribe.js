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
 * @returns {{ setModel: Function, transcribeItem: Function, getTranscript: Function }}
 */
export function buildTranscribeMethods({ state, emit, sendToLlm, getActiveModel, fetchCost }) {
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
     * Transcribe one queue item. Used for retry too.
     * @param {{ id: string, model?: string, language?: string }} params
     * @returns {Promise<{ id: string, text: string, model: string, latencyMs: number }>}
     */
    async function transcribeItem(params = {}) {
        const item = state.getRawItem(params.id);
        if (!item) throw Object.assign(new Error(`Unknown item id: ${params.id}`), { code: 'unknown-item' });

        const model = params.model || item.model || (getActiveModel && getActiveModel()) || '';
        if (!model) throw Object.assign(new Error('No model selected'), { code: 'no-model' });
        if (!isAvailableModel(model)) {
            throw Object.assign(new Error(`Model not available on the chat path: ${model}`), { code: 'model-unavailable' });
        }

        state.updateItem(item.id, { status: 'transcribing', model, error: undefined });
        emit(AT_EVENTS.TRANSCRIBE_STARTED, { id: item.id });

        try {
            emit(AT_EVENTS.TRANSCRIBE_PROGRESS, { id: item.id, stage: 'encoding' });
            const audio = await toSupportedDataUrl(item.blob, item.name);
            const messages = buildMessages({ ...audio, name: item.name });

            emit(AT_EVENTS.TRANSCRIBE_PROGRESS, { id: item.id, stage: 'sending' });
            const t0 = Date.now();
            const res = (await sendToLlm({ messages, model, language: params.language })) || {};
            const text = (res.content != null ? String(res.content) : '').trim();
            const latencyMs = res.latencyMs || (Date.now() - t0);
            const generationId = res.generationId || null;

            state.updateItem(item.id, {
                status: 'done', transcript: text, latencyMs,
                promptTokens: res.promptTokens, completionTokens: res.completionTokens,
                generationId,
                // Inline cost if the response carried it; otherwise resolved below.
                costUsd: (typeof res.responseCost === 'number' ? res.responseCost : undefined),
                costPending: !!(generationId && fetchCost),
            });
            emit(AT_EVENTS.TRANSCRIBE_COMPLETE, { id: item.id, model });

            // Exact charged cost is queryable a couple seconds later by generation
            // id. Fire-and-forget; only apply if this item still holds the same
            // generation (guards against a re-transcribe landing first).
            if (generationId && fetchCost) {
                Promise.resolve(fetchCost(generationId)).then((cost) => {
                    const cur = state.getRawItem(item.id);
                    if (cur && cur.generationId === generationId) {
                        state.updateItem(item.id, { costPending: false, ...(cost != null ? { costUsd: cost } : {}) });
                    }
                }).catch(() => {
                    const cur = state.getRawItem(item.id);
                    if (cur && cur.generationId === generationId) state.updateItem(item.id, { costPending: false });
                });
            }
            return { id: item.id, text, model, latencyMs, generationId };
        } catch (err) {
            state.updateItem(item.id, { status: 'error', error: err.message });
            emit(AT_EVENTS.TRANSCRIBE_ERROR, { id: item.id, error: err.message });
            throw err;
        }
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

    return { setModel, transcribeItem, getTranscript };
}
