/**
 * nr-input.js
 * The fifth feed: what the operator DID, beside what they said and showed.
 *
 * A narrated review already carries three aligned things — a screenshot, the
 * words about it, and the moment. This adds a fourth axis that none of them
 * capture: the mouse path taken to reach a control, the hesitation before a
 * click, the shortcut used instead of the menu, the console error that appeared
 * while nobody was looking at the console. For a UX question those are the whole
 * answer, and a screenshot is the one thing that cannot show them.
 *
 * ALIGNMENT. Events arrive stamped with wall-clock `Date.now()` from another
 * tab. They are converted once, on arrival, to the session clock by subtracting
 * `state.startedAt`. That is wall-clock alignment, NOT the audio clock the PCM
 * slices use — the two can drift by tens of milliseconds over a long session,
 * which is invisible for a mouse path and would matter for lip-sync. It is
 * recorded as `clock: 'wall'` so nobody has to guess which one they are holding.
 *
 * PER-CAPTURE SLICING. Every capture already has `tStart`/`tEnd` bounds, so
 * events fall naturally into the pair they belong to. `momentsWithInput()`
 * returns that join rather than making a consumer redo it — the same reasoning
 * that put `moments[]` in `session.json`.
 *
 * @module nr-input
 */

import { state } from './nr-state.js';

/** Everything received this session, in arrival order, on the session clock. */
const events = [];
let meta = { tabId: null, url: null, title: null, cfg: null, dropped: 0, redacted: 0, outside: 0, capped: false };
let emitFn = () => {};
let poller = null;
let drainFn = null;

export function initInput({ emit, drain } = {}) {
    if (typeof emit === 'function') emitFn = emit;
    if (typeof drain === 'function') drainFn = drain;
}

/**
 * Wall clock → session clock. Null when the event has no place on the timeline.
 *
 * `Math.max(0, …)` was the first version and it was wrong in a way worth naming:
 * it CLAMPED an event from before the recording started to t=0, which drops it
 * neatly into capture 1 — a moment at which it did not happen. Inventing a
 * position is worse than having none, so a pre-session event is dropped and
 * counted instead.
 */
function toSessionMs(t) {
    if (!state.startedAt) return null;
    const ms = t - state.startedAt;
    return ms < 0 ? null : ms;
}

/**
 * Take a batch from the extension.
 * @param {{ events: Array, dropped, redacted, url, title, tabId }} batch
 */
export function ingest(batch = {}) {
    const incoming = Array.isArray(batch.events) ? batch.events : [];
    let outside = 0;
    for (const e of incoming) {
        const tMs = toSessionMs(e.t);
        if (tMs == null) { outside += 1; continue; }
        events.push({ ...e, tMs });
    }
    meta = {
        ...meta,
        tabId: batch.tabId ?? meta.tabId,
        url: batch.url || meta.url,
        title: batch.title || meta.title,
        dropped: batch.dropped ?? meta.dropped,
        redacted: batch.redacted ?? meta.redacted,
        outside: (meta.outside || 0) + outside,
    };
    if (incoming.length) emitFn('nr:input:batch', { added: incoming.length, total: events.length });
    return { added: incoming.length, total: events.length };
}

/** Poll the extension while a session is live. */
export function startPolling({ tabId, everyMs = 2000 } = {}) {
    stopPolling();
    meta.tabId = tabId;
    poller = setInterval(async () => {
        if (!drainFn) return;
        try { ingest(await drainFn(tabId)); } catch (_) { /* extension gone — stop quietly, keep what we have */ }
    }, everyMs);
    emitFn('nr:input:started', { tabId });
    return { polling: true, tabId };
}

export function stopPolling() {
    if (poller) clearInterval(poller);
    poller = null;
    return { polling: false };
}

/** One final drain, so the last second of a session is not lost. */
export async function finalDrain() {
    if (!drainFn || meta.tabId == null) return { added: 0, total: events.length };
    stopPolling();
    try { return ingest(await drainFn(meta.tabId)); } catch (_) { return { added: 0, total: events.length }; }
}

export function clearInput() {
    events.length = 0;
    meta = { tabId: null, url: null, title: null, cfg: null, dropped: 0, redacted: 0, outside: 0, capped: false };
}

