/**
 * audio-transcribe-api — tool entry.
 *
 * Builds the queue state, wires the source/transcribe/batch/send method groups,
 * registers all SgToolApi actions, calls activate() (publishes window.__tool,
 * fires tool:ready), then mounts the UI shell.
 *
 * Loaded as the `entry: true` phase-3 script by manifest-loader.
 *
 * @module audio-transcribe/audio-transcribe-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';
import { createState } from '../ui/state.js';
import { buildSourceMethods } from './api-source.js';
import { buildTranscribeMethods } from './api-transcribe.js';
import { buildBatchMethods } from './api-batch.js';
import { buildSendMethods } from './api-send.js';
import { listModels, DEFAULT_MODEL } from './audio-models.js';
import { fetchGenerationCostDeferred } from './openrouter-cost.js';
import { RELEASES } from './releases.js';
import { mountShell } from '../ui/ui-shell.js';

const passthrough = (p) => p;
const maskKey = (p = {}) => ({ ...p, apiKey: p.apiKey ? '••••' : p.apiKey });
const fileSanitiser = (p = {}) => ({
    ...p,
    files: (Array.isArray(p.files) || (p.files && typeof p.files.length === 'number'))
        ? `[${p.files.length} File(s)]` : p.files,
});

/**
 * Create a DOM-bus LLM transport: fires `llm:send` on the bus element and
 * resolves on `llm:request-complete` / rejects on `llm:request-error`.
 * @param {Element} bus
 * @returns {(req: { messages: object[], model: string }) => Promise<{ content: string, latencyMs?: number, model?: string }>}
 */
function makeBusTransport(bus) {
    return (req) => new Promise((resolve, reject) => {
        const onComplete = (e) => {
            cleanup();
            const d = e.detail || {};
            const raw = d.rawResponse || null;
            const usageCost = raw && raw.usage && typeof raw.usage.cost === 'number' ? raw.usage.cost : undefined;
            resolve({
                content: d.content ?? '', latencyMs: d.latencyMs, model: d.model,
                promptTokens: d.promptTokens, completionTokens: d.completionTokens,
                generationId: raw && raw.id ? raw.id : undefined,
                // Inline cost only if the response actually carried one (>0).
                responseCost: usageCost != null ? usageCost : (typeof d.cost === 'number' && d.cost > 0 ? d.cost : undefined),
            });
        };
        const onError = (e) => { cleanup(); reject(Object.assign(
            new Error((e.detail && e.detail.error) || 'LLM request failed'), { code: 'llm-error' })); };
        function cleanup() {
            bus.removeEventListener(SGL_LLM.REQUEST_COMPLETE, onComplete);
            bus.removeEventListener(SGL_LLM.REQUEST_ERROR, onError);
        }
        bus.addEventListener(SGL_LLM.REQUEST_COMPLETE, onComplete);
        bus.addEventListener(SGL_LLM.REQUEST_ERROR, onError);
        bus.dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
            detail: { messages: req.messages, model: req.model, provider: 'openrouter' },
            bubbles: true, composed: true,
        }));
    });
}

/**
 * Tool entry. Called by manifest-loader once all loader phases complete.
 * @param {object} manifest
 * @returns {Promise<SgToolApi>}
 */
export async function init(manifest) {
    const state = createState({ defaultModel: DEFAULT_MODEL });
    state.setActiveModel(DEFAULT_MODEL);

    const api = new SgToolApi({
        name: 'audio-transcribe',
        version: { api: '0.1.3', ui: '0.1.3', content: '0.1.0' },
        panelId: 'root',
        manifest: './manifest.json',
        skills: (manifest && manifest.skills) || {},
    });
    const emit = (name, detail) => api._emit(name, detail || {});

    const host = document.querySelector('#audio-transcribe-root');

    // The LLM bus: <sg-llm-request> dispatches/listens on the nearest ancestor
    // with [data-llm-bus]. Mark the host as the bus and mount the engine there.
    let busTransport;
    let llmRequest = null;
    if (host) {
        host.setAttribute('data-llm-bus', '');
        llmRequest = document.createElement('sg-llm-request');
        host.appendChild(llmRequest);
        // Non-streaming so request-complete carries the full rawResponse (and its
        // generation id), which we need for per-item cost.
        host.dispatchEvent(new CustomEvent(SGL_LLM.STREAMING_CHANGED, {
            detail: { streaming: false }, bubbles: true, composed: true,
        }));
        busTransport = makeBusTransport(host);
    } else {
        // Headless fallback (shouldn't happen in the page).
        busTransport = async () => ({ content: '' });
    }

    // Connect: prime <sg-llm-request> with the OpenRouter key + model. The key is
    // also kept here so per-item cost can be looked up by generation id.
    let currentApiKey = '';
    /**
     * @param {{ apiKey: string, model?: string }} params
     * @returns {Promise<{ provider: 'openrouter', model: string }>}
     */
    async function connect(params = {}) {
        const model = params.model || state.getActiveModel();
        currentApiKey = params.apiKey || '';
        if (host) {
            host.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
                detail: { provider: 'openrouter', model, apiKey: currentApiKey },
                bubbles: true, composed: true,
            }));
        }
        state.setApiKeyPresent(!!params.apiKey);
        return { provider: 'openrouter', model };
    }

    const source = buildSourceMethods({ state, emit });
    const transcribe = buildTranscribeMethods({
        state, emit, sendToLlm: busTransport, getActiveModel: () => state.getActiveModel(),
        fetchCost: (genId) => fetchGenerationCostDeferred(genId, currentApiKey),
    });
    const batch = buildBatchMethods({ state, emit, transcribeItem: transcribe.transcribeItem });
    const send = buildSendMethods({
        state, emit,
        getDropper: () => host && host.querySelector('sg-send-drop'),
    });

    api
        .register('startRecording', source.startRecording, { async: true,  sanitiseParams: passthrough })
        .register('stopRecording',  source.stopRecording,  { async: true,  sanitiseParams: passthrough })
        .register('addFiles',       source.addFiles,       { async: true,  sanitiseParams: fileSanitiser })
        .register('getItems',       source.getItems,       { async: false, sanitiseParams: passthrough })
        .register('getItem',        source.getItem,        { async: false, sanitiseParams: passthrough })
        .register('removeItem',     source.removeItem,     { async: false, sanitiseParams: passthrough })
        .register('clearAll',       source.clearAll,       { async: false, sanitiseParams: passthrough })
        .register('listModels',     () => listModels(),    { async: false, sanitiseParams: passthrough })
        .register('getReleases',    () => RELEASES.map((r) => ({ ...r, changes: [...r.changes] })), { async: false, sanitiseParams: passthrough })
        .register('setModel',       transcribe.setModel,   { async: false, sanitiseParams: passthrough })
        .register('connect',        connect,               { async: true,  sanitiseParams: maskKey })
        .register('transcribeItem', transcribe.transcribeItem, { async: true, sanitiseParams: passthrough })
        .register('transcribeAll',  batch.transcribeAll,   { async: true,  sanitiseParams: passthrough })
        .register('transcribe',     batch.transcribe,      { async: true,  sanitiseParams: passthrough })
        .register('getTranscript',  transcribe.getTranscript, { async: false, sanitiseParams: passthrough })
        .register('downloadZip',    send.downloadZip,      { async: true,  sanitiseParams: passthrough })
        .register('sendViaSgSend',  send.sendViaSgSend,    { async: true,  sanitiseParams: maskKey });

    api.activate();

    if (host) await mountShell({ host, state, api });

    return api;
}
