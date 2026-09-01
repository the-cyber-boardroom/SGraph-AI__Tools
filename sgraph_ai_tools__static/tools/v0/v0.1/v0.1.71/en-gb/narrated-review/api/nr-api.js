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
import * as Actions from './nr-actions.js';
import * as Auto from './nr-autosave.js';
import * as Stream from './nr-stream.js';
import { buildHandoverZip, uncertainToJson } from './nr-handover.js';
import * as Input from './nr-input.js';
import * as Ext from './nr-extension.js';
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
Actions.initActions({ emit });
Auto.initAutosave({ emit });
Stream.initStream({ emit, cleanPair: Pipe.cleanPair });
Input.initInput({ emit, drain: Ext.drain });

/**
 * Every mutation goes through here: checkpoint for undo, log the action, then
 * mark the session dirty so autosave picks it up.
 *
 * Wrapping at the registration boundary rather than inside each method is the
 * whole point — a method added later gets undo, an audit line and autosave by
 * being registered, not by its author remembering three separate calls. The one
 * that gets forgotten is the one that loses someone's work.
 */
function mutating(name, fn, opts = {}) {
    const wrapped = Actions.tracked(name, fn, opts);
    return function mutate(...args) {
        const out = wrapped.apply(this, args);
        if (out && typeof out.then === 'function') {
            return out.then(v => { Auto.markDirty(name); return v; });
        }
        Auto.markDirty(name);
        return out;
    };
}
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
        Actions.record('capture', { id: pair.id, seq: pair.seq, tPress: pair.tPress }, { kind: 'capture' });
        Auto.markDirty('capture');
        if (!Pipe.getApiKey()) return;                         // capture works keyless
        // Transcribe, then let the cleanup chain advance. Cleanup only looks
        // backwards, so it can run now rather than after Finish — see nr-stream.
        Pipe.transcribePair({ id: pair.id })
            .then(() => { Actions.record('transcribe', { id: pair.id }, { kind: 'pipeline' }); Stream.pump(); },
                  () => { Stream.pump(); })                    // a failed transcript must not stall the chain
            .catch(() => {});
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
    Actions.resetHistory();
    Auto.resetAutosave({ loaded: false });
    Actions.record('startSession', { cleanup: config.cleanup, timing: config.cleanupTiming, order: config.cleanupOrder }, { kind: 'session' });
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
    Actions.record('endSession', { pairs: state.pairs.length, durationMs: state.durationMs }, { kind: 'capture' });
    Input.finalDrain().catch(() => {});        // the last second of input is still worth having
    // The take exists only now, and it is the one thing autosave deliberately
    // skips while recording. Write it before anything else is attempted.
    Auto.flush('session-ended').catch(() => {});
    // Auto-run the two lanes in the background; explicit calls are idempotent.
    // With streaming cleanup most captures are already clean by this point, so
    // cleanAll usually has one or two left to do rather than all of them.
    // The receipts are swept once the lanes settle — that is the "a bit later"
    // the generation endpoint needs.
    if (Pipe.getApiKey()) {
        Pipe.transcribeAll()
            .then(() => (config.cleanup !== 'off' ? Pipe.cleanAll() : null))
            .then(settleBilling)
            .then(() => Auto.flush('lanes-settled'))
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
    Actions.resetHistory();
    Input.stopPolling(); Input.clearInput();
    // An explicit reset is a decision, not a crash: stop offering to restore.
    Auto.forgetSession();
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

const saveSession   = async (p = {}) => {
    const r = await Store.saveSession(p, emit);
    Actions.record('saveSession', { includeAudio: p.includeAudio !== false }, { kind: 'session' });
    Auto.resetAutosave({ loaded: true, takeSaved: p.includeAudio !== false && !!state.take });
    return r;
};
const listSessions  = ()       => Store.listSessions();
const deleteSession = (p = {}) => Store.deleteSession(p, emit);

/**
 * Load a saved session. Undo history does NOT carry across: the snapshots
 * describe a document that is no longer open, and offering to "undo" into it
 * would silently replace what was just loaded.
 */
async function loadSession(p = {}) {
    const r = await Actions.withoutHistory(() => Store.loadSession(p, emit));
    // Drop the UNDO SNAPSHOTS — they describe a document that is no longer open,
    // and undoing into it would silently replace what was just loaded. Keep the
    // LOG: nr-store just read it back off disk, and wiping it here would make
    // saving it pointless. (It did exactly that until a restore test noticed the
    // log came back with one entry in it.)
    Actions.resetHistory({ keepLog: true });
    Actions.record('loadSession', { sessionId: p.sessionId }, { kind: 'session' });
    Auto.resetAutosave({ loaded: true });
    return r;
}

/**
 * Pick up the session that was in progress when the page went away.
 *
 * Deliberately a plain `loadSession` underneath: the beacon only ever said
 * WHICH session was live, never held its content, so there is one code path for
 * getting a session back and it is the well-tested one.
 */
async function restoreUnsaved() {
    const found = Auto.findUnsaved();
    if (!found.found) throw Object.assign(new Error('No unsaved session found'), { code: 'no-session' });
    if (!found.recoverable) {
        Auto.dismissUnsaved();
        throw Object.assign(
            new Error('A session was in progress but never reached disk — there is nothing to restore'),
            { code: 'not-recoverable' });
    }
    const r = await loadSession({ sessionId: found.sessionId });
    emit(NR_EVENTS.UNSAVED_FOUND, { ...found, restored: true });
    return { ...r, restoredFrom: found };
}

/**
 * Attach a tab the extension is already recording.
 *
 * The tool cannot arm a tab — `activeTab` grants access only in response to a
 * click on the extension itself, so the person whose page is being recorded is
 * always the one who starts it. This picks up a tab that is already armed, which
 * is why it reports so precisely when it cannot find one.
 */
async function attachInput(p = {}) {
    const avail = Ext.availability();
    if (!avail.available) throw Object.assign(new Error(avail.reason), { code: 'no-extension' });
    const { tabs } = await Ext.listTabs();
    const armed = tabs.filter(t => t.armed);
    const tabId = p.tabId ?? (armed.length === 1 ? armed[0].tabId : null);
    if (tabId == null) {
        throw Object.assign(new Error(armed.length
            ? `${armed.length} tabs are being recorded — pass { tabId } to choose one`
            : 'No tab is being recorded. Open the page you want to narrate, click the SG Page '
              + 'Recorder icon on THAT tab, and press "Start recording this tab".'),
        { code: 'no-armed-tab', tabs: armed });
    }
    Input.startPolling({ tabId });
    Actions.record('attachInput', { tabId }, { kind: 'session' });
    return { attached: true, tabId, ...(armed.find(t => t.tabId === tabId) || {}) };
}

async function detachInput() {
    await Input.finalDrain();                 // the last second is still worth having
    Input.stopPolling();
    const s = Input.inputSummary();
    emit(NR_EVENTS.INPUT_STOPPED, { total: s.total });
    return s;
}

/** Operator-authored JavaScript, run in the recorded page, result on the timeline. */
async function runPageProbe(p = {}) {
    if (!p.js) throw Object.assign(new Error('runPageProbe needs { js }'), { code: 'bad-params' });
    const s = Input.inputSummary();
    if (s.tabId == null) throw Object.assign(new Error('No recorded tab attached — call attachInput first'), { code: 'no-armed-tab' });
    const id = p.id || `probe-${Date.now().toString(36)}`;
    Actions.record('runPageProbe', { id, on: p.on || 'manual', js: p.js }, { kind: 'edit' });
    return Ext.runProbe({ tabId: s.tabId, id, js: p.js, on: p.on || 'manual' });
}

/** The agent bundle: no audio, no PDF, plus uncertain.json and actions.json. */
async function downloadHandover(p = {}) {
    if (p.billing !== false) await settleBilling();
    const { blob, name, count, omitted } = await buildHandoverZip();
    downloadBlob(blob, name);
    emit(NR_EVENTS.BUNDLE_CREATED, { zipSize: blob.size, name, profile: 'handover' });
    return { name, zipSize: blob.size, count, omitted };
}

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
        autosave: Auto.status(),
        history: Actions.historyState(),
        cleanupTiming: Stream.streamState(),
        input: Input.inputSummary(),
        extension: Ext.availability(),
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
    .register('setFrame',         mutating('setFrame', (p = {}) => Video.setFrame(p, emit)), { async: true, events: [NR_EVENTS.PAIR_UPDATED] })
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
    .register('setBoundary',      mutating('setBoundary', setBoundary),    { async: false, events: [NR_EVENTS.PAIR_UPDATED] })
    .register('setNotes',         mutating('setNotes', edit.setNotes),     { async: false, events: [NR_EVENTS.PAIR_UPDATED] })
    .register('movePair',         mutating('movePair', edit.movePair),     { async: false, events: [NR_EVENTS.PAIRS_REORDERED] })
    .register('reorderPairs',     mutating('reorderPairs', edit.reorderPairs), { async: false, events: [NR_EVENTS.PAIRS_REORDERED] })
    .register('insertPair',       mutating('insertPair', edit.insertPair), { async: true,  events: [NR_EVENTS.PAIR_ADDED] })
    .register('setText',          mutating('setText', setText),            { async: false, events: [NR_EVENTS.PAIR_UPDATED] })
    .register('removePair',       mutating('removePair', removePair),      { async: false, events: [NR_EVENTS.PAIR_REMOVED] })
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

    // ── History, autosave and the handover bundle ────────────────────────────
    .register('undo',             Actions.undo,     { async: false, events: [NR_EVENTS.HISTORY_CHANGED] })
    .register('redo',             Actions.redo,     { async: false, events: [NR_EVENTS.HISTORY_CHANGED] })
    .register('getHistory',       Actions.historyState, { async: false })
    .register('getActions',       Actions.actionsToJson, { async: false })

    .register('setAutosave',      Auto.setAutosave, { async: false, events: [NR_EVENTS.AUTOSAVE_STATUS] })
    .register('getAutosave',      Auto.status,      { async: false })
    .register('flushAutosave',    () => Auto.flush('manual'), { async: true, events: [NR_EVENTS.AUTOSAVE_SAVED] })
    .register('findUnsaved',      Auto.findUnsaved, { async: false })
    .register('dismissUnsaved',   Auto.dismissUnsaved, { async: false, events: [NR_EVENTS.AUTOSAVE_DISMISSED] })
    .register('restoreUnsaved',   restoreUnsaved,   { async: true,  events: [NR_EVENTS.STORE_LOADED] })

    .register('downloadHandover', downloadHandover, { async: true,  events: [NR_EVENTS.BUNDLE_CREATED] })
    .register('getUncertain',     uncertainToJson,  { async: false })

    // ── The input feed (needs the SG Page Recorder extension) ───────────────
    .register('inputAvailability', Ext.availability, { async: false })
    .register('listRecordableTabs', Ext.listTabs,    { async: true })
    .register('attachInput',      attachInput,       { async: true,  events: [NR_EVENTS.INPUT_STARTED] })
    .register('detachInput',      detachInput,       { async: true,  events: [NR_EVENTS.INPUT_STOPPED] })
    .register('getInput',         Input.inputSummary, { async: false })
    .register('getInputTrack',    Input.inputToJson, { async: false })
    .register('runPageProbe',     runPageProbe,      { async: true })

    .register('setCleanupTiming', Stream.setCleanupTiming, { async: false, events: [NR_EVENTS.CLEANUP_TIMING] })
    .register('getCleanupTiming', Stream.streamState,      { async: false })

    .register('setCleanupMode',   setCleanupMode,   { async: false })
    .register('setSnapConfig',    setSnapConfig,    { async: false })
    .register('getCostSummary',   costSummary,      { async: false })
    .register('setSpendCap',      setSpendCap,      { async: false });

// JS-API-first: activate before UI so window.__tool is live from tool:ready.
api.activate();

await initShell(state, config, api, emit, marker);
