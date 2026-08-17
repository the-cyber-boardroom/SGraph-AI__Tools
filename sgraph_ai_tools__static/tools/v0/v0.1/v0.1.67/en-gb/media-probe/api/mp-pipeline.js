/**
 * mp-pipeline.js
 * Orchestration: load → audio → frames → scenes → align → plan.
 *
 * Each lane is independently runnable and idempotent, because they have very
 * different costs. The audio lane is seconds and answers the question that
 * matters most ("will this segment at all?"); the frame lane is the expensive one.
 * Forcing them to run together would stop anyone using the cheap answer.
 *
 * @module mp-pipeline
 */

import { createVad } from '/core/sg-live-capture/v0/v0.1/v0.1.0/live-vad.js';
import * as Audio from '/core/sg-media-analysis/v0/v0.1/v0.1.0/audio-metrics.js';
import * as Dist from '/core/sg-media-analysis/v0/v0.1/v0.1.0/distributions.js';
import * as Sampler from '/core/sg-media-analysis/v0/v0.1/v0.1.0/sampler.js';
import { findScenes, compareMetrics } from '/core/sg-media-analysis/v0/v0.1/v0.1.0/scenes.js';
import { speechOnsets, leadLag } from '/core/sg-media-analysis/v0/v0.1/v0.1.0/align.js';
import { plan as buildPlan, todayFromReplay } from '/core/sg-media-analysis/v0/v0.1/v0.1.0/plan.js';
import { state, config, saveConfig } from './mp-state.js';

let emit = () => {};
export function initPipeline(deps) { emit = deps.emit || emit; }

let sourceFile = null;
let sweepAbort = null;

function need(what) {
    if (!state.source) throw Object.assign(new Error(`${what} needs a source — call loadVideo() first`), { code: 'no-source' });
}

/** Attach a video (or audio) file. No gesture required. */
export async function loadVideo({ file } = {}) {
    if (!file || typeof file.arrayBuffer !== 'function') {
        throw Object.assign(new Error('loadVideo needs { file }'), { code: 'bad-params' });
    }
    state.reset();
    state.status = 'loading';
    sourceFile = file;

    // A picture is optional: an audio-only file is a perfectly valid probe target
    // and the cheap lane still answers the segmentation question.
    let handle = null;
    try {
        handle = await Sampler.openSource(file);
    } catch (err) {
        state.notMeasured.push({ code: 'no-picture', message: `${err.message} — audio-only analysis is still available` });
    }
    state.handle = handle;
    state.source = {
        name: file.name || 'recording', size: file.size || 0,
        durationMs: handle ? handle.durationMs : 0,
        width: handle ? handle.width : 0, height: handle ? handle.height : 0,
        hasAudio: null,                                  // decided by the audio lane
    };
    state.status = 'ready';
    emit('mp:source:loaded', { ...state.source });
    return { ...state.source, sweepEstimate: Sampler.estimateSweep(state.source.durationMs, config) };
}

/**
 * The cheap lane, and the important one: framewise energy, the percentile floor
 * and speech levels, the histogram, the gap populations, and the candidate
 * threshold table.
 */
