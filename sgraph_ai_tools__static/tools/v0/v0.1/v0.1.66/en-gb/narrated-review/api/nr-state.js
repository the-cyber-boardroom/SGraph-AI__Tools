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

/** Tool configuration (persisted subset → localStorage 'nr-config'). */
export const config = {
    lookbackMs: 4000,          // boundary snap search window before a press
    fallbackLeadMs: 2000,      // fixed lead-in when no silence found in window
    silenceThreshold: 0.01,    // RMS at/below which a frame counts as silence
    suggestionSilenceMs: 700,  // sustained silence that logs an unmarked suggestion
    frameMs: 20,               // PCM frame size (matches sg-live-capture default)
    transcribeModel: null,     // null → core/sg-transcribe DEFAULT_MODEL
    cleanupModel: null,        // null → same as transcribeModel
    cleanup: 'grounded',       // 'grounded' | 'text-only' | 'off'
    spendCapUsd: null,
};

const PERSISTED = ['lookbackMs', 'fallbackLeadMs', 'transcribeModel', 'cleanupModel', 'cleanup', 'spendCapUsd'];
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
    takeSource: null,          // 'live' | 'import'
    pairs: [],                 // ordered by seq — THE list
    suggestions: [],           // [tMs] VAD silences without a mark
    rollingSummary: '',
    summaryAtSeq: -1,
    costs: { transcribeUsd: 0, cleanUsd: 0, pendingCount: 0 },
    lastError: null,
    _seq: 0,

    reset() {
        this.status = 'idle'; this.sessionId = null; this.startedAt = null;
        this.durationMs = 0; this.screen = null; this.take = null; this.takeSource = null;
        this.pairs = []; this.suggestions = []; this.rollingSummary = '';
        this.summaryAtSeq = -1; this.costs = { transcribeUsd: 0, cleanUsd: 0, pendingCount: 0 };
        this.lastError = null; this._seq = 0;
    },
};

/**
 * Create and append a pair at a press moment. Bounds start open (tEnd null —
 * closed by the next press or session end).
 * @param {{ tPress: number, tStart: number, screenshot: Blob|null }} p
 * @returns {object} the new pair
 */
export function addPair({ tPress, tStart, screenshot }) {
    const seq = state._seq++;
    const pair = {
        id: `p${String(seq + 1).padStart(2, '0')}`,
        seq, tPress,
        tStart, tEnd: null,
        screenshot: screenshot || null,
        raw: null,                 // { text, model, generationId, costUsd|null }
        rawVersions: [],           // older raws (retranscribe pushes here)
        clean: null,               // { text, marks:[{span,note}], model, generationId, costUsd|null }
        status: 'marked',          // marked | transcribing | raw | cleaning | clean | error
        error: null,               // { code, step }
    };
    state.pairs.push(pair);
    return pair;
}

/** @param {string} id @returns {object|null} */
export function getPairById(id) {
    return state.pairs.find(p => p.id === id) || null;
}

/** Serialise a pair without blobs (the JS-API shape). */
export function pairToJson(p) {
    return {
        id: p.id, seq: p.seq, tPress: p.tPress, tStart: p.tStart, tEnd: p.tEnd,
        hasScreenshot: !!p.screenshot,
        raw: p.raw ? { text: p.raw.text, model: p.raw.model, costUsd: p.raw.costUsd } : null,
        clean: p.clean ? { text: p.clean.text, marks: p.clean.marks, model: p.clean.model, costUsd: p.clean.costUsd } : null,
        status: p.status, error: p.error,
    };
}

/** Serialise the session without blobs (getSession + session.json in exports). */
export function sessionToJson() {
    return {
        tool: 'narrated-review',
        sessionId: state.sessionId,
        status: state.status,
        startedAt: state.startedAt,
        durationMs: state.durationMs,
        sampleRate: state.sampleRate,
        screen: state.screen,
        takeSource: state.takeSource,
        takeMime: state.take ? state.take.mimeType : null,
        rollingSummary: state.rollingSummary,
        suggestions: state.suggestions.slice(),
        config: {
            lookbackMs: config.lookbackMs, fallbackLeadMs: config.fallbackLeadMs,
            cleanup: config.cleanup, transcribeModel: config.transcribeModel,
            cleanupModel: config.cleanupModel,
        },
        costs: costSummary(),
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
    return { sessionUsd: transcribeUsd + cleanUsd, transcribeUsd, cleanUsd, pending, perPair };
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
