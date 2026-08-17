/**
 * nr-api.js
 * Entry point — registers SgToolApi, activates (JS-API-first: window.__tool is
 * live from tool:ready, BEFORE the UI mounts), then hands off to the shell.
 *
 * @module nr-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { NR_EVENTS } from './nr-events.js';
import { state, config, loadConfig, saveConfig, getPairById, pairToJson, sessionToJson, costSummary } from './nr-state.js';
import * as Cap from './nr-capture.js';
import { buildMarker } from './nr-marker.js';
import * as Pipe from './nr-pipeline.js';
import { buildDocument } from './nr-document.js';
import { buildSessionZip, downloadBlob } from './nr-zip.js';
import { buildEditMethods } from './nr-edit.js';
import { buildChatMethods } from './nr-chat.js';
import { makeChatTransport } from './nr-llm.js';
import { saveToVault as vaultSave, buildVaultFiles } from './nr-vault.js';
import { buildPdf } from './nr-pdf.js';
import * as Store from './nr-store.js';
import * as Video from './nr-video.js';
import * as Billing from './nr-billing.js';
import { init as initShell } from '../ui/ui-shell.js';

const api = new SgToolApi({
    name:     'narrated-review',
    version:  { api: '0.1.0', ui: '0.1.0', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './skills/SKILL-human.md',
        browser: './skills/SKILL-browser.md',
        api:     './skills/SKILL-api.md',
    },
});

function emit(name, detail = {}) { api._emit(name, detail); }

loadConfig();
Billing.initBilling({ emit, getApiKey: Pipe.getApiKey });
Pipe.initPipeline({ emit });
Cap.onSuggestion(t => emit(NR_EVENTS.SUGGESTION, { t }));

let lastDocument = null;

// Structural edits (notes / reorder / insert) live in nr-edit.
const edit = buildEditMethods({ emit });

// Chat gets its own isolated transport: same one-cell-per-request isolation as
// transcription, plus tool-calling.
const chatHost = document.createElement('div');
chatHost.style.display = 'none';
document.body.appendChild(chatHost);
const chatTransport = Billing.billed(makeChatTransport(chatHost, Pipe.getApiKey), { scope: 'chat' });

// A newly bounded pair transcribes immediately (streams to raw mid-capture).
const marker = buildMarker({
    emit,
    onPairBounded(pair) {
        if (!Pipe.getApiKey()) return;                         // capture works keyless
        Pipe.transcribePair({ id: pair.id }).catch(() => {});  // errors land on the pair + events
    },
});

// ── Session lifecycle ────────────────────────────────────────────────────────

async function startSession(p = {}) {
    if (state.status === 'capturing') throw Object.assign(new Error('Session already capturing'), { code: 'no-session' });
    if (p.cleanup) setCleanupMode({ mode: p.cleanup });
    state.reset();
    const started = await Cap.startCapture();                  // gesture: screen picker + mic
    state.sessionId = `nr-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`;
    state.startedAt = Date.now();
    state.status = 'capturing';
    state.screen = started.screen;
    state.takeSource = 'live';
    emit(NR_EVENTS.SESSION_STARTED, { screen: started.screen, sampleRate: started.sampleRate, mimeType: started.mimeType });
    // Capture 1 opens with the screen as shared — see startFirstCapture.
    const first = await marker.startFirstCapture();
    return { sessionId: state.sessionId, screen: started.screen, mimeType: started.mimeType, firstCapture: first.id };
}

async function endSession() {
    if (state.status !== 'capturing') throw Object.assign(new Error('No live session'), { code: 'no-session' });
    state.durationMs = Cap.nowMs();
    marker.closeLastPair(state.durationMs);
    state.take = await Cap.stopCapture();
    state.status = 'reviewing';
    emit(NR_EVENTS.SESSION_ENDED, {
        pairs: state.pairs.length, durationMs: state.durationMs,
        takeSizeBytes: state.take ? state.take.blob.size : 0,
    });
    // Auto-run the two lanes in the background; explicit calls are idempotent.
    // The receipts are swept once the lanes settle — that is the "a bit later"
    // the generation endpoint needs.
    if (Pipe.getApiKey()) {
        Pipe.transcribeAll()
            .then(() => (config.cleanup !== 'off' ? Pipe.cleanAll() : null))
            .then(settleBilling)
            .catch(() => {});
    }
    return { pairs: state.pairs.length, durationMs: state.durationMs, takeSizeBytes: state.take ? state.take.blob.size : 0 };
}

async function addRecording(p = {}) {
    const file = p.file;
    if (!file || typeof file.arrayBuffer !== 'function') throw Object.assign(new Error('addRecording needs { file }'), { code: 'bad-params' });
    state.reset();
    const info = await Cap.importRecording(file);
    state.sessionId = `nr-import-${Math.random().toString(36).slice(2, 6)}`;
    state.startedAt = Date.now();
    state.status = 'reviewing';
    state.durationMs = info.durationMs;
    state.take = { blob: file, mimeType: file.type || 'audio/wav' };
    state.takeSource = 'import';
    return { durationMs: info.durationMs, sampleRate: info.sampleRate };
}

/**
 * Third ingest path: a recording instead of a live share.
 *
 * Once this returns, the captures are ordinary captures — the same lanes,
 * editing, chat, document and exports apply, and the two lanes auto-run exactly
 * as they do after endSession().
 */