export async function analyseAudio(p = {}) {
    need('analyseAudio');
    emit('mp:analyse:started', { lane: 'audio' });
    const frameMs = p.frameMs || config.frameMs;
    let a;
    try {
        a = await Audio.analyseAudio(sourceFile, { frameMs, hintName: state.source.name });
    } catch (err) {
        state.source.hasAudio = false;
        throw Object.assign(new Error(`No decodable audio: ${err.message}`), { code: 'not-audio' });
    }
    state.source.hasAudio = true;
    if (!state.source.durationMs) state.source.durationMs = a.durationMs;

    const levels = Dist.energyLevels(a.rms);
    const calibration = Dist.calibrate(levels);
    const histogram = Dist.energyHistogram(a.dbfs);

    // Flatness at the floor vs during speech: room tone is narrow-band, speech is
    // broadband. A loud floor with LOW flatness is the signature of the failure
    // case — quiet-sounding noise that no absolute RMS threshold can see past.
    const floorFrames = [], speechFrames = [];
    for (let i = 0; i < a.frames; i++) (a.rms[i] <= levels.floor ? floorFrames : a.rms[i] >= levels.speech ? speechFrames : []).push(a.flatness[i]);
    const med = xs => (xs.length ? xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)] : null);

    state.audio = {
        ...a, levels, calibration, histogram,
        dbfsLevels: { floor: Audio.toDbfs(levels.floor), speech: Audio.toDbfs(levels.speech) },
        flatnessLevels: { floorMedian: med(floorFrames), speechMedian: med(speechFrames) },
    };
    if (config.threshold == null) config.threshold = calibration.silenceThreshold;

    // Gaps at the calibrated threshold, plus the whole candidate table.
    setThreshold({ value: config.threshold, quiet: true });
    state.thresholds = Dist.thresholdTable(a.rms, frameMs, Dist.candidateThresholds(levels), t => replaySegmentation(t));

    if (!levels.bimodal) {
        emit('mp:warning', { code: 'not-bimodal',
            message: 'The energy histogram has no separable quiet and loud modes, so NO silence threshold can split speech from the floor on this recording. Audio-led segmentation cannot work here.' });
    }
    const zeroTopic = state.gaps.populations.topic.count === 0;
    if (zeroTopic) {
        emit('mp:warning', { code: 'no-topic-gaps',
            message: 'No gaps over 1000 ms at the calibrated threshold — there is nothing for audio-led segmentation to cut on. This is the condition that produced nine identical 30-second captures on a real screencast.' });
    }
    state.lanes.audio = true;
    const summary = { floor: levels.floor, speech: levels.speech, bimodal: levels.bimodal,
        threshold: calibration.silenceThreshold, method: calibration.method,
        topicGaps: state.gaps.populations.topic.count };
    emit('mp:analyse:complete', { lane: 'audio', summary });
    return summary;
}

/** Re-derive the gaps at a threshold. Cheap enough to run on a drag. */
export function setThreshold({ value, quiet } = {}) {
    if (!state.audio) throw Object.assign(new Error('setThreshold needs the audio lane first'), { code: 'no-source' });
    const v = typeof value === 'number' ? value : config.threshold;
    config.threshold = v;
    const all = Dist.findGaps(state.audio.rms, state.audio.frameMs, v);
    state.gaps = { all, populations: Dist.gapPopulations(all), histogram: Dist.gapHistogram(all) };
    const replayed = replaySegmentation({ silenceThreshold: v, speechThreshold: v * 2 });
    state.today = todayFromReplay(replayed);
    if (!quiet) {
        emit('mp:threshold:changed', { value: v, segments: replayed.segments.length, capped: replayed.capped,
            topicGaps: state.gaps.populations.topic.count });
    }
    return { value: v, gaps: all.length, populations: state.gaps.populations,
        segments: replayed.segments.length, capped: replayed.capped };
}

/**
 * Replay the REAL VAD, not a model of it.
 *
 * The `capped` column is only trustworthy if it comes from the same state machine
 * narrated-review runs — hysteresis, pre-roll, hangover, maxUtteranceMs and all. A
 * probe that approximated the pipeline would be free to be wrong in the same
 * direction as the bug it is meant to expose.
 */
export function replaySegmentation(p = {}) {
    if (!state.audio) throw Object.assign(new Error('replaySegmentation needs the audio lane first'), { code: 'no-source' });
    const frameMs = state.audio.frameMs;
    const empty = new Float32Array(0);
    const segments = [];
    let capped = 0;
    const vad = createVad({
        frameMs,
        silenceThreshold: p.silenceThreshold ?? config.threshold,
        speechThreshold: p.speechThreshold ?? (config.threshold * 2),
        endpointMs: p.endpointMs ?? 900,
        preRollMs: p.preRollMs ?? 250,
        minSpeechMs: p.minSpeechMs ?? 400,
        maxUtteranceMs: p.maxUtteranceMs ?? 30000,
        onUtterance: (_pcm, meta) => {
            if (meta.capped) capped += 1;
            segments.push({ tStart: meta.startMs, tEnd: meta.startMs + meta.durationMs, capped: !!meta.capped });
        },
    });
    for (const v of state.audio.rms) vad.pushFrame(v, empty);
    vad.flush();
    return { segments, capped, cappedRatio: segments.length ? capped / segments.length : 0 };
}

