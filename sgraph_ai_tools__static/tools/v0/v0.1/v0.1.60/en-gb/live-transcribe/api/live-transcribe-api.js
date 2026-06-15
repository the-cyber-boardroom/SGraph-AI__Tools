/**
 * live-transcribe-api — minimal "Live-first" tool entry (experience variation).
 *
 * A focused front-end for audio-transcribe's Live mode: one big button. It
 * REUSES the audio-transcribe api/ modules (state, the isolated transport, the
 * transcribe pipeline, the live session) and the ui-live panel — no Queue /
 * Bundle / Send / Voice / Chat. The point is to test the strategy brief's
 * "max-visibility, max-simplicity" thesis without duplicating the engine.
 *
 * @module live-transcribe/live-transcribe-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { createState } from '../../audio-transcribe/ui/state.js';
import { AT_EVENTS } from '../../audio-transcribe/api/audio-transcribe-events.js';
import { buildSourceMethods } from '../../audio-transcribe/api/api-source.js';
import { buildTranscribeMethods } from '../../audio-transcribe/api/api-transcribe.js';
import { buildBatchMethods } from '../../audio-transcribe/api/api-batch.js';
import { createLiveSession } from '../../audio-transcribe/api/live.js';
import { makeIsolatedTransport } from '../../audio-transcribe/api/llm-transport.js';
import { fetchGenerationCostDeferred } from '../../audio-transcribe/api/openrouter-cost.js';
import { DEFAULT_MODEL } from '../../audio-transcribe/api/audio-models.js';
import { mountLiveFirst } from '../ui/ui-live-first.js';

const passthrough = (p) => p;
const maskKey = (p = {}) => ({ ...p, apiKey: p.apiKey ? '••••' : p.apiKey });
const KEY_STORAGE = 'sg-openrouter-mgmt-key';

/**
 * Tool entry. Called by manifest-loader once all loader phases complete.
 * @returns {Promise<SgToolApi>}
 */
export async function init() {
    const state = createState({ defaultModel: DEFAULT_MODEL });
    state.setActiveModel(DEFAULT_MODEL);

    const api = new SgToolApi({
        name: 'live-transcribe',
        version: { api: '0.1.0', ui: '0.1.0', content: '0.1.0' },
        panelId: 'root',
        manifest: './manifest.json',
    });
    const emit = (name, detail) => api._emit(name, detail || {});
    const host = document.querySelector('#live-transcribe-root');

    let currentApiKey = '';
    let busTransport;
    if (host) { host.setAttribute('data-llm-bus', ''); busTransport = makeIsolatedTransport(host, () => currentApiKey); }
    else busTransport = async () => ({ content: '' });

    async function connect(params = {}) {
        currentApiKey = params.apiKey || '';
        state.setApiKeyPresent(!!currentApiKey);
        return { provider: 'openrouter', model: params.model || state.getActiveModel() };
    }
    async function setApiKey(params = {}) {
        const apiKey = params.apiKey || '';
        try { if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey); else localStorage.removeItem(KEY_STORAGE); } catch (_) { /* */ }
        await connect({ apiKey, model: params.model });
        return { ok: true, present: !!apiKey };
    }

    const source = buildSourceMethods({ state, emit });
    const transcribe = buildTranscribeMethods({
        state, emit, sendToLlm: busTransport, getActiveModel: () => state.getActiveModel(),
        fetchCost: (id) => fetchGenerationCostDeferred(id, currentApiKey),
    });
    const batch = buildBatchMethods({ state, emit, transcribeItem: transcribe.transcribeItem });

    // ── Live: each poll re-sends the growing take (a real billed request); show
    // the per-segment cost, resolved exactly by generation id a moment later. ──
    function onLiveSegment(s) {
        emit(AT_EVENTS.LIVE_SEGMENT, s);
        if (s.ok && s.generationId && typeof s.costUsd !== 'number') {
            Promise.resolve(fetchGenerationCostDeferred(s.generationId, currentApiKey)).then((cost) => {
                emit(AT_EVENTS.LIVE_SEGMENT, { ...s, costUsd: (cost != null ? cost : s.costUsd), costPending: false });
            }).catch(() => {});
        }
    }
    const live = createLiveSession({
        transcribe: (req) => transcribe.transcribeBlob(req),
        getModel: () => state.getActiveModel(),
        onUpdate: (u) => emit(AT_EVENTS.LIVE_UPDATE, u),
        onError: (err) => emit(AT_EVENTS.LIVE_ERROR, { error: err.message, code: err.code }),
        onSegment: onLiveSegment,
    });
    async function startLive() {
        try {
            const r = await live.start();
            emit(AT_EVENTS.LIVE_STARTED, { mimeType: r.mimeType });
            return { live: true, mimeType: r.mimeType };
        } catch (err) {
            emit(AT_EVENTS.LIVE_ERROR, { error: err.message, code: err.code });
            throw err;
        }
    }
    async function stopLive() {
        const r = await live.stop();
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
        .register('connect', connect, { async: true, sanitiseParams: maskKey })
        .register('setApiKey', setApiKey, { async: true, sanitiseParams: maskKey })
        .register('startLive', startLive, { async: true, sanitiseParams: passthrough })
        .register('stopLive', stopLive, { async: true, sanitiseParams: passthrough })
        .register('addFiles', source.addFiles, { async: true, sanitiseParams: passthrough })
        .register('getItems', source.getItems, { async: false, sanitiseParams: passthrough })
        .register('getItem', source.getItem, { async: false, sanitiseParams: passthrough })
        .register('getTranscript', transcribe.getTranscript, { async: false, sanitiseParams: passthrough })
        .register('transcribeAll', batch.transcribeAll, { async: true, sanitiseParams: passthrough })
        .register('getCostSummary', transcribe.getCostSummary, { async: false, sanitiseParams: passthrough });

    api.activate();

    // Restore a previously-saved key (shared with audio-transcribe) so the user
    // can start talking immediately if they've used either tool before.
    try { const k = localStorage.getItem(KEY_STORAGE); if (k) await connect({ apiKey: k }); } catch (_) { /* */ }

    if (host) mountLiveFirst({ host, state, api, getLiveStream: () => live.getStream() });
    return api;
}
