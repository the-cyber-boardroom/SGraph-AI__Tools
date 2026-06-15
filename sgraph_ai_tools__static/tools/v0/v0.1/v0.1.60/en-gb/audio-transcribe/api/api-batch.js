/**
 * api-batch — batch transcription orchestrator.
 *
 * Transcribes every `queued`/`error` item via the injected `transcribeItem`
 * (from api-transcribe), so retry and the per-row pipeline share one code path.
 *
 * Concurrency defaults to 1 (serial) to be gentle on OpenRouter rate limits —
 * NOT for correctness. As of v0.1.5 the transport is isolated (each request gets
 * its own <sg-llm-request>), so running in parallel no longer cross-talks; a
 * caller can raise the cap via `transcribeAll({ concurrency })`.
 *
 * (History: pre-0.1.5 a single shared <sg-llm-request> dropped a second
 * concurrent send via its _busy guard while BOTH waiting promises resolved on
 * the one response — so two files got the same transcript and only ONE
 * /chat/completions request fired. The isolated transport fixes that root cause.)
 *
 * @module audio-transcribe/api-batch
 */

import { AT_EVENTS } from './audio-transcribe-events.js';

/** Default concurrency cap (serial by default for rate-limit friendliness; safe to raise since v0.1.5). */
export const DEFAULT_CONCURRENCY = 1;

/**
 * Build the batch methods.
 *
 * @param {object} ctx
 * @param {object} ctx.state
 * @param {(name: string, detail?: object) => void} ctx.emit
 * @param {(params: { id: string, model?: string, language?: string }) => Promise<object>} ctx.transcribeItem
 * @returns {{ transcribeAll: Function, transcribe: Function }}
 */
export function buildBatchMethods({ state, emit, transcribeItem }) {
    /**
     * Transcribe every queued/error item with a concurrency cap.
     * @param {{ model?: string, language?: string, concurrency?: number }} [params]
     * @returns {Promise<{ total: number, done: number, errors: Array<{ id: string, code: string }> }>}
     */
    async function transcribeAll(params = {}) {
        const pending = state.getItems()
            .filter((it) => it.status === 'queued' || it.status === 'error')
            .map((it) => it.id);

        const total = pending.length;
        const errors = [];
        let done = 0;

        emit(AT_EVENTS.BATCH_STARTED, { total });
        if (total === 0) {
            emit(AT_EVENTS.BATCH_COMPLETE, { done, total, errors });
            return { total, done, errors };
        }

        const cap = Math.max(1, Number(params.concurrency) || DEFAULT_CONCURRENCY);
        let cursor = 0;

        async function worker() {
            while (cursor < pending.length) {
                const id = pending[cursor++];
                try {
                    await transcribeItem({ id, model: params.model, language: params.language });
                } catch (err) {
                    errors.push({ id, code: err.code || 'error' });
                }
                done += 1;
                emit(AT_EVENTS.BATCH_PROGRESS, { done, total });
            }
        }

        const workers = [];
        for (let i = 0; i < Math.min(cap, total); i++) workers.push(worker());
        await Promise.all(workers);

        emit(AT_EVENTS.BATCH_COMPLETE, { done, total, errors });
        return { total, done, errors };
    }

    /**
     * Convenience alias for transcribeAll. If exactly one item exists it still
     * behaves like a single-item transcribe (it's the only pending row).
     * @param {{ model?: string, language?: string }} [params]
     * @returns {Promise<{ total: number, done: number, errors: object[] }>}
     */
    async function transcribe(params = {}) {
        return transcribeAll(params);
    }

    return { transcribeAll, transcribe };
}
