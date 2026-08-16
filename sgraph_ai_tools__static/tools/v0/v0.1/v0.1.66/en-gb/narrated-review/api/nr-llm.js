/**
 * nr-llm.js
 * Isolated LLM transport for the CHAT lanes.
 *
 * Same one-cell-per-request isolation as core/sg-transcribe's llm-transport
 * (concurrent requests must never share a response listener), with the two
 * additions chat needs: `tools` are passed through on send, and `toolCalls`
 * are read back off the completion. Transcription keeps using the core
 * transport unchanged.
 *
 * @module nr-llm
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';
import { classifyLlmError } from '/core/sg-transcribe/v0/v0.1/v0.1.0/llm-errors.js';

/**
 * @param {Element} host           a container for the throwaway bus cells
 * @param {() => string} getApiKey
 * @returns {(req: { messages: object[], model: string, tools?: object[] }) => Promise<object>}
 */
export function makeChatTransport(host, getApiKey) {
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
            try { host.removeChild(cell); } catch (_) { /* */ }
        }
        const onComplete = (e) => {
            if (done) return; done = true;
            const d = e.detail || {};
            const raw = d.rawResponse || null;
            const usageCost = raw && raw.usage && typeof raw.usage.cost === 'number' ? raw.usage.cost : undefined;
            cleanup();
            resolve({
                content: d.content ?? '',
                toolCalls: Array.isArray(d.toolCalls) ? d.toolCalls : [],
                model: d.model,
                generationId: raw && raw.id ? raw.id : undefined,
                responseCost: usageCost != null ? usageCost : (typeof d.cost === 'number' && d.cost > 0 ? d.cost : undefined),
            });
        };
        const onError = (e) => {
            if (done) return; done = true; cleanup();
            const c = classifyLlmError(e.detail || {});
            reject(Object.assign(new Error(c.message), { code: c.code, status: c.status }));
        };
        cell.addEventListener(SGL_LLM.REQUEST_COMPLETE, onComplete);
        cell.addEventListener(SGL_LLM.REQUEST_ERROR, onError);

        cell.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
            detail: { provider: 'openrouter', model: req.model, apiKey: getApiKey() }, bubbles: true, composed: true }));
        cell.dispatchEvent(new CustomEvent(SGL_LLM.STREAMING_CHANGED, {
            detail: { streaming: false }, bubbles: true, composed: true }));
        cell.dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
            detail: { messages: req.messages, model: req.model, provider: 'openrouter', ...(req.tools ? { tools: req.tools } : {}) },
            bubbles: true, composed: true }));
    });
}
