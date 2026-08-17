/**
 * sampler — walk a video with a hidden <video> element, cheaply.
 *
 * Frame extraction is the slow part of the whole probe: one seek plus a draw per
 * sample, and a seek is milliseconds at best. A naive 10 fps sweep of a
 * one-hour recording is 36 000 seeks, which is minutes of wall clock — and the
 * first thing anyone will try is a long recording.
 *
 * A screencast is static most of the time, so this samples in TWO PASSES: a
 * coarse pass everywhere, then a fine pass only inside the regions where
 * something moved. Same one-hour video: ~3600 + ~800 seeks.
 *
 * @module sg-media-analysis/sampler
 * @version 0.1.0
 */

import { signatureFrom, diff, metricPercentile, METRICS, SIG_W, SIG_H } from './frame-metrics.js';

const SEEK_TIMEOUT_MS = 4000;

/**
 * Attach a video file as a seekable frame source.
 * @param {Blob} file
 * @returns {Promise<{ el, url, durationMs, width, height, release: Function }>}
 */
export async function openSource(file) {
    const el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto';
    el.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;';
    const url = URL.createObjectURL(file);
    el.src = url;
    document.body.appendChild(el);
    const release = () => {
        try { el.pause(); el.removeAttribute('src'); el.remove(); } catch (_) { /* */ }
        try { URL.revokeObjectURL(url); } catch (_) { /* */ }
    };

    await new Promise((resolve, reject) => {
        const ok = () => { clear(); resolve(); };
        const bad = () => { clear(); reject(Object.assign(new Error('Could not decode this video in the browser'), { code: 'not-video' })); };
        const clear = () => { el.removeEventListener('loadedmetadata', ok); el.removeEventListener('error', bad); clearTimeout(timer); };
        const timer = setTimeout(bad, 15000);
        el.addEventListener('loadedmetadata', ok, { once: true });
        el.addEventListener('error', bad, { once: true });
    }).catch(err => { release(); throw err; });

    if (!el.videoWidth) {
        release();
        throw Object.assign(new Error('This video has no decodable picture in the browser (HEVC .mov is the usual cause — use the FFmpeg lane)'), { code: 'not-video' });
    }
    // A MediaRecorder WebM has no duration in its header, so video.duration is
    // Infinity and every seek would clamp to zero. Force a scan to the end.
    const durationMs = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : await forceDuration(el);
    return { el, url, durationMs, width: el.videoWidth, height: el.videoHeight, release };
}

function forceDuration(el) {
    return new Promise(resolve => {
        const finish = () => {
            el.removeEventListener('durationchange', onChange); clearTimeout(timer);
            const ms = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0;
            try { el.currentTime = 0; } catch (_) { /* */ }
            resolve(ms);
        };
        const onChange = () => { if (Number.isFinite(el.duration)) finish(); };
        const timer = setTimeout(finish, 5000);
        el.addEventListener('durationchange', onChange);
        try { el.currentTime = 1e101; } catch (_) { finish(); }
    });
}

/** Seek and wait for the frame. Resolves on timeout too — a stale frame beats a hang. */
function seek(el, durationMs, ms) {
    const sec = Math.max(0, Math.min(durationMs / 1000 - 0.05, ms / 1000));
    if (Math.abs(el.currentTime - sec) < 0.005 && el.readyState >= 2) return Promise.resolve();
    return new Promise(resolve => {
        const done = () => { el.removeEventListener('seeked', done); clearTimeout(timer); resolve(); };
        const timer = setTimeout(done, SEEK_TIMEOUT_MS);
        el.addEventListener('seeked', done, { once: true });
        el.currentTime = sec;
    });
}

/** Sample the signature at one time. */
export async function signatureAt(src, ms, canvas) {
    await seek(src.el, src.durationMs, ms);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = SIG_W; canvas.height = SIG_H;
    ctx.drawImage(src.el, 0, 0, SIG_W, SIG_H);
    return signatureFrom(ctx.getImageData(0, 0, SIG_W, SIG_H).data);
}

/** A JPEG thumbnail at one time, for the scene strip. */
export async function thumbAt(src, ms, width = 200) {
    await seek(src.el, src.durationMs, ms);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.max(1, Math.round(width * src.height / src.width));
    c.getContext('2d').drawImage(src.el, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.6);
}

/**
 * A filmstrip for the timeline: thumbnails spread across the recording, plus one
 * at each moment of interest.
 *
 * A FIXED COUNT, not a fixed interval. One thumbnail per second would be 3600
 * images and tens of megabytes on an hour-long recording; the strip only ever has
 * room for a few dozen side by side, so capturing more is pure waste. `extraAt`
 * guarantees the detected changes are among them — a strip that missed the very
 * moments the tool detected would be worse than no strip.
 *
 * @param {object} src from openSource()
 * @param {{ count?: number, extraAt?: number[], width?: number, onProgress?: Function, signal?: object }} opts
 * @returns {Promise<Array<{ at: number, thumb: string, mark: boolean }>>}
 */
