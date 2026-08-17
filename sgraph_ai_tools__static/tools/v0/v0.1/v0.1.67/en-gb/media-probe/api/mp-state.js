/**
 * mp-state.js
 * The probe result and the config. Plain mutable module state, no DOM.
 *
 * `probe` is the product: the tool's plots are one view of it and `plan()` reads
 * it, but an agent can take it whole. That ordering is deliberate — narrated-review
 * shipped an export whose join between images and words existed only inside a
 * markdown document, and an agent had to parse headings to recover it.
 *
 * @module mp-state
 */

/** Tool configuration (persisted subset → localStorage 'mp-config'). */
export const config = {
    frameMs: 20,               // matches narrated-review's PCM store exactly, so the
                               // numbers here are comparable to what it actually sees
    coarseFps: 1,              // pass 1: everywhere
    fineFps: 10,               // pass 2: only where something moved
    twoPass: true,
    sceneMetric: 'blockMax',   // the localised-change detector — see frame-metrics
    sceneFactor: 1.5,          // × that metric's own p95. Never an absolute value.
    minSceneMs: 1200,
    filmstripCount: 48,        // thumbnails across the whole recording — a fixed
                               // count, because the strip only has room for a few
                               // dozen however long the recording is
    // The threshold the user is currently looking at. Starts null and is filled
    // from the recording's own calibration, never from a constant.
    threshold: null,
};

const PERSISTED = ['coarseFps', 'fineFps', 'twoPass', 'sceneMetric', 'sceneFactor'];
const KEY = 'mp-config';

export function loadConfig() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        for (const k of PERSISTED) if (k in saved) config[k] = saved[k];
    } catch (_) { /* sandboxed frame / disabled storage */ }
}

export function saveConfig() {
    try {
        const out = {};
        for (const k of PERSISTED) out[k] = config[k];
        localStorage.setItem(KEY, JSON.stringify(out));
    } catch (_) { /* */ }
}

export const state = {
    status: 'idle',            // idle | loading | analysing | ready
    source: null,              // { name, size, durationMs, width, height, hasAudio }
    handle: null,              // sampler.openSource() handle — released on reset
    audio: null,               // framewise result + levels + calibration + histogram
    gaps: null,                // { all, populations, histogram }
    thresholds: null,          // the candidate table — the one-glance diagnosis
    frames: null,              // { trace, p95, passes } (signatures stripped for export)
    scenes: null,              // { scenes, threshold, metric } + compareMetrics
    filmstrip: null,           // [{ at, thumb, mark }] — the timeline's screenshot track
    align: null,               // leadLag()
    plan: null,
    today: null,               // what narrated-review would do, from a real replay
    ffmpeg: null,              // { silence?, scene?, loudness? } when the lane is run
    lanes: { audio: false, frames: false, scenes: false, align: false },
    notMeasured: [],           // [{ code, message }] — always present, never implied
    lastError: null,

    reset() {
        if (this.handle) { try { this.handle.release(); } catch (_) { /* */ } }
        this.status = 'idle'; this.source = null; this.handle = null;
        this.audio = null; this.gaps = null; this.thresholds = null;
        this.frames = null; this.scenes = null; this.align = null; this.filmstrip = null;
        this.plan = null; this.today = null; this.ffmpeg = null;
        this.lanes = { audio: false, frames: false, scenes: false, align: false };
        this.notMeasured = []; this.lastError = null;
        config.threshold = null;
    },
};

/**
 * What has NOT been measured, and why.
 *
 * A consumer must be able to tell "no scenes found" from "scene detection never
 * ran". Those are different claims, and conflating them is the failure this whole
 * tool exists to prevent — so the shape makes it impossible to express by
 * accident.
 */
export function notMeasured() {
    const out = [];
    if (!state.lanes.audio) out.push({ code: 'audio-not-run', message: 'analyseAudio() has not been called' });
    if (!state.lanes.frames) out.push({ code: 'frames-not-run', message: 'analyseFrames() has not been called — any scene list is empty because nothing looked' });
    if (!state.lanes.align) out.push({ code: 'align-not-run', message: 'alignSignals() has not been called — the lead/lag window is the assumed default, not measured' });
    if (!state.ffmpeg) out.push({ code: 'ffmpeg-not-run', message: 'the FFmpeg cross-check lane has not been run; all figures are from the browser-native path' });
    return out.concat(state.notMeasured);
}

/** The machine-readable product. Signatures are dropped — they are working data. */
export function probeToJson() {
    return {
        schema: { name: 'media-probe/probe', version: 1 },
        source: state.source,
        config: {
            frameMs: config.frameMs, coarseFps: config.coarseFps, fineFps: config.fineFps,
            twoPass: config.twoPass, signatureRaster: '32x18', blockGrid: '8x8',
            sceneMetric: config.sceneMetric, sceneFactor: config.sceneFactor,
        },
        audio: state.audio && {
            frameMs: state.audio.frameMs, frames: state.audio.frames,
            sampleRate: state.audio.sampleRate, channels: state.audio.channels,
            durationMs: state.audio.durationMs,
            levels: state.audio.levels, calibration: state.audio.calibration,
            dbfs: state.audio.dbfsLevels, flatness: state.audio.flatnessLevels,
            histogram: state.audio.histogram,
        },
        thresholds: state.thresholds,
        gaps: state.gaps && { count: state.gaps.all.length, populations: state.gaps.populations, histogram: state.gaps.histogram },
        frames: state.frames && {
            samples: state.frames.trace.length,
            p95: state.frames.p95,
            trace: state.frames.trace.map(t => ({
                at: t.at, meanAbs: r(t.meanAbs), blockMax: r(t.blockMax),
                edgeDiff: r(t.edgeDiff), histDist: r(t.histDist),
            })),
        },
        scenes: state.scenes && { metric: state.scenes.metric, threshold: r(state.scenes.threshold),
            basis: state.scenes.basis, split: state.scenes.split && { threshold: r(state.scenes.split.threshold),
                separation: r(state.scenes.split.separation), lowMean: r(state.scenes.split.lowMean), highMean: r(state.scenes.split.highMean) },
            count: state.scenes.scenes.length, perMetric: state.scenes.perMetric,
            scenes: state.scenes.scenes.map(s => ({ at: s.at, metric: s.metric, value: r(s.value),
                durationMs: s.durationMs, agreed: s.agreed, burst: s.burst })) },
        align: state.align && { count: state.align.count, pairedRatio: r(state.align.pairedRatio),
            median: state.align.median, p10: state.align.p10, p90: state.align.p90,
            correlated: state.align.correlated,
            suggestedLeadMs: state.align.suggestedLeadMs, suggestedLagMs: state.align.suggestedLagMs },
        today: state.today,
        // Thumbnails are deliberately NOT exported: they are a view, and dozens of
        // base64 JPEGs would dwarf the measurements this file exists to carry.
        filmstrip: state.filmstrip && { frames: state.filmstrip.length, note: 'thumbnails are not exported — call getFilmstrip() in-page' },
        plan: state.plan,
        ffmpeg: state.ffmpeg,
        gaps_in_analysis: notMeasured(),
    };
}

function r(v) { return typeof v === 'number' ? Math.round(v * 100000) / 100000 : v; }
