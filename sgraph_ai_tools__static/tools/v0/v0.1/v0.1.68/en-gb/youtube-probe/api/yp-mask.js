/**
 * yp-mask.js
 * Region masking for frame analysis — the pack's Decision 3, made runnable.
 *
 * THE HYPOTHESIS THIS EXISTS TO TEST. Every metric in `core/sg-media-analysis`
 * assumes the frame IS the content, because it was built for screencasts. A
 * conference recording is a moving human with the slides as a region, so the
 * speaker is continuous low-level change and a slide advance is an occasional
 * localised one. `blockMax` — the metric that exists precisely to catch localised
 * change — should therefore fire on the speaker's hands as readily as on a new
 * slide, and the Otsu split should land somewhere inside "human moving".
 *
 * That is a prediction, not a finding. yp-suite.js measures it both ways.
 *
 * NO CORE CHANGE IS NEEDED to try this. `signatureFrom()` takes pixels, and
 * `drawImage` already accepts a source rectangle — so masking is just cropping
 * before the draw. Everything downstream (diff, otsuSplit, findScenes, plan) is
 * untouched because none of it ever sees pixels. If the measurement says masking
 * helps, THEN it earns a place in core.
 *
 * @module yp-mask
 */

import { signatureFrom, SIG_W, SIG_H, METRICS, diff }
    from '/core/sg-media-analysis/v0/v0.1/v0.1.0/frame-metrics.js';

/** The whole frame. Mask rectangles are fractions, so they survive any resolution. */
export const FULL_FRAME = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

const GRID_X = 16, GRID_Y = 9;
export const MASK_GRID = Object.freeze({ x: GRID_X, y: GRID_Y });

let _canvas = null;

/**
 * Signature of one region of a frame source.
 * @param {CanvasImageSource} source a <video>, canvas or image
 * @param {{ x,y,w,h }} mask fractions of the frame
 * @param {{ width, height }} dims the source's natural size
 */
export function maskedSignature(source, mask = FULL_FRAME, dims = {}) {
    const w = dims.width || source.videoWidth || source.width;
    const h = dims.height || source.videoHeight || source.height;
    const sx = Math.max(0, Math.round(mask.x * w));
    const sy = Math.max(0, Math.round(mask.y * h));
    const sw = Math.max(1, Math.round(mask.w * w));
    const sh = Math.max(1, Math.round(mask.h * h));
    _canvas = _canvas || document.createElement('canvas');
    _canvas.width = SIG_W; _canvas.height = SIG_H;
    const ctx = _canvas.getContext('2d', { willReadFrequently: true });
    // The one line that is the whole feature: a source rectangle.
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, SIG_W, SIG_H);
    return signatureFrom(ctx.getImageData(0, 0, SIG_W, SIG_H).data);
}

/** A metric trace over a masked region — same shape sampler.sweep() produces. */
export function traceFromSignatures(sigs) {
    const trace = [];
    let prev = null;
    for (const { at, sig } of sigs) {
        trace.push({ at, sig, ...diff(prev, sig), first: prev === null });
        prev = sig;
    }
    if (trace.length) for (const m of METRICS) trace[0][m] = 0;
    return trace;
}

/**
 * Propose a slide rectangle from how the frame varies over time.
 *
 * THE IDEA: over a talk, the slide region changes RARELY BUT COMPLETELY, while
 * the speaker region changes CONSTANTLY. So the discriminator is SPARSITY — how
 * few of the samples a cell changes on — combined with how big that change is.
 *
 *   slide cell    3 changes in 70 samples, each enormous   → sparse, big
 *   speaker cell  changes on nearly every sample, moderate → dense
 *   background    never changes                            → excluded by the floor
 *
 * MEASURED WRONG TURN, kept as a warning. The first version scored PEAKINESS
 * (max ÷ mean) on the reasoning that a slide is "quiet, quiet, enormous". That
 * heuristic picked the SPEAKER: an arm swinging sinusoidally, sampled every
 * 250 ms, produces deltas that are sometimes near zero (at the turning points)
 * and sometimes large, which is a high max-over-mean. Periodic motion looks
 * exactly like rare motion to a ratio that cannot see WHEN the changes happened.
 * Counting how many samples changed fixes it, because that is the property that
 * actually differs.
 *
 * @param {Array<{at:number, full:Uint8ClampedArray}>} frames coarse RGBA at grid resolution
 * @returns {{ mask, confidence, basis, cells }}
 */
