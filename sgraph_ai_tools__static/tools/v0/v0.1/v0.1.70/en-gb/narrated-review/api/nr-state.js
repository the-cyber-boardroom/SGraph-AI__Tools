/**
 * nr-state.js
 * Session, pairs, and config — plain mutable module state, no DOM.
 *
 * The unit is the PAIR (source brief claim 4): everything downstream operates
 * on the ordered list. `raw` is immutable once set (source-and-derived
 * discipline): retranscribe pushes the old raw into `rawVersions`, and edits
 * only ever touch `clean.text`.
 *
 * @module nr-state
 */

import { momentsToJson } from './nr-document.js';

/** Tool configuration (persisted subset → localStorage 'nr-config'). */
export const config = {
    // Boundary snapping. The rule is "the latest SUSTAINED silence before the
    // press" — sustained matters: real speech is full of ~120 ms gaps between
    // words, and snapping to one of those lands mid-sentence (found in the live
    // OpenRouter test, which lost ~3 s off the front of every segment).
    lookbackMs: 30000,         // how far back to look for that gap. Generous is
                               // safe: taking the LATEST qualifying gap is
                               // self-correcting, and real utterances run long.
    minSilenceMs: 700,         // a gap this long separates utterances, not words
                               // (400 ms still caught sentence-internal pauses in
                               // live narration; 700 ms separated topic from
                               // sentence. Tunable — see setSnapConfig.)
    snapPreRollMs: 150,        // start a hair before speech resumes
    fallbackLeadMs: 2000,      // fixed lead-in when no qualifying gap is found
    silenceThreshold: 0.01,    // RMS at/below which a frame counts as silence
    suggestionSilenceMs: 700,  // sustained silence that logs an unmarked suggestion
    frameMs: 20,               // PCM frame size (matches sg-live-capture default)
    transcribeModel: null,     // null → core/sg-transcribe DEFAULT_MODEL
    cleanupModel: null,        // null → same as transcribeModel
    cleanup: 'grounded',       // 'grounded' | 'text-only' | 'off'
    // WHEN cleanup runs, which is not the same question as HOW it runs.
    // 'streaming' cleans each capture as its transcript lands, during the
    // recording. Cleanup only ever looks backwards, so this is the identical
    // computation started earlier — see nr-stream.
    cleanupTiming: 'streaming',   // 'streaming' | 'after'
    // 'parallel' drops the rolling summary. Faster, and a REAL quality change:
    // each capture is then corrected without knowing what came before it.
    cleanupOrder: 'sequential',   // 'sequential' | 'parallel'
    spendCapUsd: null,
};

const PERSISTED = ['lookbackMs', 'fallbackLeadMs', 'transcribeModel', 'cleanupModel', 'cleanup',
    'cleanupTiming', 'cleanupOrder', 'spendCapUsd'];
const CONFIG_KEY = 'nr-config';

