/**
 * nr-capture.js
 * Continuous capture over one session timeline:
 *   - screen: getDisplayMedia stream (core/sg-capture v0.1.1) kept live behind a
 *     hidden <video> purely as a frame source — NEVER recorded (Decision 1);
 *   - mic: core/sg-live-capture createCapture — per-frame mono PCM + RMS from an
 *     AudioWorklet, plus the compact continuous webm TAKE (Decision 2).
 *
 * The session clock is the AUDIO clock (frames seen × frameMs) so PCM slices
 * are sample-accurate regardless of main-thread jitter. PCM frames are stored
 * Int16 (~1.9 MB/min at 16 kHz) for the whole session so boundaries stay
 * adjustable in review; the RMS log drives boundary snapping + suggestions.
 *
 * @module nr-capture
 */

import { getScreenStream, stopStream } from '/core/sg-capture/v0/v0.1/v0.1.1/sg-capture.js';
import { createCapture } from '/core/sg-live-capture/v0/v0.1/v0.1.0/live-capture.js';
import { config, state } from './nr-state.js';

const cap = {
    screenStream: null,
    videoEl: null,
    mic: null,               // handle from createCapture
    frames: [],              // Int16Array per frame, session-long
    rms: [],                 // per-frame RMS, same indexing
    framesSeen: 0,
    silentRun: 0,
    suggestionOpen: false,
    onSuggestion: null,      // (tMs) => void, set by nr-api
};

/** ms per stored frame (fixed at capture start). */
let frameMs = 20;

/** Current session time in ms — the audio clock. */
export function nowMs() {
    return Math.round(cap.framesSeen * frameMs);
}