/** The expensive lane. Cancellable, progress-reporting, two-pass. */
export async function analyseFrames(p = {}) {
    need('analyseFrames');
    if (!state.handle) throw Object.assign(new Error('This file has no decodable picture in the browser'), { code: 'not-video' });
    for (const k of ['coarseFps', 'fineFps', 'twoPass']) if (p[k] !== undefined) config[k] = p[k];
    saveConfig();
    emit('mp:analyse:started', { lane: 'frames', estimate: Sampler.estimateSweep(state.source.durationMs, config) });
    sweepAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    state.frames = await Sampler.sweep(state.handle, {
        coarseFps: config.coarseFps, fineFps: config.fineFps, twoPass: config.twoPass,
        signal: sweepAbort ? sweepAbort.signal : undefined,
        onProgress: d => emit('mp:analyse:progress', { lane: 'frames', ...d }),
    });
    state.lanes.frames = true;
    findScenesNow({});
    // The filmstrip comes last so it can include a thumbnail at every detected
    // change — a strip that missed the moments the tool detected would be worse
    // than no strip.
    await captureFilmstrip({});
    const summary = { samples: state.frames.trace.length, passes: state.frames.passes, p95: state.frames.p95,
        scenes: state.scenes.scenes.length, filmstrip: state.filmstrip ? state.filmstrip.length : 0 };
    emit('mp:analyse:complete', { lane: 'frames', summary });
    return summary;
}

/**
 * Thumbnails across the recording for the timeline's filmstrip lane, marking the
 * detected scene changes. Independent of the sweep so it can be re-run at a
 * different density without paying for the whole sweep again.
 */
export async function captureFilmstrip(p = {}) {
    if (!state.handle) throw Object.assign(new Error('This file has no decodable picture'), { code: 'not-video' });
    emit('mp:analyse:started', { lane: 'filmstrip' });
    state.filmstrip = await Sampler.filmstrip(state.handle, {
        count: p.count || config.filmstripCount,
        width: p.width || 128,
        extraAt: (state.scenes ? state.scenes.scenes : []).map(s => s.at),
        signal: sweepAbort ? sweepAbort.signal : undefined,
        onProgress: d => emit('mp:analyse:progress', { lane: 'filmstrip', ...d }),
    });
    emit('mp:analyse:complete', { lane: 'filmstrip', summary: { frames: state.filmstrip.length } });
    return { frames: state.filmstrip.length };
}

export function cancelSweep() {
    if (sweepAbort) sweepAbort.abort();
    return { cancelled: true };
}

/** Scene detection over the existing trace — cheap, so re-runnable per metric. */
export function findScenesNow(p = {}) {
    if (!state.frames) throw Object.assign(new Error('findScenes needs the frame lane first'), { code: 'no-source' });
    if (p.metric) { config.sceneMetric = p.metric; saveConfig(); }
    // No `factor` by default: findScenes then uses the natural break in this
    // recording's own distribution. A caller passing `factor` explicitly gets the
    // old percentile behaviour.
    const opts = { metric: config.sceneMetric, p95: state.frames.p95, factor: p.factor,
        threshold: p.threshold, minSceneMs: p.minSceneMs ?? config.minSceneMs };
    const r = findScenes(state.frames.trace, opts);
    // Which metric agrees with which — the empirical answer to "which should we
    // use", a question the single hardcoded metric never asked.
    r.perMetric = compareMetrics(state.frames.trace, { ...opts, reference: config.sceneMetric }).perMetric;
    state.scenes = r;
    state.lanes.scenes = true;
    if (!r.scenes.length) {
        emit('mp:warning', { code: 'no-scenes',
            message: `No scene changes on ${r.metric} (${r.basis}). The picture never changes enough to cut on — video-led segmentation is unavailable.` });
    }
    return { metric: r.metric, threshold: r.threshold, basis: r.basis, scenes: r.scenes.length, perMetric: r.perMetric };
}

