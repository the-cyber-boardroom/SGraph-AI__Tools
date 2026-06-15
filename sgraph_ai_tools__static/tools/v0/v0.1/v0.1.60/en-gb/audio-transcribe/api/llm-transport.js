/**
 * llm-transport — the isolated per-request OpenRouter transport (shared).
 *
 * EACH request gets its own throwaway `[data-llm-bus]` cell + a fresh
 * `<sg-llm-request>`, so concurrent requests never share a response listener
 * (the shared-bus version cross-talked, giving two files the same transcript).
 * The cell is configured (key + model + non-streaming) and torn down per call.
 * Errors are classified into typed codes from the HTTP status.
 *
 * Extracted from the audio-transcribe entry so the Live-first variation reuses
 * the exact same transport (no duplication / no drift).
 *
 * @module audio-transcribe/llm-transport
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';
import { classifyLlmError } from './llm-errors.js';

/** Map a request-complete event detail into our transport result shape. */
export function readComplete(e) {
    const d = e.detail || {};
    const raw = d.rawResponse || null;
    const usageCost = raw && raw.usage && typeof raw.usage.cost === 'number' ? raw.usage.cost : undefined;
    return {
        content: d.content ?? '', latencyMs: d.latencyMs, model: d.model,
        promptTokens: d.promptTokens, completionTokens: d.completionTokens,
        generationId: raw && raw.id ? raw.id : undefined,
        // Inline cost only if the response actually carried one (>0).
        responseCost: usageCost != null ? usageCost : (typeof d.cost === 'number' && d.cost > 0 ? d.cost : undefined),
        raw, // full OpenRouter response, for the provenance panel
    };
}

/**
 * @param {Element} host      the [data-llm-bus] host to attach cells under
 * @param {() => string} getApiKey
 * @returns {(req: { messages: object[], model: string, registerCancel?: Function }) => Promise<object>}
 */
export function makeIsolatedTransport(host, getApiKey) {
    return (req) => new Promise((resolve, reject) => {
        const cell = document.createElement('div');
        cell.setAttribute('data-llm-bus', '');
        cell.style.display = 'none';
        host.appendChild(cell);
        const engine = document.createElement('sg-llm-request');
        cell.appendChild(engine);

        let done = false;
        function cleanup() {
            cell.removeEventListener(SGL_LLM.REQUEST_COMPLETE, onComplete);
            cell.removeEventListener(SGL_LLM.REQUEST_ERROR, onError);
            cell.removeEventListener(SGL_LLM.REQUEST_CANCEL, onCancel);
            try { host.removeChild(cell); } catch (_) { /* */ }
        }
        const onComplete = (e) => { if (done) return; done = true; const r = readComplete(e); cleanup(); resolve(r); };
        const onError = (e) => {
            if (done) return; done = true; cleanup();
            // Typed error from the HTTP status (key-invalid / budget-exceeded /
            // key-exhausted / rate-limited) so embedders can react to a spent
            // SG-API secret instead of seeing a generic failure. (Vault brief F7.)
            const c = classifyLlmError(e.detail || {});
            reject(Object.assign(new Error(c.message), { code: c.code, status: c.status, bodyError: (e.detail && e.detail.bodyError) || '' }));
        };
        const onCancel = () => { if (done) return; done = true; cleanup(); reject(Object.assign(new Error('Cancelled'), { code: 'cancelled' })); };
        cell.addEventListener(SGL_LLM.REQUEST_COMPLETE, onComplete);
        cell.addEventListener(SGL_LLM.REQUEST_ERROR, onError);
        cell.addEventListener(SGL_LLM.REQUEST_CANCEL, onCancel);

        // Let the caller cancel this in-flight request (aborts the fetch).
        if (typeof req.registerCancel === 'function') {
            req.registerCancel(() => { if (!done) cell.dispatchEvent(new CustomEvent(SGL_LLM.CANCEL, { detail: {}, bubbles: true, composed: true })); });
        }

        // Configure this isolated engine, then send. Non-streaming so the
        // response carries the full rawResponse (generation id + usage).
        cell.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, { detail: { provider: 'openrouter', model: req.model, apiKey: getApiKey() }, bubbles: true, composed: true }));
        cell.dispatchEvent(new CustomEvent(SGL_LLM.STREAMING_CHANGED, { detail: { streaming: false }, bubbles: true, composed: true }));
        cell.dispatchEvent(new CustomEvent(SGL_LLM.SEND, { detail: { messages: req.messages, model: req.model, provider: 'openrouter' }, bubbles: true, composed: true }));
    });
}