export async function filmstrip(src, opts = {}) {
    const count = Math.max(2, opts.count || 48);
    const width = opts.width || 128;
    const extra = (opts.extraAt || []).filter(t => t >= 0 && t <= src.durationMs);
    const step = src.durationMs / count;
    const marks = new Set(extra.map(t => Math.round(t)));
    const times = new Set(extra.map(t => Math.round(t)));
    for (let i = 0; i < count; i++) times.add(Math.round(i * step));

    const ordered = [...times].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < ordered.length; i++) {
        if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
        const at = ordered[i];
        out.push({ at, thumb: await thumbAt(src, at, width), mark: marks.has(at) });
        if (opts.onProgress && i % 5 === 0) opts.onProgress({ pass: 'filmstrip', done: i + 1, total: ordered.length });
    }
    return out;
}

/**
 * How long a sweep will take, before committing to it. The estimate exists so
 * the UI can warn instead of appearing to hang — a probe nobody dares start is
 * worth nothing.
 * @returns {{ samples, estimatedMs }}
 */
export function estimateSweep(durationMs, { coarseFps = 1, fineFps = 10, twoPass = true } = {}) {
    const coarse = Math.ceil(durationMs / 1000 * coarseFps);
    // Assume ~10% of a screencast is in motion — corrected by the real pass.
    const fine = twoPass ? Math.ceil(durationMs / 1000 * 0.10 * fineFps) : Math.ceil(durationMs / 1000 * fineFps);
    const samples = coarse + fine;
    return { samples, estimatedMs: samples * 12 };      // ~12 ms per seek+draw, measured
}

/**
 * Sweep the video and return the metric trace.
 *
 * @param {object} src from openSource()
 * @param {{ coarseFps?, fineFps?, twoPass?, onProgress?, signal? }} opts
 * @returns {Promise<{ trace: Array<{at, meanAbs, blockMax, edgeDiff, histDist}>, p95, passes }>}
 */
export async function sweep(src, opts = {}) {
    const { coarseFps = 1, fineFps = 10, twoPass = true, onProgress, signal } = opts;
    const canvas = document.createElement('canvas');
    const abort = () => { if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' }); };

    // ── Pass 1: coarse, everywhere ────────────────────────────────────────────
    const coarseStep = Math.max(1, Math.round(1000 / coarseFps));
    const coarse = [];
    let prev = null;
    const total1 = Math.ceil(src.durationMs / coarseStep);
    for (let at = 0, i = 0; at < src.durationMs; at += coarseStep, i++) {
        abort();
        const sig = await signatureAt(src, at, canvas);
        coarse.push({ at, sig, ...diff(prev, sig), first: prev === null });
        prev = sig;
        if (onProgress && i % 10 === 0) onProgress({ pass: 1, done: i, total: total1 });
    }
    // The first sample has no predecessor; a diff of 1 there would poison every
    // percentile, so it is recorded as zero and flagged.
    if (coarse.length) for (const m of METRICS) coarse[0][m] = 0;

    const p95 = metricPercentile(coarse, 0.95);

    // ── Pass 2: fine, only where something moved ──────────────────────────────
    let fine = [];
    if (twoPass && coarse.length > 1) {
        const regions = [];
        for (let i = 1; i < coarse.length; i++) {
            const moved = METRICS.some(m => coarse[i][m] > Math.max(p95[m], 0.004));
            if (moved) regions.push([Math.max(0, coarse[i].at - coarseStep), coarse[i].at + coarseStep]);
        }
        const merged = [];
        for (const r of regions) {
            const last = merged[merged.length - 1];
            if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
            else merged.push(r.slice());
        }
        const fineStep = Math.max(1, Math.round(1000 / fineFps));
        let done = 0;
        const total2 = merged.reduce((n, [a, b]) => n + Math.ceil((b - a) / fineStep), 0);
        for (const [a, b] of merged) {
            let p = null;
            for (let at = a; at <= b; at += fineStep) {
                abort();
                const sig = await signatureAt(src, at, canvas);
                if (p) fine.push({ at, sig, ...diff(p, sig) });
                p = sig;
                if (onProgress && ++done % 10 === 0) onProgress({ pass: 2, done, total: total2 });
            }
        }
    }

    // Fine samples supersede coarse ones in their regions.
    const byTime = new Map();
    for (const s of coarse) byTime.set(s.at, s);
    for (const s of fine) byTime.set(s.at, s);
    const trace = [...byTime.values()].sort((a, b) => a.at - b.at);
    return { trace, p95: metricPercentile(trace, 0.95), passes: twoPass ? 2 : 1 };
}
