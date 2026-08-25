/**
 * yp-state.js
 * Probe context and results. Plain mutable module state, no DOM.
 *
 * `ctx` is passed to every test and tests may WRITE to it — M2 leaves the video
 * list, M3 leaves the caption tracks, M4 leaves the cues. That is deliberate: the
 * manual tests form a chain, and re-fetching in each one would triple the API
 * calls and make a mid-chain failure harder to read.
 *
 * @module yp-state
 */

const LS = 'yp-ctx';

export const ctx = {
    videoId: '',        // one of YOUR videos (M3, M4)
    otherVideoId: '',   // a video you do NOT own (M5, M6, M7)
    talks: 15,          // corpus size for the cost projection (A7)
    capturesPerTalk: 40,
    captureSeconds: 8,  // tab-capture probe length (M8)
    // Filled in by tests as the chain runs — never persisted.
    myVideos: null, tracks: null, cues: null,
};

export const state = {
    results: [],        // one record per run, newest last
    running: null,      // id of the test in flight

    reset() { this.results = []; this.running = null; ctx.myVideos = null; ctx.tracks = null; ctx.cues = null; },
};

/** Only the operator's own inputs persist — never tokens, never fetched data. */
export function loadCtx() {
    try {
        const raw = localStorage.getItem(LS);
        if (!raw) return;
        const saved = JSON.parse(raw);
        for (const k of ['videoId', 'otherVideoId', 'talks', 'capturesPerTalk', 'captureSeconds']) {
            if (saved[k] !== undefined) ctx[k] = saved[k];
        }
    } catch (_) { /* sandboxed / disabled storage */ }
}

export function saveCtx() {
    try {
        const out = {};
        for (const k of ['videoId', 'otherVideoId', 'talks', 'capturesPerTalk', 'captureSeconds']) out[k] = ctx[k];
        localStorage.setItem(LS, JSON.stringify(out));
    } catch (_) { /* */ }
}

/** Record a result, replacing any earlier run of the same test. */
export function record(result) {
    state.results = state.results.filter(r => r.id !== result.id).concat(result);
    state.results.sort((a, b) => a.id.localeCompare(b.id));
    return result;
}