/** Load persisted config keys (tool page context only; safe if storage blocked). */
export function loadConfig() {
    try {
        const raw = localStorage.getItem(CONFIG_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        for (const k of PERSISTED) if (k in saved) config[k] = saved[k];
    } catch (_) { /* sandboxed frame / disabled storage */ }
}

/** Persist the user-tunable subset. */
export function saveConfig() {
    try {
        const out = {};
        for (const k of PERSISTED) out[k] = config[k];
        localStorage.setItem(CONFIG_KEY, JSON.stringify(out));
    } catch (_) { /* */ }
}

/** The one live session (one recorder per page, like core/sg-recorder). */
export const state = {
    status: 'idle',            // idle | capturing | processing | reviewing
    sessionId: null,
    startedAt: null,           // epoch ms at capture t=0
    durationMs: 0,
    sampleRate: 16000,
    screen: null,              // { width, height }
    take: null,                // { blob, mimeType } — the continuous saved audio
    takeSource: null,          // 'live' | 'import' | 'video'
    video: null,               // { name, size, durationMs, width, height } when imported from a video
    videoImport: null,          // { segments, capped, calibration } — how segmentation actually went
    pairs: [],                 // ordered by seq — THE list
    suggestions: [],           // [tMs] VAD silences without a mark
    rollingSummary: '',
    summaryAtSeq: -1,
    costs: { transcribeUsd: 0, cleanUsd: 0, pendingCount: 0 },
    chatCosts: [],             // [{ scope:'pair'|'session', id?, usd }]
    billing: [],               // one entry per OpenRouter generation — see nr-billing
    lastError: null,
    _seq: 0,

    reset() {
        this.status = 'idle'; this.sessionId = null; this.startedAt = null;
        this.durationMs = 0; this.screen = null; this.take = null; this.takeSource = null;
        this.video = null; this.videoImport = null;
        this.pairs = []; this.suggestions = []; this.rollingSummary = '';
        this.summaryAtSeq = -1; this.costs = { transcribeUsd: 0, cleanUsd: 0, pendingCount: 0 };
        this.chatCosts = []; this.billing = []; this.lastError = null; this._seq = 0;
        resetIds();
    },
};

/**
 * Create and append a pair at a press moment. Bounds start open (tEnd null —
 * closed by the next press or session end).
 * @param {{ tPress: number, tStart: number, screenshot: Blob|null }} p
 * @returns {object} the new pair
 */
let _idCounter = 0;

export function addPair({ tPress, tStart, screenshot }) {
    const seq = state._seq++;
    const pair = makePair({ seq, tPress, tStart, screenshot });
    state.pairs.push(pair);
    return pair;
}

/**
 * Build a pair object. `seq` is the DOCUMENT ORDER and is re-derived by
 * resequence() after any move/insert — `id` stays stable for the life of the
 * pair so API callers, chat references and events keep pointing at the same
 * thing.
 */
export function makePair({ seq, tPress = null, tStart = null, screenshot = null, source = 'capture' }) {
    _idCounter += 1;
    return {
        id: `p${String(_idCounter).padStart(2, '0')}`,
        seq, tPress,
        tStart, tEnd: tStart == null ? null : null,
        screenshot: screenshot || null,
        source,                    // 'capture' | 'inserted' | 'video'
        videoAt: null,             // video-import only: ms of the frame this took
        frameCandidates: null,     // video-import only: [{at, thumb}] considered
        raw: null,                 // { text, model, generationId, costUsd|null }
        rawVersions: [],           // older raws (retranscribe pushes here)
        clean: null,               // { text, marks:[{span,note}], model, generationId, costUsd|null }
        notes: '',                 // human/agent commentary — NOT a transcript.
                                   // Kept separate from `clean` because clean is
                                   // derived from what was said; notes are added
                                   // afterwards and must never be mistaken for it.
        status: 'marked',          // marked | transcribing | raw | cleaning | clean | error
        error: null,               // { code, step }
    };
}

/** Re-derive seq from array position. Call after any structural change. */
export function resequence() {
    state.pairs.forEach((p, i) => { p.seq = i; });
    return state.pairs.length;
}

/** Reset the id counter (used by state.reset via a fresh session). */
export function resetIds() { _idCounter = 0; }

/** @param {string} id @returns {object|null} */
export function getPairById(id) {
    return state.pairs.find(p => p.id === id) || null;
}

/** Serialise a pair without blobs (the JS-API shape). */
export function pairToJson(p) {
    return {
        id: p.id, seq: p.seq, tPress: p.tPress, tStart: p.tStart, tEnd: p.tEnd,
        hasScreenshot: !!p.screenshot, source: p.source || 'capture',
        videoAt: p.videoAt ?? null,
        raw: p.raw ? { text: p.raw.text, model: p.raw.model, costUsd: p.raw.costUsd } : null,
        clean: p.clean ? { text: p.clean.text, marks: p.clean.marks, model: p.clean.model, costUsd: p.clean.costUsd } : null,
        notes: p.notes || '',
        status: p.status, error: p.error,
    };
}

/** Serialise the session without blobs (getSession + session.json in exports). */
export function sessionToJson() {
    return {
        tool: 'narrated-review',
        // The consumer-facing contract, declared so a reader knows what it has.
        schema: {
            name: 'narrated-review/session',
            version: 2,
            moments: 'THE MACHINE-READABLE VIEW. One entry per capture in document order, '
                + 'each joining its image, words, audio and raw transcript. `index` matches the '
                + '"## N." headings in review.md and the "Moment N" labels in the PDF. Read this '
                + 'instead of parsing review.md.',
            pairs: 'The internal per-capture records (same order, keyed by stable `id`). '
                + '`moments` is derived from these and is the preferred surface.',
            paths: 'Relative to the export root. An export may omit audio/ by option.',
        },
        files: {
            review: 'review.md', session: 'session.json', billing: 'billing.json',
            images: 'images/', audio: 'audio/', raw: 'raw/', notes: 'notes/',
        },
        sessionId: state.sessionId,
        status: state.status,
        startedAt: state.startedAt,
        durationMs: state.durationMs,
        sampleRate: state.sampleRate,
        screen: state.screen,
        takeSource: state.takeSource,
        takeMime: state.take ? state.take.mimeType : null,
        video: state.video,
        videoImport: state.videoImport,
        rollingSummary: state.rollingSummary,
        suggestions: state.suggestions.slice(),
        config: {
            lookbackMs: config.lookbackMs, fallbackLeadMs: config.fallbackLeadMs,
            cleanup: config.cleanup, transcribeModel: config.transcribeModel,
            cleanupModel: config.cleanupModel,
        },
        costs: costSummary(),
        moments: momentsToJson(state.pairs),
        pairs: state.pairs.map(pairToJson),
    };
}

/** Roll up known costs across both lanes. */
export function costSummary() {
    let transcribeUsd = 0, cleanUsd = 0, pending = 0;
    const perPair = state.pairs.map(p => {
        const t = p.raw && typeof p.raw.costUsd === 'number' ? p.raw.costUsd : null;
        const c = p.clean && typeof p.clean.costUsd === 'number' ? p.clean.costUsd : null;
        if (t != null) transcribeUsd += t;
        if (c != null) cleanUsd += c;
        if ((p.raw && t == null) || (p.clean && c == null)) pending += 1;
        return { id: p.id, transcribeUsd: t, cleanUsd: c };
    });
    for (const v of state.pairs.flatMap(p => p.rawVersions)) {
        if (typeof v.costUsd === 'number') transcribeUsd += v.costUsd;
    }
    let chatUsd = 0;
    for (const c of state.chatCosts) if (typeof c.usd === 'number') chatUsd += c.usd;
    return { sessionUsd: transcribeUsd + cleanUsd + chatUsd, transcribeUsd, cleanUsd, chatUsd, pending, perPair };
}

/** Known session spend (resolved costs only) — the spend-cap input. */
export function currentSpendUsd() {
    const c = costSummary();
    return c.sessionUsd;
}

/** Throw `{code:'budget-cap'}` if the soft cap is set and reached. */
export function checkSpendCap() {
    const cap = config.spendCapUsd;
    if (cap != null && currentSpendUsd() >= cap) {
        throw Object.assign(
            new Error(`Session spend cap reached ($${Number(cap).toFixed(4)}). Raise or clear the cap to continue.`),
            { code: 'budget-cap' });
    }
}
