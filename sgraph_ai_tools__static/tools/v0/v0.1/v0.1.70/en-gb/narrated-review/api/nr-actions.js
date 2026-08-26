/**
 * nr-actions.js
 * The action log, and undo/redo built on top of it.
 *
 * TWO SEPARATE THINGS, deliberately:
 *
 * 1. **The log** — an append-only record of everything that happened to this
 *    session: every capture marked, every transcript that landed, every edit,
 *    every undo. It is never rewound. Undoing an edit does not erase the edit
 *    from history; it appends an `undo` entry, because "what did I actually do
 *    to this document" is a different question from "what does the document say
 *    now", and the first one is the one an agent cannot reconstruct afterwards.
 *    It ships as `actions.json`.
 *
 * 2. **The history** — snapshots of the mutable document state, capped, used to
 *    move backwards and forwards. Snapshots rather than inverse operations:
 *    an inverse must be written (correctly) for every new mutation, and the day
 *    someone adds one and forgets its inverse, undo silently corrupts the
 *    document. A snapshot cannot be forgotten.
 *
 * WHAT A SNAPSHOT HOLDS. Everything that edits can change — the pair list with
 * its text, notes, marks, order and status, plus the rolling summary. Blobs
 * (screenshots) are held **by reference**, not copied: they are immutable once
 * captured, so sharing them costs one pointer instead of a megabyte, and a
 * screenshot cannot be "undone" into a different image anyway.
 *
 * WHAT IT DOES NOT HOLD. The audio take, the billing ledger and accumulated
 * costs. Undo must never make money that was spent look unspent.
 *
 * @module nr-actions
 */

import { state } from './nr-state.js';

/** Depth of the undo stack. Snapshots are cheap (no blob copies) but not free. */
const HISTORY_CAP = 60;

/** Entries kept in memory before the oldest are dropped from the log. */
const LOG_CAP = 5000;

const log = [];
let past = [];
let future = [];
let seqNo = 0;
let emitFn = () => {};
let suspended = 0;

/** @param {{ emit: Function }} deps */
export function initActions({ emit } = {}) {
    if (typeof emit === 'function') emitFn = emit;
}

/**
 * Record that something happened.
 *
 * `params` is stored as given, so callers must hand over something serialisable
 * and free of secrets — see `sanitise` for what is stripped. A log entry that
 * cannot be written to disk is not a log entry.
 *
 * @param {string} action  the API method name, or a lifecycle name
 * @param {object} [params]
 * @param {object} [extra] { result, undoable, kind }
 */
export function record(action, params = {}, extra = {}) {
    seqNo += 1;
    const entry = {
        n: seqNo,
        at: new Date().toISOString(),
        tMs: state.startedAt ? Date.now() - state.startedAt : null,
        action,
        kind: extra.kind || 'edit',
        params: sanitise(params),
    };
    if (extra.result !== undefined) entry.result = sanitise(extra.result);
    log.push(entry);
    if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
    emitFn('nr:action:recorded', { n: entry.n, action, kind: entry.kind });
    return entry;
}

/**
 * Strip what must never reach disk, and what would bloat the log beyond use.
 *
 * Blobs and data URLs go first: an action log with a screenshot inlined in it is
 * not a log, it is a second copy of the session. Anything that smells like a key
 * goes too — the log is exported, and the API key lives one object away from
 * several of these calls.
 */