export function suggestMask(frames) {
    if (!frames || frames.length < 4) {
        return { mask: FULL_FRAME, confidence: 0, basis: 'too few frames to suggest — using the whole frame', cells: [] };
    }
    const n = GRID_X * GRID_Y;
    const steps = frames.length - 1;
    const maxes = new Float64Array(n);
    const deltas = Array.from({ length: n }, () => []);
    for (let f = 1; f < frames.length; f++) {
        const a = frames[f - 1].full, b = frames[f].full;
        for (let c = 0; c < n; c++) {
            const i = c * 4;
            const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) / 255;
            deltas[c].push(d);
            if (d > maxes[c]) maxes[c] = d;
        }
    }
    const peak = [];
    for (let c = 0; c < n; c++) {
        // A cell that never meaningfully changes is background, not a slide.
        if (maxes[c] < 0.05) { peak.push(0); continue; }
        // How OFTEN did it change, relative to its own biggest change? Sparse is
        // the signal; dense is a moving human.
        const active = deltas[c].filter(d => d > maxes[c] * 0.2).length / steps;
        peak.push(maxes[c] * Math.max(0, 1 - active * 2));
    }
    const sorted = peak.slice().sort((a, b) => a - b);
    const cut = sorted[Math.floor(sorted.length * 0.75)] || 0;
    const hot = [];
    for (let c = 0; c < n; c++) if (peak[c] > 0 && peak[c] >= cut) hot.push(c);
    if (hot.length < 4) {
        return { mask: FULL_FRAME, confidence: 0, basis: 'no region stood out — using the whole frame', cells: [] };
    }

    // Take the largest CONNECTED BLOB of hot cells, not the bounding box of all
    // of them. Measured: the first implementation used the bounding box and
    // returned 96% of the frame (IoU 0.45 against the known slide rectangle),
    // because a handful of scattered speaker cells also clear the percentile and
    // a box containing both regions contains everything between them. A slide is
    // one contiguous rectangle; scattered cells are not it.
    const chosen = largestComponent(hot);
    if (chosen.length < 4) {
        return { mask: FULL_FRAME, confidence: 0, basis: 'no contiguous region stood out — using the whole frame', cells: [] };
    }
    let x0 = GRID_X, x1 = -1, y0 = GRID_Y, y1 = -1;
    for (const c of chosen) {
        const cx = c % GRID_X, cy = (c / GRID_X) | 0;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx);
        y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
    }
    const mask = {
        x: Math.max(0, x0 / GRID_X - 0.01), y: Math.max(0, y0 / GRID_Y - 0.01),
        w: Math.min(1, (x1 - x0 + 1) / GRID_X + 0.02), h: Math.min(1, (y1 - y0 + 1) / GRID_Y + 0.02),
    };
    const area = mask.w * mask.h;
    return {
        mask, cells: chosen,
        // A "suggestion" covering the whole frame is not a suggestion. Confidence
        // falls away as the box approaches everything.
        confidence: area >= 0.9 ? 0 : Math.min(1, (1 - area) * (chosen.length / n) * 4),
        basis: `largest contiguous blob of ${chosen.length} cells (of ${hot.length} sparse-and-big, ${n} total)`,
    };
}

/** Largest 4-connected run of cells, by flood fill over the grid. */
function largestComponent(cells) {
    const set = new Set(cells);
    const seen = new Set();
    let best = [];
    for (const start of cells) {
        if (seen.has(start)) continue;
        const blob = [];
        const stack = [start];
        seen.add(start);
        while (stack.length) {
            const c = stack.pop();
            blob.push(c);
            const cx = c % GRID_X, cy = (c / GRID_X) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= GRID_X || ny >= GRID_Y) continue;
                const nc = ny * GRID_X + nx;
                if (set.has(nc) && !seen.has(nc)) { seen.add(nc); stack.push(nc); }
            }
        }
        if (blob.length > best.length) best = blob;
    }
    return best;
}

/** Coarse RGBA at grid resolution — the input suggestMask wants. */
export function gridSample(source, dims = {}) {
    const c = document.createElement('canvas');
    c.width = GRID_X; c.height = GRID_Y;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, dims.width || source.videoWidth || source.width,
        dims.height || source.videoHeight || source.height, 0, 0, GRID_X, GRID_Y);
    return ctx.getImageData(0, 0, GRID_X, GRID_Y).data;
}