/** Counts by kind — the cheap summary a UI can show every second. */
export function inputSummary() {
    const by = {};
    for (const e of events) by[e.k] = (by[e.k] || 0) + 1;
    return {
        total: events.length, byKind: by,
        dropped: meta.dropped, redacted: meta.redacted, outside: meta.outside || 0,
        url: meta.url, title: meta.title, tabId: meta.tabId,
        polling: !!poller,
    };
}

/** Events inside a capture's bounds. */
export function eventsForPair(pair) {
    if (!pair || pair.tStart == null) return [];
    const end = pair.tEnd == null ? Infinity : pair.tEnd;
    return events.filter(e => e.tMs >= pair.tStart && e.tMs < end);
}

/**
 * The mouse path as a polyline, decimated.
 *
 * A raw 30 Hz path is thousands of points that mostly say "still moving in a
 * straight line". This keeps direction changes and drops the rest, which is what
 * makes a path readable — both to a person drawing it and to a model reading it.
 */
export function mousePath(evs, tolerancePx = 4) {
    const pts = evs.filter(e => e.k === 'move');
    if (pts.length < 3) return pts.map(p => ({ tMs: p.tMs, x: p.x, y: p.y }));
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
        const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
        // Distance of b from the line a→c. Small means b adds nothing.
        const dx = c.x - a.x, dy = c.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const dist = Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx) / len;
        if (dist > tolerancePx) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    return out.map(p => ({ tMs: p.tMs, x: p.x, y: p.y }));
}

/** Per-capture rollup: what happened during each moment. */
export function momentsWithInput() {
    return state.pairs.map((p, i) => {
        const evs = eventsForPair(p);
        const clicks = evs.filter(e => e.k === 'click');
        const keys = evs.filter(e => e.k === 'key');
        const errors = evs.filter(e => e.k === 'console' && e.level === 'error');
        const net = evs.filter(e => e.k === 'net');
        const failed = net.filter(e => e.ok === false);
        return {
            index: i + 1,
            pairId: p.id,
            tStart: p.tStart, tEnd: p.tEnd,
            counts: { total: evs.length, clicks: clicks.length, keys: keys.length,
                errors: errors.length, network: net.length, networkFailed: failed.length },
            clicks: clicks.map(c => ({ tMs: c.tMs, x: c.x, y: c.y, on: c.el })),
            keys: keys.map(k => ({ tMs: k.tMs, key: k.key, mods: k.mods, redacted: k.redacted })),
            consoleErrors: errors.slice(0, 20).map(e => ({ tMs: e.tMs, args: e.args, at: e.at })),
            failedRequests: failed.slice(0, 20).map(e => ({ tMs: e.tMs, method: e.method, url: e.url, status: e.status })),
            probes: evs.filter(e => e.k === 'probe').map(e => ({ tMs: e.tMs, id: e.id, on: e.on, value: e.value, error: e.error })),
            mousePath: mousePath(evs),
        };
    });
}

/** The `input.json` document. */
export function inputToJson() {
    const s = inputSummary();
    return {
        schema: {
            name: 'narrated-review/input',
            version: 1,
            note: 'What the operator DID, on the same clock as the captures. Recorded by the SG Page '
                + 'Recorder extension, which is the only way to get any of this: a screen-capture '
                + 'stream carries pixels and audio and nothing else.',
            clock: 'wall — event times are Date.now() minus the session start, NOT the audio clock '
                + 'the PCM slices use. Good to tens of milliseconds; do not use it for lip-sync.',
            replay: 'events[] is everything in order. moments[] is the same data already sliced into '
                + 'the captures it belongs to, with the mouse path decimated for reading. Prefer '
                + 'moments[] unless you are literally replaying the session.',
            privacy: 'Keystrokes in password and payment fields are NEVER recorded, in any mode; '
                + '`redacted` counts what was refused so an absent event can be told from a refused '
                + 'one. In the default keyboard mode printable characters are recorded as "·" — the '
                + 'key is kept, the character is not. Network is metadata only: no headers, no '
                + 'bodies, ever, and query strings are stripped unless fullUrls was set.',
        },
        sessionId: state.sessionId,
        source: { url: s.url, title: s.title, extension: 'sg-page-recorder' },
        counts: s.byKind,
        total: s.total,
        dropped: s.dropped,
        redacted: s.redacted,
        // Events the recorder saw before the session clock started. Counted
        // rather than clamped to zero, which would place them in capture 1.
        outsideSession: s.outside,
        moments: momentsWithInput(),
        events,
    };
}

export function getEvents() { return events.slice(); }