async function importVideo(p = {}) {
    const out = await Video.importVideo(p, emit, marker);
    if (Pipe.getApiKey()) {
        Pipe.transcribeAll()
            .then(() => (config.cleanup !== 'off' ? Pipe.cleanAll() : null))
            .then(settleBilling)
            .catch(() => {});
    }
    return out;
}

function resetAll() {
    Cap.clearCapture();
    Video.clearVideo();
    state.reset();
    lastDocument = null;
    emit(NR_EVENTS.RESET, {});
    return { ok: true };
}

// ── Pairs ────────────────────────────────────────────────────────────────────

function setBoundary(p = {}) {
    const pair = getPairById(p.id);
    if (!pair) throw Object.assign(new Error(`Unknown pair: ${p.id}`), { code: 'unknown-pair' });
    if (typeof p.tStart === 'number') pair.tStart = Math.max(0, p.tStart);
    if (typeof p.tEnd === 'number') pair.tEnd = Math.max(pair.tStart + 100, p.tEnd);
    pair.stale = true;                                         // transcript no longer matches bounds
    emit(NR_EVENTS.PAIR_UPDATED, { id: pair.id, field: 'bounds' });
    return pairToJson(pair);
}

function setText(p = {}) {
    const pair = getPairById(p.id);
    if (!pair) throw Object.assign(new Error(`Unknown pair: ${p.id}`), { code: 'unknown-pair' });
    if (typeof p.text !== 'string') throw Object.assign(new Error('setText needs { text }'), { code: 'bad-params' });
    // Edits touch CLEAN only — raw is immutable (Decision 6).
    pair.clean = pair.clean
        ? { ...pair.clean, text: p.text, edited: true }
        : { text: p.text, marks: [], model: 'human-edit', generationId: null, costUsd: null, edited: true };
    if (pair.status === 'raw') pair.status = 'clean';
    emit(NR_EVENTS.PAIR_UPDATED, { id: pair.id, field: 'clean' });
    return pairToJson(pair);
}

function removePair(p = {}) {
    const i = state.pairs.findIndex(x => x.id === p.id);
    if (i < 0) throw Object.assign(new Error(`Unknown pair: ${p.id}`), { code: 'unknown-pair' });
    state.pairs.splice(i, 1);
    emit(NR_EVENTS.PAIR_REMOVED, { id: p.id });
    return { removed: p.id };
}

async function getPairImage(p = {}) {
    const pair = getPairById(p.id);
    if (!pair) throw Object.assign(new Error(`Unknown pair: ${p.id}`), { code: 'unknown-pair' });
    if (!pair.screenshot) return { dataUrl: null };
    const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(pair.screenshot);
    });
    return { dataUrl };
}

const chat = buildChatMethods({
    transport: chatTransport,
    getModel: () => config.cleanupModel || config.transcribeModel || 'google/gemini-3.5-flash',
    edit, setText, emit,
});

// ── Document & export ────────────────────────────────────────────────────────

function buildDoc() {
    const doc = buildDocument(state, state.pairs);
    lastDocument = doc;
    emit(NR_EVENTS.DOCUMENT_BUILT, { pairs: state.pairs.length, bytes: doc.markdown.length });
    return { markdown: doc.markdown, images: doc.images };
}

async function downloadPdf(p = {}) {
    const { blob, name, pages } = await buildPdf(p);
    downloadBlob(blob, name);
    emit(NR_EVENTS.PDF_CREATED, { name, pages, bytes: blob.size });
    return { name, pages, bytes: blob.size };
}

/** Write the whole session into an SG/Send vault (audio optional). */
async function saveToVault(p = {}) {
    if (p.billing !== false) await settleBilling();
    return vaultSave(p, emit, Pipe.pairWav);
}

