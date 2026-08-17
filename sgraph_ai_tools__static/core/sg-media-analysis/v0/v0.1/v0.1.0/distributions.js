/**
 * distributions — turn framewise energy into the pictures that make a threshold
 * decision obvious.
 *
 * THIS MODULE IS THE POINT OF THE WHOLE TOOL. The defect it exists to prevent
 * was not a badly chosen number; it was comparing an absolute number against an
 * unknown distribution. A 4m21s screencast yielded three sustained silences
 * because its noise floor sat ABOVE the fixed 0.01 RMS threshold — invisible,
 * because nothing plotted the distribution.
 *
 * So the primary outputs here are:
 *   - an energy histogram with the floor and speech modes located,
 *   - a gap-length histogram split into word / sentence / topic populations,
 *   - and a table evaluating EVERY candidate threshold at once.
 *
 * If the topic population is empty at every threshold, audio-led segmentation
 * cannot work on that recording — and you know it in one glance, for free,
 * before spending anything on a model.
 *
 * @module sg-media-analysis/distributions
 * @version 0.1.0
 */

/**
 * Gap-length populations. The boundaries are not arbitrary: ordinary word gaps
 * in connected speech run ~100–150 ms, which is why snapping to "the nearest
 * quiet moment" lands mid-sentence (measured in narrated-review v0.1.1).
 */
export const POPULATIONS = Object.freeze([
    { key: 'word', label: 'word gaps', minMs: 0, maxMs: 300, boundary: false },
    { key: 'sentence', label: 'sentence gaps', minMs: 300, maxMs: 1000, boundary: 'maybe' },
    { key: 'topic', label: 'topic gaps', minMs: 1000, maxMs: Infinity, boundary: true },
]);

/** Value at a quantile of an already-sorted array. */
function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
    return sorted[i];
}

/**
 * Locate the noise floor and the speaking level as percentiles of this
 * recording's own energy, and say whether they are actually separable.
 *
 * `bimodal` is the honest caveat: if the floor and speech percentiles are close,
 * there is no quiet/loud distinction to threshold and any threshold will be
 * arbitrary. Reporting that beats returning a confident number.
 *
 * @param {ArrayLike<number>} rms
 * @returns {{ floor, speech, range, bimodal, p: object }}
 */
export function energyLevels(rms) {
    const sorted = Array.from(rms).filter(Number.isFinite).sort((a, b) => a - b);
    const p = {
        p05: quantile(sorted, 0.05), p20: quantile(sorted, 0.20), p50: quantile(sorted, 0.50),
        p80: quantile(sorted, 0.80), p90: quantile(sorted, 0.90), p99: quantile(sorted, 0.99),
    };
    const floor = p.p20;
    const speech = p.p90;
    const range = speech - floor;
    return { floor, speech, range, bimodal: range > 0.005 && speech > floor * 1.8, p };
}

/**
 * Thresholds derived from the levels — the same rule narrated-review v0.1.5
 * ships in `calibrateVad`, kept here so the probe and the pipeline cannot drift
 * apart about what "calibrated" means.
 */
export function calibrate(levels, fallback = { silenceThreshold: 0.01, speechThreshold: 0.02 }) {
    if (!levels.bimodal) {
        return { ...fallback, method: 'defaults (no usable dynamic range)' };
    }
    return {
        silenceThreshold: levels.floor + 0.15 * levels.range,
        speechThreshold: levels.floor + 0.40 * levels.range,
        method: 'calibrated from this recording',
    };
}

/**
 * Histogram of framewise energy, in dBFS bins (the scale the tooling and the
 * ear both use — linear RMS bins crowd everything quiet into one bar).
 * @returns {{ bins: Array<{ db, count }>, max: number }}
 */
export function energyHistogram(dbfs, binDb = 2) {
    const counts = new Map();
    let max = 0;
    for (const v of dbfs) {
        if (!Number.isFinite(v)) continue;
        const b = Math.floor(v / binDb) * binDb;
        const c = (counts.get(b) || 0) + 1;
        counts.set(b, c);
        if (c > max) max = c;
    }
    const bins = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([db, count]) => ({ db, count }));
    return { bins, max };
}