/** Measure the picture-leads-words distribution instead of assuming it. */
export function alignSignals(p = {}) {
    if (!state.audio || !state.scenes) {
        throw Object.assign(new Error('alignSignals needs both the audio and frame lanes'), { code: 'no-source' });
    }
    const onsets = speechOnsets(state.audio.rms, state.audio.frameMs,
        p.speechThreshold ?? state.audio.calibration.speechThreshold);
    state.align = leadLag(state.scenes.scenes, onsets, p);
    state.align.onsets = onsets.length;
    state.lanes.align = true;
    if (!state.align.correlated) {
        emit('mp:warning', { code: 'uncorrelated',
            message: `Only ${Math.round(state.align.pairedRatio * 100)}% of scene changes have a speech onset nearby. The pictures and the words in this recording do not track each other, so any pairing will be somewhat arbitrary.` });
    }
    const summary = { count: state.align.count, median: state.align.median, p10: state.align.p10, p90: state.align.p90,
        suggestedLeadMs: state.align.suggestedLeadMs, suggestedLagMs: state.align.suggestedLagMs,
        correlated: state.align.correlated };
    emit('mp:analyse:complete', { lane: 'align', summary });
    return summary;
}

/** The recommendation. Refuses rather than inventing boundaries. */
export function makePlan(p = {}) {
    if (!state.audio && !state.scenes) throw Object.assign(new Error('plan needs at least one lane'), { code: 'no-source' });
    state.plan = buildPlan({
        audio: state.audio ? {
            rms: state.audio.rms, frameMs: state.audio.frameMs, durationMs: state.audio.durationMs,
            levels: state.audio.levels, calibration: state.audio.calibration,
            gaps: state.gaps ? state.gaps.all : [], populations: state.gaps ? state.gaps.populations : {},
        } : {},
        video: state.frames ? { scenes: state.scenes.scenes, trace: state.frames.trace } : { scenes: [] },
        align: state.align,
    }, p);
    emit('mp:plan:ready', { strategy: state.plan.strategy, cuts: state.plan.cuts.length,
        captures: state.plan.estimate.captures, estimateUsd: state.plan.estimate.totalUsd });
    for (const w of state.plan.warnings) emit('mp:warning', w);
    return state.plan;
}

/** Today vs the plan, in captures and in money. */
export function compare() {
    if (!state.plan) makePlan({});
    const today = state.today || { captures: 0, capped: 0, estimate: { totalUsd: 0 } };
    const planned = state.plan.estimate;
    return {
        today, plan: { captures: planned.captures, capped: 0, estimate: planned, strategy: state.plan.strategy },
        delta: {
            captures: planned.captures - today.captures,
            usd: planned.totalUsd - today.estimate.totalUsd,
            forcedCutsRemoved: today.capped - (state.plan.warnings.filter(w => w.code === 'arbitrary-cut').length),
        },
        basis: state.plan.basis,
    };
}

/** Run everything that is possible for this source, cheapest lane first. */
export async function analyseAll(p = {}) {
    need('analyseAll');
    if (state.source.hasAudio !== false) await analyseAudio(p).catch(err => {
        state.notMeasured.push({ code: 'audio-failed', message: err.message });
    });
    if (state.handle) await analyseFrames(p);
    if (state.audio && state.scenes) alignSignals(p);
    makePlan(p);
    return { lanes: { ...state.lanes } };
}

/** For the strip: a thumbnail at a time. */
export function thumbAt(ms, width) {
    if (!state.handle) throw Object.assign(new Error('no picture available'), { code: 'not-video' });
    return Sampler.thumbAt(state.handle, ms, width);
}

/** The optional FFmpeg cross-check. */
export async function runFfmpegLane(p = {}) {
    need('runFfmpegLane');
    const mod = await import('/core/sg-media-analysis/v0/v0.1/v0.1.0/ffmpeg-lane.js');
    emit('mp:ffmpeg:loading', { ratio: 0 });
    const r = await mod.runFfmpegLane(sourceFile, { ...p, onProgress: d => emit('mp:ffmpeg:loading', { ratio: d && d.ratio }) });
    state.ffmpeg = { ...(state.ffmpeg || {}), [r.what]: { rows: r.rows, parsed: r.parsed } };
    emit('mp:ffmpeg:ready', { what: r.what, rows: r.rows });
    return { what: r.what, rows: r.rows, parsed: r.parsed };
}

export function estimateSweep() {
    return Sampler.estimateSweep(state.source ? state.source.durationMs : 0, config);
}
