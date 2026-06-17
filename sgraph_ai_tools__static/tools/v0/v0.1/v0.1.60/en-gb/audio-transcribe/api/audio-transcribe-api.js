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
import { makeIsolatedTransport } from './llm-transport.js';
import { encodeWav } from '/core/sg-tts-openrouter/v0/v0.1/v0.1.0/sg-tts-openrouter.js';
import { createLiveSession } from './live.js';
import { mountShell } from '../ui/ui-shell.js';

const passthrough = (p) => p;
const maskKey = (p = {}) => ({ ...p, apiKey: p.apiKey ? '••••' : p.apiKey });
const fileSanitiser = (p = {}) => ({
    ...p,
    files: (Array.isArray(p.files) || (p.files && typeof p.files.length === 'number'))
        ? `[${p.files.length} File(s)]` : p.files,
});

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
        version: { api: '0.1.26', ui: '0.1.26', content: '0.1.0' },
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

    /** Blob → base64 data URL (so an embedder can read the audio over the JS API). */
    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => reject(fr.error || new Error('read failed'));
            fr.readAsDataURL(blob);
        });
    }
    /**
     * Text-to-speech (local Kokoro or OpenRouter). Returns metadata; pass
     * { returnAudio: true } to also get the WAV as a base64 data URL (the
     * supported way for an embedder to obtain the audio over the JS API). An
     * { apiKey } param overrides the connected key.
     */
    async function ttsSynthesize(params = {}) {
        const r = await synthesize({ ...params, apiKey: params.apiKey || currentApiKey });
        const out = { mode: r.mode, durationMs: r.durationMs, sizeBytes: r.blob.size, mimeType: r.blob.type || 'audio/wav', generationId: r.generationId };
        if (params.returnAudio) out.audioDataUrl = await blobToDataUrl(r.blob);
        return out;
    }
    /** Synthesise speech and drop it into the queue (round-trip: synth → transcribe). */
    async function addSynthesized(params = {}) {
        const r = await synthesize({ ...params, apiKey: currentApiKey });
        const name = `${(params.name || 'voice-' + Date.now())}.wav`;
        return source.addFiles({ files: [new File([r.blob], name, { type: r.blob.type || 'audio/wav' })] });
    }

    // Headless chat: ask a question of the transcripts WITHOUT the UI. The system
    // prompt is built from the done transcripts (same context as the Chat tab);
    // returns the reply + generationId + usage so embedders can read cost. This
    // makes chat scriptable/embeddable, not UI-only (vault dev brief, Finding 5).
    const CHAT_MODEL_DEFAULT = 'google/gemini-3.5-flash';
    /**
     * @param {{ text: string, model?: string, context?: string }} params
     * @returns {Promise<{ text: string, model: string, generationId?: string, usage: object }>}
     */
    async function ask(params = {}) {
        const text = (params.text || '').trim();
        if (!text) throw Object.assign(new Error('ask requires { text }'), { code: 'no-text' });
        const model = params.model || CHAT_MODEL_DEFAULT;
        const ctx = params.context != null ? params.context : state.getItems()
            .filter((i) => i.status === 'done' && i.transcript)
            .map((it, i) => `### Transcript ${i + 1} — ${it.name}\n${it.transcript}`).join('\n\n');
        const messages = [];
        if (ctx) messages.push({ role: 'system', content: `You are answering questions about the following audio transcript(s).\n\n${ctx}` });
        messages.push({ role: 'user', content: text });
        const res = (await busTransport({ messages, model })) || {};
        return {
            text: (res.content != null ? String(res.content) : '').trim(), model,
            generationId: res.generationId,
            usage: { promptTokens: res.promptTokens, completionTokens: res.completionTokens, costUsd: (typeof res.responseCost === 'number' ? res.responseCost : undefined) },
        };
    }

    // ── Live (near-realtime) transcription ────────────────────────────────────
    // Each live poll re-sends the GROWING take, so every segment is a real,
    // separately-billed OpenRouter request. We surface each one (size, latency,
    // transcript, cost) on the LIVE_SEGMENT event AND in the Debug provenance log
    // (keyed by a per-run id + seq), and resolve the exact charged cost a couple
    // of seconds later by generation id — same as a normal transcription.
    let liveRunId = 0;
    function onLiveSegment(s) {
        emit(AT_EVENTS.LIVE_SEGMENT, s);
        const vid = `live-${liveRunId}-${s.seq}`;
        const costPending = !!(s.ok && s.generationId && typeof s.costUsd !== 'number');
        // Record live spend in state so it counts toward the session total AND the
        // spend cap (each delta + the final pass is a real billed request).
        const auxId = s.ok ? state.addAuxCost({ kind: 'live', usd: (typeof s.costUsd === 'number' ? s.costUsd : undefined), pending: costPending }) : null;
        recordExchange({
            ts: Date.now(), vid, kind: 'live', model: state.getActiveModel(),
            itemName: s.final ? '🔴 live · final' : `🔴 live · segment ${s.seq}`,
            status: s.ok ? 'done' : 'error', error: s.error,
            request: { kind: 'live', audio: { name: `live segment ${s.seq}`, mime: 'audio', sizeBytes: s.sizeBytes }, elapsedMs: s.elapsedMs },
            response: s.ok ? { content: s.text, promptTokens: s.promptTokens, completionTokens: s.completionTokens, latencyMs: s.latencyMs, generationId: s.generationId, costUsd: s.costUsd, costPending } : undefined,
        });
        if (costPending) {
            Promise.resolve(fetchGenerationCostDeferred(s.generationId, currentApiKey)).then((cost) => {
                if (auxId != null) state.updateAuxCost(auxId, { usd: (cost != null ? cost : undefined), pending: false });
                emit(AT_EVENTS.LIVE_SEGMENT, { ...s, costUsd: (cost != null ? cost : s.costUsd), costPending: false });
                recordExchange({ ts: Date.now(), vid, kind: 'live', model: state.getActiveModel(),
                    itemName: s.final ? '🔴 live · final' : `🔴 live · segment ${s.seq}`, status: 'done',
                    request: { kind: 'live', audio: { name: `live segment ${s.seq}`, mime: 'audio', sizeBytes: s.sizeBytes }, elapsedMs: s.elapsedMs },
                    response: { content: s.text, promptTokens: s.promptTokens, completionTokens: s.completionTokens, latencyMs: s.latencyMs, generationId: s.generationId, costUsd: (cost != null ? cost : s.costUsd), costPending: false } });
            }).catch(() => {});
        }
    }
    const live = createLiveSession({
        transcribe: (req) => transcribe.transcribeBlob(req),
        getModel: () => state.getActiveModel(),
        encodeWav,
        onUpdate: (u) => emit(AT_EVENTS.LIVE_UPDATE, u),
        onError: (err) => emit(AT_EVENTS.LIVE_ERROR, { error: err.message, code: err.code }),
        onSegment: onLiveSegment,
    });
    async function startLive(params = {}) {
        liveRunId += 1;
        try {
            const r = await live.start({ vad: params.vad });
            emit(AT_EVENTS.LIVE_STARTED, { mimeType: r.mimeType, sampleRate: r.sampleRate, vad: r.vad });
            return { live: true, mimeType: r.mimeType, sampleRate: r.sampleRate, vad: r.vad };
        } catch (err) {
            // Surface a clear event (e.g. mic-unavailable in a vault frame) rather
            // than only rejecting — embedders/UIs listen on at:live:error.
            emit(AT_EVENTS.LIVE_ERROR, { error: err.message, code: err.code });
            throw err;
        }
    }
    async function stopLive(params = {}) {
        const r = await live.stop(params.finalPass !== false);
        let id = null;
        if (r.blob && r.blob.size) {
            id = state.addItem(r.blob, { name: r.name, mimeType: r.mimeType, origin: 'recording', durationMs: r.durationMs });
            if (id && r.text) state.addVersion(id, { model: state.getActiveModel(), status: 'done', text: r.text });
            if (id) emit(AT_EVENTS.ITEM_ADDED, { id });
        }
        emit(AT_EVENTS.LIVE_STOPPED, { id, text: r.text });
        return { id, text: r.text, durationMs: r.durationMs };
    }

    api
        .register('startRecording', source.startRecording, { async: true,  sanitiseParams: passthrough })
        .register('stopRecording',  source.stopRecording,  { async: true,  sanitiseParams: passthrough })
        .register('addFiles',       source.addFiles,       { async: true,  sanitiseParams: fileSanitiser })
        .register('loadSample',     loadSample,            { async: true,  sanitiseParams: passthrough })
        .register('synthesize',     ttsSynthesize,         { async: true,  sanitiseParams: passthrough })
        .register('addSynthesized', addSynthesized,        { async: true,  sanitiseParams: passthrough })
        .register('ask',            ask,                   { async: true,  sanitiseParams: passthrough })
        .register('startLive',      startLive,             { async: true,  sanitiseParams: passthrough })
        .register('stopLive',       stopLive,              { async: true,  sanitiseParams: passthrough })
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
        .register('setSpendCap',    (p = {}) => { state.setSpendCap(p.usd != null ? p.usd : null); return { cap: state.getSpendCap() }; }, { async: false, sanitiseParams: passthrough })
        .register('transcribeAll',  batch.transcribeAll,   { async: true,  sanitiseParams: passthrough })
        .register('transcribe',     batch.transcribe,      { async: true,  sanitiseParams: passthrough })
        .register('getTranscript',  transcribe.getTranscript, { async: false, sanitiseParams: passthrough })
        .register('downloadZip',    send.downloadZip,      { async: true,  sanitiseParams: passthrough })
        .register('sendViaSgSend',  send.sendViaSgSend,    { async: true,  sanitiseParams: maskKey });

    api.activate();

    if (host) await mountShell({ host, state, api, getRecordingStream: source.getRecordingStream, getLiveStream: () => live.getStream(), getLiveLevel: () => live.getLevel(), getLiveThreshold: () => live.getThreshold() });

    return api;
}