/**
 * Sweep for any receipts we do not have yet, without ever blocking the caller.
 *
 * Exports run through this so the spend record travels with the artefact, but an
 * export must not fail — or hang — because a billing lookup did. A missing
 * receipt is not a missing record: the generation ids are already in the ledger.
 */
async function settleBilling() {
    if (!state.billing.some(e => !e.data) || !Pipe.getApiKey()) return;
    await Billing.fetchBilling({ delayMs: 1200, retries: 1 }).catch(() => {});
}

async function downloadZip(p = {}) {
    if (p.billing !== false) await settleBilling();
    const { blob, name, count } = await buildSessionZip({ include: p.include });
    downloadBlob(blob, name);
    emit(NR_EVENTS.BUNDLE_CREATED, { zipSize: blob.size, name });
    return { name, zipSize: blob.size, count };
}

// ── Saved sessions (survive a reload — editing work is not re-derivable) ─────

const saveSession   = (p = {}) => Store.saveSession(p, emit);
const listSessions  = ()       => Store.listSessions();
const loadSession   = (p = {}) => Store.loadSession(p, emit);
const deleteSession = (p = {}) => Store.deleteSession(p, emit);

// ── Config & cost ────────────────────────────────────────────────────────────

function setCleanupMode(p = {}) {
    const mode = p.mode;
    if (!['grounded', 'text-only', 'off'].includes(mode)) throw Object.assign(new Error("mode must be 'grounded'|'text-only'|'off'"), { code: 'bad-params' });
    config.cleanup = mode; saveConfig();
    return { mode };
}

/**
 * Tune boundary snapping. The right `minSilenceMs` depends on how the narrator
 * actually speaks (the brief's open question): too low and the snap lands on a
 * gap between words or sentences, too high and it falls back to a fixed lead.
 * @param {{ minSilenceMs?: number, lookbackMs?: number, silenceThreshold?: number, snapPreRollMs?: number, fallbackLeadMs?: number }} p
 */
function setSnapConfig(p = {}) {
    for (const k of ['minSilenceMs', 'lookbackMs', 'silenceThreshold', 'snapPreRollMs', 'fallbackLeadMs']) {
        if (typeof p[k] === 'number') config[k] = p[k];
    }
    saveConfig();
    return {
        minSilenceMs: config.minSilenceMs, lookbackMs: config.lookbackMs,
        silenceThreshold: config.silenceThreshold, snapPreRollMs: config.snapPreRollMs,
        fallbackLeadMs: config.fallbackLeadMs,
    };
}

function setSpendCap(p = {}) {
    config.spendCapUsd = (p.usd == null) ? null : Number(p.usd);
    saveConfig();
    return { cap: config.spendCapUsd };
}

function getStatus() {
    return {
        status: state.status, sessionId: state.sessionId,
        pairs: state.pairs.length, durationMs: state.status === 'capturing' ? Cap.nowMs() : state.durationMs,
        hasScreen: Cap.hasScreen(), hasKey: !!Pipe.getApiKey(),
        takeSource: state.takeSource, video: state.video,
        cleanup: config.cleanup, spendCapUsd: config.spendCapUsd,
        rollingSummaryChars: state.rollingSummary.length,
        costs: costSummary(),
    };
}

// ── Registration (JS-API-first) ──────────────────────────────────────────────

/** Set the key and tell the UI, so the chip is right however the key arrived. */
function setApiKey(p = {}) {
    const r = Pipe.setApiKey(p);
    emit(NR_EVENTS.KEY_SET, { present: true });
    return r;
}

