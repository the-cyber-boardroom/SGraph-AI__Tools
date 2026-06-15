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
import { AT_EVENTS } from './audio-transcribe-events.js';
import { buildSourceMethods } from './api-source.js';
import { buildTranscribeMethods } from './api-transcribe.js';
import { buildBatchMethods } from './api-batch.js';
import { buildSendMethods } from './api-send.js';
import { listModels, DEFAULT_MODEL } from './audio-models.js';
import { fetchGenerationCostDeferred } from './openrouter-cost.js';
import { RELEASES } from './releases.js';
import { buildSampleFile } from './samples.js';
import { synthesize } from './tts.js';
import { mountShell } from '../ui/ui-shell.js';

const passthrough = (p) => p;
const maskKey = (p = {}) => ({ ...p, apiKey: p.apiKey ? '••••' : p.apiKey });
const fileSanitiser = (p = {}) => ({
    ...p,
    files: (Array.isArray(p.files) || (p.files && typeof p.files.length === 'number'))
        ? `[${p.files.length} File(s)]` : p.files,
});

/** Map a request-complete event detail into our transport result shape. */
function readComplete(e) {
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
 * Isolated LLM transport: EACH request gets its own throwaway `[data-llm-bus]`
 * cell + a fresh `<sg-llm-request>`, so concurrent requests never share a
 * response listener (this is what makes parallel multi-model transcription safe
 * — the shared-bus version cross-talked, giving two files the same transcript).
 * The cell is configured (key + model + non-streaming) and torn down per call.
 *
 * @param {Element} host      the [data-llm-bus] host to attach cells under
 * @param {() => string} getApiKey
 * @returns {(req: { messages: object[], model: string }) => Promise<object>}
 */
function makeIsolatedTransport(host, getApiKey) {
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
        const onError = (e) => { if (done) return; done = true; cleanup(); reject(Object.assign(
            new Error((e.detail && e.detail.error) || 'LLM request failed'), { code: 'llm-error' })); };
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
        version: { api: '0.1.11', ui: '0.1.11', content: '0.1.0' },
        panelId: 'root',
        manifest: './manifest.json',
        skills: (manifest && manifest.skills) || {},
    });
    const emit = (name, detail) => api._emit(name, detail || {});

    const host = document.querySelector('#audio-transcribe-root');

    // The OpenRouter key, kept here for the isolated transport + cost lookups.
    let currentApiKey = '';

    // Transport: each request runs on its own isolated [data-llm-bus] cell (see
    // makeIsolatedTransport) so parallel multi-model transcriptions can't
    // cross-talk. The host still carries [data-llm-bus] so the cost component
    // (sg-openrouter-key-stats) and connect()'s llm:connected resolve there.
    let busTransport;
    if (host) {
        host.setAttribute('data-llm-bus', '');
        busTransport = makeIsolatedTransport(host, () => currentApiKey);
    } else {
        // Headless fallback (shouldn't happen in the page).
        busTransport = async () => ({ content: '' });
    }

    // Connect: announce the OpenRouter key + model on the host bus (the cost
    // component listens here). The key is also kept for cost lookups.
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

    // Programmatic key config (for agentic / headless callers). Persists to the
    // same localStorage key the UI uses, then connects.
    const KEY_STORAGE = 'sg-openrouter-mgmt-key';
    /**
     * @param {{ apiKey: string, model?: string }} params
     * @returns {Promise<{ ok: true, present: boolean, model: string }>}
     */
    async function setApiKey(params = {}) {
        const apiKey = params.apiKey || '';
        try { if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey); else localStorage.removeItem(KEY_STORAGE); } catch (_) { /* storage may be unavailable */ }
        const r = await connect({ apiKey, model: params.model });
        return { ok: true, present: !!apiKey, model: r.model };
    }

    // Provenance log: one record per LLM exchange (newest first), keyed by vid so
    // the 'pending' entry logged at request time is updated in place on resolve.
    const exchanges = [];
    const recordExchange = (x) => {
        const i = x.vid ? exchanges.findIndex((e) => e.vid === x.vid) : -1;
        let rec;
        if (i >= 0) { rec = { ...exchanges[i], ...x }; exchanges[i] = rec; }
        else { rec = x; exchanges.unshift(rec); if (exchanges.length > 100) exchanges.length = 100; }
        emit(AT_EVENTS.LLM_EXCHANGE, rec);
    };

    const source = buildSourceMethods({ state, emit });
    const transcribe = buildTranscribeMethods({
        state, emit, sendToLlm: busTransport, getActiveModel: () => state.getActiveModel(),
        fetchCost: (genId) => fetchGenerationCostDeferred(genId, currentApiKey),
        onExchange: recordExchange,
    });
    const batch = buildBatchMethods({ state, emit, transcribeItem: transcribe.transcribeItem });
    const send = buildSendMethods({
        state, emit,
        getDropper: () => host && host.querySelector('sg-send-drop'),
    });

    /** Load a built-in sample audio as a queue item (simulates a drop). */
    async function loadSample(params = {}) {
        const file = await buildSampleFile(params.id);
        return source.addFiles({ files: [file] });
    }

    /** Text-to-speech (local Kokoro or OpenRouter). Returns metadata (no blob). */
    async function ttsSynthesize(params = {}) {
        const r = await synthesize({ ...params, apiKey: currentApiKey });
        return { mode: r.mode, durationMs: r.durationMs, sizeBytes: r.blob.size, generationId: r.generationId };
    }
    /** Synthesise speech and drop it into the queue (round-trip: synth → transcribe). */
    async function addSynthesized(params = {}) {
        const r = await synthesize({ ...params, apiKey: currentApiKey });
        const name = `${(params.name || 'voice-' + Date.now())}.wav`;
        return source.addFiles({ files: [new File([r.blob], name, { type: r.blob.type || 'audio/wav' })] });
    }

    api
        .register('startRecording', source.startRecording, { async: true,  sanitiseParams: passthrough })
        .register('stopRecording',  source.stopRecording,  { async: true,  sanitiseParams: passthrough })
        .register('addFiles',       source.addFiles,       { async: true,  sanitiseParams: fileSanitiser })
        .register('loadSample',     loadSample,            { async: true,  sanitiseParams: passthrough })
        .register('synthesize',     ttsSynthesize,         { async: true,  sanitiseParams: passthrough })
        .register('addSynthesized', addSynthesized,        { async: true,  sanitiseParams: passthrough })
        .register('getItems',       source.getItems,       { async: false, sanitiseParams: passthrough })
        .register('getItem',        source.getItem,        { async: false, sanitiseParams: passthrough })
        .register('removeItem',     source.removeItem,     { async: false, sanitiseParams: passthrough })
        .register('clearAll',       source.clearAll,       { async: false, sanitiseParams: passthrough })
        .register('listModels',     () => listModels(),    { async: false, sanitiseParams: passthrough })
        .register('getReleases',    () => RELEASES.map((r) => ({ ...r, changes: [...r.changes] })), { async: false, sanitiseParams: passthrough })
        .register('setModel',       transcribe.setModel,   { async: false, sanitiseParams: passthrough })
        .register('connect',        connect,               { async: true,  sanitiseParams: maskKey })
        .register('setApiKey',      setApiKey,             { async: true,  sanitiseParams: maskKey })
        .register('getExchanges',   () => exchanges.slice(0, 50), { async: false, sanitiseParams: passthrough })
        .register('transcribeItem', transcribe.transcribeItem, { async: true, sanitiseParams: passthrough })
        .register('cancelItem',     transcribe.cancelItem,     { async: false, sanitiseParams: passthrough })
        .register('transcribeModels', transcribe.transcribeModels, { async: true, sanitiseParams: passthrough })
        .register('getCostSummary', transcribe.getCostSummary, { async: false, sanitiseParams: passthrough })
        .register('transcribeAll',  batch.transcribeAll,   { async: true,  sanitiseParams: passthrough })
        .register('transcribe',     batch.transcribe,      { async: true,  sanitiseParams: passthrough })
        .register('getTranscript',  transcribe.getTranscript, { async: false, sanitiseParams: passthrough })
        .register('downloadZip',    send.downloadZip,      { async: true,  sanitiseParams: passthrough })
        .register('sendViaSgSend',  send.sendViaSgSend,    { async: true,  sanitiseParams: maskKey });

    api.activate();

    if (host) await mountShell({ host, state, api, getRecordingStream: source.getRecordingStream });

    return api;
}
