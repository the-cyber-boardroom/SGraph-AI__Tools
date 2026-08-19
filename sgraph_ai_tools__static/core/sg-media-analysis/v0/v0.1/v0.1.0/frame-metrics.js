/**
 * frame-metrics — four ways to measure "how much did the screen change?".
 *
 * WHY FOUR. narrated-review ships ONE: mean absolute greyscale difference. That
 * choice was never examined, and it is known to be wrong in both directions for
 * a screencast — a full-screen brightness change reads as enormous, while a
 * dialog opening over an otherwise static page is averaged away to nothing. It
 * is the same species of unexamined constant as the absolute silence threshold
 * that broke segmentation.
 *
 * So compute all four on the same 32×18 raster (matching nr-frames.js, so the
 * numbers are directly comparable to what the pipeline sees), plot them
 * together, and let real recordings say which one separates "the screen changed"
 * from "the cursor moved". Where they DISAGREE is itself the signal: a scroll, a
 * fade and a cursor each disagree differently.
 *
 * @module sg-media-analysis/frame-metrics
 * @version 0.1.0
 */

/** Matches nr-frames.js so probe numbers and pipeline numbers are comparable. */
export const SIG_W = 32, SIG_H = 18;
/** blockMax grid — each tile is 4×2 px of the raster. */
export const BLOCK_X = 8, BLOCK_Y = 8;

export const METRICS = Object.freeze(['meanAbs', 'blockMax', 'edgeDiff', 'histDist']);

/** Human-readable rationale, surfaced in the UI so the choice stays examined. */
export const METRIC_NOTES = Object.freeze({
    meanAbs: 'Mean absolute difference. Cheap and global. Misses a panel opening over a static page; over-reads a brightness change.',
    blockMax: 'Worst tile of an 8×8 grid. Catches LOCALISED change — a menu, a modal, a sidebar — which the mean averages away.',
    edgeDiff: 'Difference of gradient magnitude. Sees layout and structure change; ignores recolouring and theme switches.',
    histDist: 'Histogram distance. Sees palette and brightness change; blind to content moving without changing colour.',
});

/**
 * Signature of an ImageData-like buffer: the three colour planes, the luma plane,
 * its gradient map, and a colour histogram.
 *
 * WHY NOT GREYSCALE ONLY. That was the first implementation, and it silently
 * missed a slide change from `#123a63` to `#7a1e2e` — a violent colour change
 * whose luma differs by nine levels out of 255. Two different colours with
 * similar brightness are identical to a greyscale signature, which in a screencast
 * means a theme switch, a highlighted row or a different application can all pass
 * unnoticed. Per-pixel difference is therefore the MAX across R, G and B; luma is
 * kept for the structural metric, where brightness edges are the point.
 */
export function signatureFrom(rgba) {
    const n = SIG_W * SIG_H;
    const r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n);
    const grey = new Uint8Array(n);
    for (let i = 0, p = 0; p < n; i += 4, p++) {
        r[p] = rgba[i]; g[p] = rgba[i + 1]; b[p] = rgba[i + 2];
        grey[p] = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) | 0;
    }
    return { r, g, b, grey, edges: gradient(grey), hist: histogram(r, g, b) };
}

/** Per-pixel colour distance: the largest change on any channel. */
function colourDelta(a, b, i) {
    return Math.max(
        Math.abs(a.r[i] - b.r[i]),
        Math.abs(a.g[i] - b.g[i]),
        Math.abs(a.b[i] - b.b[i]),
    );
}

/** Sobel-lite gradient magnitude per pixel. */
function gradient(grey) {
    const out = new Uint8Array(grey.length);
    for (let y = 1; y < SIG_H - 1; y++) {
        for (let x = 1; x < SIG_W - 1; x++) {
            const i = y * SIG_W + x;
            const gx = grey[i + 1] - grey[i - 1];
            const gy = grey[i + SIG_W] - grey[i - SIG_W];
            out[i] = Math.min(255, Math.abs(gx) + Math.abs(gy));
        }
    }
    return out;
}

/** 8 bins per channel, concatenated and normalised — sees colour, not just brightness. */
function histogram(r, g, b) {
    const h = new Float32Array(24);
    for (let i = 0; i < r.length; i++) {
        h[r[i] >> 5] += 1;
        h[8 + (g[i] >> 5)] += 1;
        h[16 + (b[i] >> 5)] += 1;
    }
    for (let i = 0; i < h.length; i++) h[i] /= r.length * 3;
    return h;
}

/** Mean absolute difference over a single plane, normalised 0..1. */
function meanAbsPlane(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / (a.length * 255);
}

/** Mean colour distance across the frame, normalised 0..1. */
function meanAbsOf(a, b) {
    let sum = 0;
    for (let i = 0; i < a.grey.length; i++) sum += colourDelta(a, b, i);
    return sum / (a.grey.length * 255);
}

/** Worst tile of the block grid — the localised-change detector. */
function blockMaxOf(a, b) {
    const tw = Math.ceil(SIG_W / BLOCK_X), th = Math.ceil(SIG_H / BLOCK_Y);
    let worst = 0;
    for (let by = 0; by < BLOCK_Y; by++) {
        for (let bx = 0; bx < BLOCK_X; bx++) {
            let sum = 0, n = 0;
            for (let y = by * th; y < Math.min((by + 1) * th, SIG_H); y++) {
                for (let x = bx * tw; x < Math.min((bx + 1) * tw, SIG_W); x++) {
                    sum += colourDelta(a, b, y * SIG_W + x);
                    n += 1;
                }
            }
            if (n) worst = Math.max(worst, sum / (n * 255));
        }
    }
    return worst;
}

/** Total-variation distance between two normalised histograms, 0..1. */
function histDistOf(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / 2;
}

/**
 * All four metrics between two signatures.
 * @param {object} a @param {object} b
 * @returns {{ meanAbs, blockMax, edgeDiff, histDist }}
 */
export function diff(a, b) {
    if (!a || !b) return { meanAbs: 1, blockMax: 1, edgeDiff: 1, histDist: 1 };
    return {
        meanAbs: meanAbsOf(a, b),
        blockMax: blockMaxOf(a, b),
        // Structure only: gradient magnitude of luma, where brightness edges ARE
        // the signal and colour would just add noise.
        edgeDiff: meanAbsPlane(a.edges, b.edges),
        histDist: histDistOf(a.hist, b.hist),
    };
}

/** Per-metric percentile over a trace — thresholds must be per-recording. */
export function metricPercentile(trace, q) {
    const out = {};
    for (const m of METRICS) {
        const sorted = trace.map(t => t[m]).filter(Number.isFinite).sort((x, y) => x - y);
        out[m] = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : 0;
    }
    return out;
}
