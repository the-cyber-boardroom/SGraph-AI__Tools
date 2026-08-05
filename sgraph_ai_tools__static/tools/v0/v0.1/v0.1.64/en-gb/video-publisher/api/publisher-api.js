/**
 * publisher-api.js
 * Entry point — registers SgToolApi, activates, then mounts the UI.
 * Every user-visible action has an API action; window.__tool is live as soon
 * as tool:ready fires.
 * @module publisher-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { listModels } from '/core/sg-transcribe/v0/v0.1/v0.1.0/audio-models.js';
import { VP_EVENTS } from './publisher-events.js';
import { state, itemStore } from './publisher-state.js';
import * as P  from './publisher-pipeline.js';
import * as YT from './publisher-youtube.js';
import { init as initShell } from '../ui/ui-shell.js';

const api = new SgToolApi({
    name:     'video-publisher',
    version:  { api: '0.1.0', ui: '0.1.0', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './skills/SKILL-human.md',
        browser: './skills/SKILL-browser.md',
        api:     './skills/SKILL-api.md',
    },
});

function emit(eventName, detail = {}) { api._emit(eventName, detail); }

P.boot({ emit });

// ── Method implementations ───────────────────────────────────────────────────

function getJob() {
    return {
        phase: state.phase, source: state.source, filename: state.filename,
        byteSize: state.videoBlob?.size || null, hasAudioBlob: !!state.audioBlob,
        steps: JSON.parse(JSON.stringify(state.steps)),
        audioRoute: state.audio?.route || null,
        transcriptChars: state.transcript?.length || null,
        metadata: { ...state.metadata },
        youtube: {
            connected: state.youtube.connected,
            expiresInMs: state.youtube.expiresAt ? state.youtube.expiresAt - Date.now() : null,
            channelTitle: state.youtube.channel?.title || null,
            uploadStatus: state.youtube.uploadStatus,
            uploadProgress: state.youtube.uploadProgress,
            lastUrl: state.youtube.lastUrl,
        },
        costs: P.getCostSummary(),
    };
}

api
    // Record (thin delegations to core/sg-recorder — SGA_RECORDER events fire unchanged)
    .register('setRecordConfig', (p = {}) => P.setRecordConfig(p),      { async: false })
    .register('getRecordConfig', () => P.getRecordConfig(),             { async: false })
    .register('startPreview',    async () => { await P.startPreview(); return { ok: true }; }, { async: true })
    .register('stopPreview',     () => { P.stopPreview(); return { ok: true }; },              { async: false })
    .register('startRecording',  async () => { await P.startRecording(); return { ok: true }; }, { async: true })
    .register('pauseRecording',  () => { P.pauseRecording(); return { ok: true }; },  { async: false })
    .register('resumeRecording', () => { P.resumeRecording(); return { ok: true }; }, { async: false })
    .register('stopRecording',   async () => await P.stopRecording(),   { async: true, events: [VP_EVENTS.JOB_LOADED] })
    // Source
    .register('importFile',   ({ file }) => P.importFile(file),         { async: false, events: [VP_EVENTS.JOB_LOADED] })
    .register('getJob',       getJob,                                   { async: false })
    .register('reset',        () => { P.reset(); return { ok: true }; },{ async: false, events: [VP_EVENTS.JOB_RESET] })
    .register('setAutoRun',   ({ enabled }) => { state.autoRun = !!enabled; return { autoRun: state.autoRun }; }, { async: false })
    // Audio
    .register('extractAudio', async () => await P.extractAudio(),       { async: true, events: [VP_EVENTS.AUDIO_START, VP_EVENTS.AUDIO_COMPLETE, VP_EVENTS.STEP_ERROR] })
    // Transcribe
    .register('transcribe',   async (p = {}) => await P.transcribe(p),  { async: true, events: [VP_EVENTS.TRANSCRIBE_START, VP_EVENTS.TRANSCRIBE_COMPLETE, VP_EVENTS.STEP_ERROR] })
    .register('getTranscript',() => ({ text: state.transcript }),       { async: false })
    .register('listModels',   () => listModels(),                       { async: false })
    .register('setApiKey',    ({ apiKey, model }) => {
        P.setApiKey(apiKey);
        if (model) itemStore.setActiveModel(model);
        return { ok: true };
    }, { async: false, sanitiseParams: p => ({ ...p, apiKey: '••••' }) })
    // Metadata
    .register('generateMetadata', async (p = {}) => await P.generateMetadata(p), { async: true, events: [VP_EVENTS.METADATA_START, VP_EVENTS.METADATA_COMPLETE, VP_EVENTS.STEP_ERROR] })
    .register('setMetadata',  (p = {}) => P.setMetadata(p),             { async: false })
    .register('getMetadata',  () => ({ ...state.metadata }),            { async: false })
    .register('getCostSummary', () => P.getCostSummary(),               { async: false })
    // Publish
    .register('setClientId',  ({ clientId }) => { YT.setClientId(clientId); return { clientId: YT.getClientId() }; },
        { async: false, sanitiseParams: p => ({ ...p, clientId: '••••' }) })
    .register('connectYouTube',    async (p = {}) => { await YT.connect({ ...p, emit }); return { ok: true }; },
        { async: true, events: [VP_EVENTS.YT_CONNECTED] })
    .register('disconnectYouTube', () => { YT.disconnect({ emit }); return { ok: true }; },
        { async: false, events: [VP_EVENTS.YT_DISCONNECTED] })
    .register('getMyChannel', async () => await YT.getMyChannel({ emit }), { async: true })
    .register('upload',       async () => await P.upload(),             { async: true, events: [VP_EVENTS.UPLOAD_START, VP_EVENTS.UPLOAD_PROGRESS, VP_EVENTS.UPLOAD_COMPLETE, VP_EVENTS.STEP_ERROR] })
    .register('publish',      async (p = {}) => await P.publish(p),     { async: true, events: [VP_EVENTS.UPLOAD_COMPLETE, VP_EVENTS.STEP_ERROR] })
    // Standard
    .register('getStatus',    getJob,                                   { async: false })
    .register('health',       () => ({
        ok: !state.lastError, phase: state.phase,
        keySet: !!P.getApiKey(), youtubeConnected: state.youtube.connected,
        clientIdSet: !!YT.getClientId(),
    }), { async: false });

api.activate();

await initShell(state, api, emit);