api
    .register('setApiKey',        setApiKey,        { async: false, events: [NR_EVENTS.KEY_SET], sanitiseParams: p => ({ ...p, apiKey: p?.apiKey ? '••••' : undefined }) })
    .register('listModels',       Pipe.listModels,  { async: false })
    .register('getStatus',        getStatus,        { async: false })

    .register('startSession',     startSession,     { async: true,  events: [NR_EVENTS.SESSION_STARTED] })
    .register('markMoment',       marker.markMoment,{ async: true,  events: [NR_EVENTS.MARK, NR_EVENTS.PAIR_ADDED] })
    .register('endSession',       endSession,       { async: true,  events: [NR_EVENTS.SESSION_ENDED] })
    .register('reset',            resetAll,         { async: false, events: [NR_EVENTS.RESET] })

    .register('addRecording',     addRecording,     { async: true })
    .register('importVideo',      importVideo,      { async: true,  events: [NR_EVENTS.VIDEO_STARTED, NR_EVENTS.VIDEO_PROGRESS, NR_EVENTS.VIDEO_COMPLETE],
        sanitiseParams: p => ({ ...p, file: p?.file ? `<${p.file.type || 'video'} ${p.file.size || 0}b>` : undefined }) })
    .register('getFrameCandidates', Video.getFrameCandidates, { async: false })
    .register('setFrame',         (p = {}) => Video.setFrame(p, emit), { async: true, events: [NR_EVENTS.PAIR_UPDATED] })
    .register('markAt',           marker.markAt,    { async: true,  events: [NR_EVENTS.MARK, NR_EVENTS.PAIR_ADDED] })
    .register('transcribeAll',    (p = {}) => {
        // Import mode has no endSession — the sweep closes the final open pair.
        if (state.takeSource === 'import') marker.closeLastPair(state.durationMs);
        return Pipe.transcribeAll(p);
    }, { async: true })

    .register('getSession',       sessionToJson,    { async: false })
    .register('getPairs',         () => state.pairs.map(pairToJson), { async: false })
    .register('getPair',          (p = {}) => { const x = getPairById(p.id); return x ? pairToJson(x) : null; }, { async: false })
    .register('getPairImage',     getPairImage,     { async: true })
    .register('setBoundary',      setBoundary,      { async: false, events: [NR_EVENTS.PAIR_UPDATED] })
    .register('setNotes',         edit.setNotes,    { async: false, events: [NR_EVENTS.PAIR_UPDATED] })
    .register('movePair',         edit.movePair,    { async: false, events: [NR_EVENTS.PAIRS_REORDERED] })
    .register('reorderPairs',     edit.reorderPairs,{ async: false, events: [NR_EVENTS.PAIRS_REORDERED] })
    .register('insertPair',       edit.insertPair,  { async: true,  events: [NR_EVENTS.PAIR_ADDED] })
    .register('setText',          setText,          { async: false, events: [NR_EVENTS.PAIR_UPDATED] })
    .register('removePair',       removePair,       { async: false, events: [NR_EVENTS.PAIR_REMOVED] })
    .register('retranscribePair', Pipe.transcribePair, { async: true, events: [NR_EVENTS.TRANSCRIBE_COMPLETE] })

    .register('cleanPair',        Pipe.cleanPair,   { async: true,  events: [NR_EVENTS.CLEAN_COMPLETE] })
    .register('cleanAll',         Pipe.cleanAll,    { async: true })
    .register('getSummary',       () => ({ summary: state.rollingSummary, atSeq: state.summaryAtSeq }), { async: false })

    .register('askPair',          chat.askPair,     { async: true,  events: [NR_EVENTS.CHAT_COMPLETE] })
    .register('askSession',       chat.askSession,  { async: true,  events: [NR_EVENTS.CHAT_COMPLETE] })

    .register('buildDocument',    buildDoc,         { async: false, events: [NR_EVENTS.DOCUMENT_BUILT] })
    .register('getDocument',      () => (lastDocument ? { markdown: lastDocument.markdown } : null), { async: false })
    .register('downloadZip',      downloadZip,      { async: true,  events: [NR_EVENTS.BUNDLE_CREATED] })
    .register('downloadPdf',      downloadPdf,      { async: true,  events: [NR_EVENTS.PDF_CREATED] })
    .register('saveToVault',      saveToVault,      { async: true,  events: [NR_EVENTS.VAULT_COMPLETE],
        sanitiseParams: p => ({ ...p, passphrase: p?.passphrase ? '••••' : undefined, token: p?.token ? '••••' : undefined }) })
    .register('previewVaultFiles', (p = {}) => ({ files: buildVaultFiles(p).files.map(f => f.path) }), { async: false })

    .register('saveSession',      saveSession,      { async: true,  events: [NR_EVENTS.STORE_SAVED] })
    .register('listSessions',     listSessions,     { async: true })
    .register('loadSession',      loadSession,      { async: true,  events: [NR_EVENTS.STORE_LOADED] })
    .register('deleteSession',    deleteSession,    { async: true })

    .register('fetchBilling',     Billing.fetchBilling, { async: true, events: [NR_EVENTS.BILLING_COMPLETE] })
    .register('getBilling',       Billing.getBilling,   { async: false })

    .register('setCleanupMode',   setCleanupMode,   { async: false })
    .register('setSnapConfig',    setSnapConfig,    { async: false })
    .register('getCostSummary',   costSummary,      { async: false })
    .register('setSpendCap',      setSpendCap,      { async: false });

// JS-API-first: activate before UI so window.__tool is live from tool:ready.
api.activate();

await initShell(state, config, api, emit, marker);