function ingestFrame(rms, floatFrame) {
    const int16 = new Int16Array(floatFrame.length);
    for (let i = 0; i < floatFrame.length; i++) {
        const s = Math.max(-1, Math.min(1, floatFrame[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    cap.frames.push(int16);
    cap.rms.push(rms);
    cap.framesSeen += 1;

    // Suggestion detection: a sustained unmarked silence gets one faint tick.
    if (rms <= config.silenceThreshold) {
        cap.silentRun += 1;
        const runMs = cap.silentRun * frameMs;
        if (!cap.suggestionOpen && runMs >= config.suggestionSilenceMs) {
            cap.suggestionOpen = true;
            const t = nowMs() - Math.round(runMs / 2);
            state.suggestions.push(t);
            if (cap.onSuggestion) cap.onSuggestion(t);
        }
    } else {
        cap.silentRun = 0;
        cap.suggestionOpen = false;
    }
}

/**
 * Start live capture. MUST be called from a user gesture (screen picker).
 * @returns {Promise<{ screen: {width,height}, sampleRate: number, mimeType: string }>}
 */
export async function startCapture() {
    if (state.status === 'capturing') throw Object.assign(new Error('Session already capturing'), { code: 'no-session' });
    frameMs = config.frameMs;
    cap.frames = []; cap.rms = []; cap.framesSeen = 0;
    cap.silentRun = 0; cap.suggestionOpen = false;

    // Screen first — the gesture constraint (sg-capture doc).
    cap.screenStream = await getScreenStream({ audio: false }).catch(err => {
        throw Object.assign(new Error(err.message || 'Screen capture unavailable or cancelled'), { code: 'screen-unavailable' });
    });
    const track = cap.screenStream.getVideoTracks()[0];
    const settings = track ? track.getSettings() : {};
    const screen = { width: settings.width || 1280, height: settings.height || 720 };

    // Hidden frame source.
    const v = document.createElement('video');
    v.muted = true; v.autoplay = true; v.playsInline = true;
    v.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;';
    v.srcObject = cap.screenStream;
    document.body.appendChild(v);
    await new Promise(res => { if (v.readyState >= 2) res(); else { v.onloadeddata = res; v.play().catch(() => {}); } });
    cap.videoEl = v;

    // Mic: continuous PCM + take (rejects {code:'mic-unavailable'} in sandboxes).
    try {
        cap.mic = await createCapture({ onFrame: ingestFrame, frameMs, targetRate: 16000 });
    } catch (err) {
        _releaseScreen();
        throw err;
    }
    state.sampleRate = cap.mic.sampleRate;
    // Recompute against the REAL context rate (some browsers ignore a forced 16k).
    return { screen, sampleRate: cap.mic.sampleRate, mimeType: cap.mic.mimeType };
}

/**
 * Grab a screenshot from the live screen stream at this instant.
 * @returns {Promise<Blob|null>} full-resolution PNG, or null if no screen.
 */
export async function grabFrame() {
    const v = cap.videoEl;
    if (!v || !v.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    return new Promise(res => canvas.toBlob(b => res(b), 'image/png'));
}

/**
 * Stop capture: finalise the take, release mic + screen.
 * @returns {Promise<{ blob: Blob, mimeType: string }|null>} the saved take
 */
export async function stopCapture() {
    let take = null;
    if (cap.mic) { take = await cap.mic.stop(); cap.mic = null; }
    _releaseScreen();
    return take;
}

function _releaseScreen() {
    if (cap.videoEl) { try { cap.videoEl.srcObject = null; cap.videoEl.remove(); } catch (_) { /* */ } cap.videoEl = null; }
    if (cap.screenStream) { stopStream(cap.screenStream); cap.screenStream = null; }
}

/**
 * Slice stored PCM into a Float32 mono buffer for `[tStart, tEnd)` ms.
 * @param {number} tStart @param {number} tEnd
 * @returns {{ channelData: Float32Array[], sampleRate: number, durationMs: number }}
 */
export function slicePcm(tStart, tEnd) {
    const from = Math.max(0, Math.floor(tStart / frameMs));
    const to = Math.min(cap.frames.length, Math.ceil(tEnd / frameMs));
    let total = 0;
    for (let i = from; i < to; i++) total += cap.frames[i].length;
    const out = new Float32Array(total);
    let off = 0;
    for (let i = from; i < to; i++) {
        const f = cap.frames[i];
        for (let j = 0; j < f.length; j++) out[off + j] = f[j] / 0x8000;
        off += f.length;
    }
    return { channelData: [out], sampleRate: state.sampleRate, durationMs: (to - from) * frameMs };
}

/**
 * Boundary snap (Decision 2) — recover the start of the sentence the narrator
 * had already begun when they pressed.
 *
 * The gap must be SUSTAINED (`minSilenceMs`, default 400 ms). Requiring only a
 * short dip fails on real speech: ordinary word gaps and plosives are ~120 ms,
 * so the snap lands mid-sentence. That was measured against live narration —
 * every segment lost ~3 s off the front and bled into the next utterance.
 *
 * We take the LATEST qualifying gap in the window, which is the one immediately
 * before the current utterance, then back off `snapPreRollMs` so the onset is
 * not clipped. Because "latest" is self-correcting, a generous `lookbackMs` is
 * safe and handles long utterances.
 *
 * @param {number} t press time (ms)
 * @returns {number} snapped boundary (ms)
 */
export function snapBoundary(t) {
    const from = Math.max(0, Math.floor((t - config.lookbackMs) / frameMs));
    const to = Math.min(cap.rms.length, Math.floor(t / frameMs));
    const needed = Math.max(1, Math.round(config.minSilenceMs / frameMs));
    let run = 0;
    let best = -1;
    for (let i = from; i < to; i++) {
        if (cap.rms[i] <= config.silenceThreshold) {
            run += 1;
            if (run >= needed) best = i;   // last frame of a qualifying gap
        } else run = 0;
    }
    if (best >= 0) return Math.max(0, Math.round(best * frameMs) - config.snapPreRollMs);
    return Math.max(0, t - config.fallbackLeadMs);
}

/**
 * Headless import: an audio file becomes the take + the PCM store, so the whole
 * pipeline (markAt → transcribe → clean → document) runs with no gestures.
 * @param {Blob} file
 * @returns {Promise<{ durationMs: number, sampleRate: number }>}
 */
export async function importRecording(file) {
    frameMs = config.frameMs;
    cap.frames = []; cap.rms = []; cap.framesSeen = 0;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    let audio;
    try {
        audio = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch (err) {
        try { await ctx.close(); } catch (_) { /* */ }
        throw Object.assign(new Error('Could not decode audio file'), { code: 'not-audio' });
    }
    const sampleRate = audio.sampleRate;
    const mono = new Float32Array(audio.length);
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
        const d = audio.getChannelData(ch);
        for (let i = 0; i < d.length; i++) mono[i] += d[i] / audio.numberOfChannels;
    }
    try { await ctx.close(); } catch (_) { /* */ }

    const frameSamples = Math.max(1, Math.round(frameMs * sampleRate / 1000));
    for (let off = 0; off < mono.length; off += frameSamples) {
        const frame = mono.subarray(off, Math.min(off + frameSamples, mono.length));
        let s = 0;
        for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
        ingestFrame(Math.sqrt(s / (frame.length || 1)), frame);
    }
    state.sampleRate = sampleRate;
    return { durationMs: nowMs(), sampleRate };
}

/** Free the PCM store (reset). */
export function clearCapture() {
    cap.frames = []; cap.rms = []; cap.framesSeen = 0;
    cap.silentRun = 0; cap.suggestionOpen = false;
    _releaseScreen();
    if (cap.mic) { cap.mic.stop().catch(() => {}); cap.mic = null; }
}

/** @param {(t:number)=>void} fn */
export function onSuggestion(fn) { cap.onSuggestion = fn; }

/**
 * The per-frame energy log for the whole loaded recording.
 *
 * Exposed (read-only in practice) so the video-import path can run the same VAD
 * over it that the live path runs at capture time — the energy is all the
 * segmenter needs, and the samples themselves stay here.
 * @returns {number[]}
 */
export function rmsLog() { return cap.rms; }

/** ms per stored frame — the resolution of every time in the store. */
export function getFrameMs() { return frameMs; }

/** True while a live screen stream is attached. */
export function hasScreen() { return !!cap.videoEl; }