/**
 * Every run of frames at or below `threshold`, as gaps.
 * @returns {Array<{ tMs, durationMs, endMs }>}
 */
export function findGaps(rms, frameMs, threshold) {
    const gaps = [];
    let run = 0;
    for (let i = 0; i <= rms.length; i++) {
        const quiet = i < rms.length && rms[i] <= threshold;
        if (quiet) { run += 1; continue; }
        if (run > 0) {
            gaps.push({ tMs: (i - run) * frameMs, durationMs: run * frameMs, endMs: i * frameMs });
            run = 0;
        }
    }
    return gaps;
}

/** Split a gap list into the word / sentence / topic populations. */
export function gapPopulations(gaps) {
    const out = {};
    for (const pop of POPULATIONS) {
        const inPop = gaps.filter(g => g.durationMs >= pop.minMs && g.durationMs < pop.maxMs);
        const lens = inPop.map(g => g.durationMs).sort((a, b) => a - b);
        out[pop.key] = {
            label: pop.label, count: inPop.length,
            medianMs: lens.length ? lens[Math.floor(lens.length / 2)] : null,
            boundary: pop.boundary,
        };
    }
    return out;
}

/** Histogram of gap lengths, log-ish bins so word and topic gaps both show. */
export function gapHistogram(gaps) {
    const edges = [0, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000, 3000, 5000, Infinity];
    const bins = [];
    for (let i = 0; i < edges.length - 1; i++) {
        bins.push({ fromMs: edges[i], toMs: edges[i + 1], count: 0 });
    }
    for (const g of gaps) {
        const b = bins.find(x => g.durationMs >= x.fromMs && g.durationMs < x.toMs);
        if (b) b.count += 1;
    }
    return { bins, max: bins.reduce((m, b) => Math.max(m, b.count), 0) };
}

/**
 * Evaluate a whole set of candidate thresholds at once — the table that would
 * have made the original failure a one-glance diagnosis.
 *
 * `replay` is injected (the real `createVad` from core/sg-live-capture) so the
 * `capped` column reports what the ACTUAL pipeline would do, not an
 * approximation of it. A probe that models the pipeline instead of running it
 * would be free to be wrong in the same direction as the bug.
 *
 * @param {ArrayLike<number>} rms
 * @param {number} frameMs
 * @param {number[]} candidates
 * @param {(t:{silenceThreshold:number, speechThreshold:number}) => {segments:Array, capped:number}} replay
 */
export function thresholdTable(rms, frameMs, candidates, replay) {
    return candidates.map(value => {
        const gaps = findGaps(rms, frameMs, value);
        const pops = gapPopulations(gaps);
        const row = {
            value,
            db: Math.round(20 * Math.log10(Math.max(value, 1e-5)) * 10) / 10,
            gaps: gaps.length,
            topicGaps: pops.topic.count,
            sentenceGaps: pops.sentence.count,
        };
        if (replay) {
            const r = replay({ silenceThreshold: value, speechThreshold: value * 2 });
            row.segments = r.segments.length;
            row.capped = r.capped;
            row.cappedRatio = r.segments.length ? r.capped / r.segments.length : 0;
        }
        return row;
    });
}

/**
 * A spread of candidates spanning this recording's own range, plus the legacy
 * fixed value.
 *
 * Values are NOT rounded. The 0.15 factor reproduces `calibrate()` exactly, so the
 * table always contains a row for the threshold actually in use — rounding for
 * tidiness would mean the active row could never be identified, in the UI or by a
 * caller. Formatting is the display layer's job.
 */
export function candidateThresholds(levels) {
    const out = new Set([0.01]);                       // the value that failed — always shown
    if (levels.range > 0) {
        for (const f of [0.05, 0.10, 0.15, 0.25, 0.40, 0.60]) {
            out.add(levels.floor + f * levels.range);
        }
    }
    return [...out].sort((a, b) => a - b);
}