function sanitise(value, depth = 0) {
    if (value == null || depth > 4) return value ?? null;
    if (typeof value === 'string') {
        if (value.length > 400) return `${value.slice(0, 400)}…[${value.length} chars]`;
        if (/^data:/.test(value)) return '[data-url]';
        return value;
    }
    if (typeof value !== 'object') return value;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return `[blob ${value.size}b]`;
    if (Array.isArray(value)) return value.slice(0, 50).map(v => sanitise(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (/key|token|secret|password/i.test(k)) { out[k] = '[redacted]'; continue; }
        out[k] = sanitise(v, depth + 1);
    }
    return out;
}

/** The log, for `actions.json` and `getActions()`. */
export function actionsToJson() {
    return {
        schema: {
            name: 'narrated-review/actions',
            version: 1,
            note: 'Append-only. Everything that happened to this session in order, including '
                + 'undo/redo themselves — the log is a history of ACTIONS, not a history of '
                + 'document states, so it is never rewound. `kind` separates what a person or '
                + 'agent DID (edit, capture) from what the pipeline did on its own (pipeline), '
                + 'so "who changed this" is answerable.',
            fields: 'n (monotonic), at (wall clock), tMs (ms into the recording, null if '
                + 'authored outside a recording), action, kind, params, result',
        },
        sessionId: state.sessionId,
        count: log.length,
        actions: log.slice(),
    };
}

// ── History ─────────────────────────────────────────────────────────────────

/** Clone the document state. Blobs by reference — see the module note. */
function snapshot() {
    return {
        pairs: state.pairs.map(p => ({
            ...p,
            screenshot: p.screenshot,                       // by reference, on purpose
            raw: p.raw ? { ...p.raw } : null,
            rawVersions: p.rawVersions.slice(),
            clean: p.clean ? { ...p.clean, marks: (p.clean.marks || []).map(m => ({ ...m })) } : null,
            error: p.error ? { ...p.error } : null,
            frameCandidates: p.frameCandidates,             // by reference (thumbs)
        })),
        rollingSummary: state.rollingSummary,
        summaryAtSeq: state.summaryAtSeq,
    };
}

function restore(snap) {
    state.pairs = snap.pairs;
    state.rollingSummary = snap.rollingSummary;
    state.summaryAtSeq = snap.summaryAtSeq;
    state.pairs.forEach((p, i) => { p.seq = i; });
}

/**
 * Take a checkpoint before a mutation.
 *
 * Called by `tracked()` rather than by each method, so a new mutating method
 * gets undo by being wrapped — not by remembering to call this.
 */
export function checkpoint() {
    if (suspended) return;
    past.push(snapshot());
    if (past.length > HISTORY_CAP) past.shift();
    future = [];                     // a new edit forks the timeline
    emitFn('nr:history:changed', historyState());
}

/**
 * Wrap a mutating method so it checkpoints, runs, and logs — in that order.
 *
 * The checkpoint has to happen BEFORE the call and the log entry AFTER it, so a
 * method that throws leaves neither a phantom undo step nor a log line claiming
 * something happened that did not.
 *
 * @param {string} action  the name it is registered under
 * @param {Function} fn
 * @param {{ kind?: string }} [opts]
 */
export function tracked(action, fn, opts = {}) {
    return function trackedCall(...args) {
        checkpoint();
        let result;
        try {
            result = fn.apply(this, args);
        } catch (err) {
            past.pop();                                     // it did not happen
            emitFn('nr:history:changed', historyState());
            throw err;
        }
        if (result && typeof result.then === 'function') {
            return result.then(value => {
                record(action, args[0] || {}, { kind: opts.kind, result: summariseResult(value) });
                return value;
            }, err => {
                past.pop();
                emitFn('nr:history:changed', historyState());
                throw err;
            });
        }
        record(action, args[0] || {}, { kind: opts.kind, result: summariseResult(result) });
        return result;
    };
}

/** Log the shape of a result, not the whole of it. */
function summariseResult(r) {
    if (r == null || typeof r !== 'object') return r ?? null;
    const out = {};
    for (const k of ['id', 'index', 'moved', 'seq', 'order', 'removed', 'count', 'ok']) {
        if (k in r) out[k] = r[k];
    }
    return Object.keys(out).length ? out : null;
}

/** Run `fn` without recording history — used while restoring a session. */
export async function withoutHistory(fn) {
    suspended += 1;
    try { return await fn(); } finally { suspended -= 1; }
}

export function historyState() {
    return { canUndo: past.length > 0, canRedo: future.length > 0, depth: past.length, actions: log.length };
}

/** Step back one document state. The step itself is logged. */
export function undo() {
    if (!past.length) return { ok: false, reason: 'nothing to undo', ...historyState() };
    future.push(snapshot());
    restore(past.pop());
    record('undo', {}, { kind: 'history' });
    emitFn('nr:history:changed', historyState());
    emitFn('nr:pairs:reordered', { order: state.pairs.map(p => p.id), via: 'undo' });
    return { ok: true, ...historyState() };
}

export function redo() {
    if (!future.length) return { ok: false, reason: 'nothing to redo', ...historyState() };
    past.push(snapshot());
    restore(future.pop());
    record('redo', {}, { kind: 'history' });
    emitFn('nr:history:changed', historyState());
    emitFn('nr:pairs:reordered', { order: state.pairs.map(p => p.id), via: 'redo' });
    return { ok: true, ...historyState() };
}

/** New session, empty history — but the log survives if asked to. */
export function resetHistory({ keepLog = false } = {}) {
    past = []; future = [];
    if (!keepLog) { log.length = 0; seqNo = 0; }
    emitFn('nr:history:changed', historyState());
}

/** Restore a log loaded from a saved session, so history is continuous. */
export function loadLog(entries = []) {
    log.length = 0;
    for (const e of entries) log.push(e);
    seqNo = log.reduce((m, e) => Math.max(m, e.n || 0), 0);
}
