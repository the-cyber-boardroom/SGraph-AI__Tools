/**
 * nr-stream.js
 * Run the cleanup lane DURING the recording instead of after it.
 *
 * THE OBSERVATION. Cleanup was sequential because the rolling summary is
 * order-dependent: capture k is corrected in the light of captures 1…k−1. That
 * is a constraint on ORDER, and it was quietly being treated as a constraint on
 * TIME — so nothing was cleaned until the recording stopped, and pressing
 * Finish began a queue of N sequential model calls with a screenshot each.
 *
 * But cleanup is *causal*: it never looks forward. Cleaning capture 3 the moment
 * capture 3's transcript lands produces byte-for-byte what cleaning it twenty
 * minutes later would have produced, because the inputs — its raw text, its
 * screenshot, and the summary of 1 and 2 — are all already final. **There is no
 * quality trade-off here. It is the same computation, started earlier.**
 *
 * So by the time Finish is pressed, everything except the last capture or two is
 * usually already clean, and the wait collapses from N sequential calls to
 * roughly one. On the session that prompted this — 8 captures, 7 minutes — that
 * is the difference between about a minute of waiting and a few seconds.
 *
 * THE ORDER RULE. Capture k may only be cleaned once every capture before it has
 * been cleaned, skipped or given up on. Transcription is parallel, so capture 3
 * routinely lands before capture 2; the chain simply waits. What it must never
 * do is wait forever, so a capture whose transcription failed is stepped over
 * rather than blocking every capture behind it.
 *
 * THE PARALLEL OPTION. `cleanupOrder: 'parallel'` drops the rolling summary and
 * cleans everything at once. It is faster again and **it is a real quality
 * change** — each capture is then corrected with no knowledge of what came
 * before, so a term established in capture 2 will not inform capture 9. It is
 * offered, off by default, and named honestly rather than sold as a speed
 * setting.
 *
 * @module nr-stream
 */

import { state, config } from './nr-state.js';

let emitFn = () => {};
let cleanPairFn = null;
let running = false;
let stopped = false;

/**
 * @param {{ emit: Function, cleanPair: Function }} deps
 */
export function initStream({ emit, cleanPair } = {}) {
    if (typeof emit === 'function') emitFn = emit;
    if (typeof cleanPair === 'function') cleanPairFn = cleanPair;
    if (config.cleanupTiming === undefined) config.cleanupTiming = 'streaming';
    if (config.cleanupOrder === undefined) config.cleanupOrder = 'sequential';
}

/**
 * Choose when and how cleanup runs.
 * @param {{ timing?: 'streaming'|'after', order?: 'sequential'|'parallel' }} p
 */
export function setCleanupTiming(p = {}) {
    if (p.timing && !['streaming', 'after'].includes(p.timing)) {
        throw Object.assign(new Error("timing must be 'streaming' or 'after'"), { code: 'bad-params' });
    }
    if (p.order && !['sequential', 'parallel'].includes(p.order)) {
        throw Object.assign(new Error("order must be 'sequential' or 'parallel'"), { code: 'bad-params' });
    }
    if (p.timing) config.cleanupTiming = p.timing;
    if (p.order) config.cleanupOrder = p.order;
    emitFn('nr:cleanup:timing', timingState());
    return timingState();
}

export function timingState() {
    return {
        timing: config.cleanupTiming || 'streaming',
        order: config.cleanupOrder || 'sequential',
        // The honest description of what each setting costs, so a UI can show
        // it without having to keep its own copy of the reasoning.
        note: (config.cleanupOrder === 'parallel')
            ? 'Parallel cleanup drops the rolling summary: each capture is corrected without knowing what came before it. Faster, and a real quality change.'
            : (config.cleanupTiming === 'after')
                ? 'Cleanup runs after you press Finish. Same result as streaming, just all at the end.'
                : 'Cleanup runs as you record, in order — identical output to cleaning at the end, but most of it is done before you finish.',
    };
}

/**
 * Is this capture ready to be cleaned, given everything before it?
 *
 * Returns the reason when it is not, because "why has nothing been cleaned for
 * two minutes" is otherwise unanswerable from outside.
 */
function blockedBy(pair) {
    for (const earlier of state.pairs) {
        if (earlier.seq >= pair.seq) break;
        if (earlier.clean) continue;                       // done
        if (earlier.status === 'error') continue;          // stepped over, see the module note
        if (earlier.tEnd == null) return { code: 'earlier-open', id: earlier.id };
        if (!earlier.raw) return { code: 'earlier-transcribing', id: earlier.id };
        return { code: 'earlier-uncleaned', id: earlier.id };
    }
    return null;
}

/** The next capture the chain may clean, or null. */
function nextReady() {
    const ordered = [...state.pairs].sort((a, b) => a.seq - b.seq);
    for (const p of ordered) {
        if (p.clean || !p.raw) continue;
        if (p.status === 'cleaning') return null;          // one at a time
        if (!blockedBy(p)) return p;
    }
    return null;
}

/**
 * A transcript landed (or anything else changed) — advance the chain.
 *
 * Safe to call as often as you like: it is a no-op when cleanup is deferred,
 * disabled, or already running.
 */
export function pump() {
    if (stopped) return;
    if ((config.cleanupTiming || 'streaming') !== 'streaming') return;
    if (config.cleanup === 'off') return;
    if (state.status !== 'capturing' && state.status !== 'processing') return;
    if (running || !cleanPairFn) return;
    if ((config.cleanupOrder || 'sequential') === 'parallel') { pumpParallel(); return; }

    const pair = nextReady();
    if (!pair) return;
    running = true;
    emitFn('nr:stream:cleaning', { id: pair.id, seq: pair.seq });
    Promise.resolve(cleanPairFn({ id: pair.id }))
        .catch(() => { /* the pair carries its own error; the chain moves on */ })
        .then(() => {
            running = false;
            const remaining = state.pairs.filter(p => p.raw && !p.clean).length;
            emitFn('nr:stream:progress', { cleaned: state.pairs.filter(p => p.clean).length, remaining });
            pump();                                        // keep going while work remains
        });
}

/** No rolling summary, no ordering — everything at once. */
function pumpParallel() {
    const ready = state.pairs.filter(p => p.raw && !p.clean && p.status !== 'cleaning');
    if (!ready.length) return;
    for (const pair of ready) {
        emitFn('nr:stream:cleaning', { id: pair.id, seq: pair.seq, parallel: true });
        Promise.resolve(cleanPairFn({ id: pair.id })).catch(() => {});
    }
}

/**
 * What is left to do, and why — for the UI and for `getStatus()`.
 */
export function streamState() {
    const bounded = state.pairs.filter(p => p.tEnd != null);
    const transcribed = state.pairs.filter(p => p.raw);
    const cleaned = state.pairs.filter(p => p.clean);
    const pending = state.pairs.filter(p => p.raw && !p.clean);
    const head = pending.sort((a, b) => a.seq - b.seq)[0] || null;
    return {
        ...timingState(),
        captures: state.pairs.length,
        bounded: bounded.length,
        transcribed: transcribed.length,
        cleaned: cleaned.length,
        pendingClean: pending.length,
        running,
        waitingOn: head ? (blockedBy(head) || { code: 'ready', id: head.id }) : null,
        // The number that answers "how long after I press Finish?"
        estimatedRemainingCalls: pending.length,
    };
}

export function stopStream() { stopped = true; }
export function startStream() { stopped = false; pump(); }
