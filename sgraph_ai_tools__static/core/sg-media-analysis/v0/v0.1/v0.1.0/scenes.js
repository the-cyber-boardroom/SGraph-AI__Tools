/**
 * scenes — a metric trace becomes a list of screen changes, each carrying the
 * evidence that produced it.
 *
 * Every scene keeps `metric`, `value` and the threshold it beat, because a scene
 * with no visible reason is exactly how the previous generation of this code went
 * wrong: it produced confident boundaries nobody could interrogate.
 *
 * @module sg-media-analysis/scenes
 * @version 0.1.0
 */

import { METRICS } from './frame-metrics.js';

/**
 * Split a set of difference values into "static" and "changed" by maximising
 * between-class variance (Otsu's method, on 1-D data).
 *
 * WHY NOT A PERCENTILE. The obvious threshold is "a multiple of p95", and it is
 * wrong for exactly the reason it looks right: in a screencast the real changes
 * ARE the top few percent of samples, so p95 lands on a change value and 1.5× it
 * excludes every change but the largest. Three slide switches measured as one.
 * That is the percentile version of the same mistake as an absolute threshold —
 * a statistic chosen without looking at the shape of the data.
 *
 * Otsu asks the right question instead: where is the natural break between the
 * quiet mass and the loud tail? It needs no assumption about how many changes
 * there are.
 *
 * @param {number[]} values
 * @param {number} bins
 * @returns {{ threshold, separation, lowMean, highMean, highCount }}
 */
export function otsuSplit(values, bins = 128) {
    const xs = values.filter(Number.isFinite);
    if (xs.length < 4) return { threshold: Infinity, separation: 0, lowMean: 0, highMean: 0, highCount: 0 };
    const max = Math.max(...xs);
    if (!(max > 0)) return { threshold: Infinity, separation: 0, lowMean: 0, highMean: 0, highCount: 0 };

    const hist = new Array(bins).fill(0);
    for (const v of xs) hist[Math.min(bins - 1, Math.floor(bins * v / max))] += 1;

    const total = xs.length;
    let sumAll = 0;
    for (let i = 0; i < bins; i++) sumAll += i * hist[i];
    let wB = 0, sumB = 0, best = -1, bestBin = 0;
    for (let i = 0; i < bins - 1; i++) {
        wB += hist[i];
        if (!wB) continue;
        const wF = total - wB;
        if (!wF) break;
        sumB += i * hist[i];
        const mB = sumB / wB, mF = (sumAll - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) { best = between; bestBin = i; }
    }
    const threshold = (bestBin + 1) * max / bins;
    const low = xs.filter(v => v <= threshold), high = xs.filter(v => v > threshold);
    const lowMean = low.length ? low.reduce((a, b) => a + b, 0) / low.length : 0;
    const highMean = high.length ? high.reduce((a, b) => a + b, 0) / high.length : 0;
    return {
        threshold,
        // How convincingly the two classes are actually separated. Otsu will
        // happily split pure noise, so this is the guard against inventing scenes
        // in a recording where the picture never changes.
        separation: lowMean > 0 ? highMean / lowMean : (highMean > 0 ? Infinity : 0),
        lowMean, highMean, highCount: high.length,
    };
}

/**
 * Detect scene changes.
 *
 * Thresholds are per-recording (a multiple of that metric's own p95), never
 * absolute — the same discipline the audio side had to learn the hard way.
 *
 * @param {Array} trace from sampler.sweep()
 * @param {{ metric?: string, threshold?: number, p95?: object, factor?: number, minSceneMs?: number }} opts
 *   `metric` 'blockMax' by default: it is the one that catches localised change,
 *   which is most of what happens in a screencast.
 * @returns {{ scenes: Array, threshold: number, metric: string }}
 */
export function findScenes(trace, opts = {}) {
    const metric = opts.metric && METRICS.includes(opts.metric) ? opts.metric : 'blockMax';
    const minSceneMs = opts.minSceneMs != null ? opts.minSceneMs : 1200;
    const minSeparation = opts.minSeparation != null ? opts.minSeparation : 3;
    // A floor stops a completely static recording from turning encoder noise into
    // a scene list, whatever the split says.
    const floor = opts.floor != null ? opts.floor : 0.004;

    const values = trace.filter(s => !s.first).map(s => s[metric]);
    const split = otsuSplit(values);
    let threshold, basis;
    if (opts.threshold != null) {
        threshold = opts.threshold; basis = 'explicit';
    } else if (opts.factor != null) {
        // Kept for callers that want the old percentile behaviour; see otsuSplit
        // for why it is not the default.
        threshold = Math.max(((opts.p95 && opts.p95[metric]) || 0) * opts.factor, floor);
        basis = `p95 × ${opts.factor}`;
    } else if (split.separation >= minSeparation && split.threshold >= floor) {
        threshold = split.threshold; basis = 'natural break (Otsu)';
    } else {
        // The two classes are not convincingly separated: this recording has no
        // scene changes to speak of. Say so rather than picking a number.
        threshold = Infinity;
        basis = `no separable change (classes differ by ${split.separation === Infinity ? '∞' : split.separation.toFixed(1)}×, need ${minSeparation}×)`;
    }

    const hits = [];
    for (const s of trace) {
        if (s.first) continue;
        if (s[metric] > threshold) hits.push(s);
    }

    // Each metric needs its OWN split to judge agreement — the metrics are on
    // different scales, so testing them all against the reference metric's
    // threshold would be meaningless.
    const perMetricThreshold = {};
    for (const m of METRICS) {
        if (m === metric) { perMetricThreshold[m] = threshold; continue; }
        const sp = otsuSplit(trace.filter(s => !s.first).map(s => s[m]));
        perMetricThreshold[m] = (sp.separation >= minSeparation && sp.threshold >= floor) ? sp.threshold : Infinity;
    }

    // Collapse a burst (a fade or an animation fires on consecutive samples) into
    // its LAST sample: that is where the screen has settled, which is the frame
    // worth keeping.
    const scenes = [];
    for (const h of hits) {
        const last = scenes[scenes.length - 1];
        if (last && h.at - last.at < minSceneMs) {
            last.at = h.at;
            last.value = Math.max(last.value, h[metric]);
            last.burst += 1;
            continue;
        }
        scenes.push({
            at: h.at, metric, value: h[metric], threshold, burst: 1,
            // Which other metrics agreed. Disagreement is informative: a scroll
            // moves edges without changing the palette, a theme switch does the
            // opposite.
            agreed: METRICS.filter(m => m !== metric && h[m] > perMetricThreshold[m]),
        });
    }

    // Scene durations, and the settle delay from the burst.
    for (let i = 0; i < scenes.length; i++) {
        const next = scenes[i + 1];
        scenes[i].durationMs = (next ? next.at : (trace.length ? trace[trace.length - 1].at : scenes[i].at)) - scenes[i].at;
        scenes[i].settledAfterMs = scenes[i].burst > 1 ? scenes[i].burst * 100 : 0;
    }
    return { scenes, threshold, metric, basis, split };
}

/**
 * How well each metric agrees with a reference metric's scene list — the
 * empirical answer to "which metric should we use?", which is the question
 * narrated-review's single hardcoded metric never asked.
 *
 * @returns {object} per metric: { scenes, sharedWithReference, onlyThis }
 */
export function compareMetrics(trace, opts = {}) {
    const reference = opts.reference || 'blockMax';
    const tolMs = opts.tolMs || 600;
    const lists = {};
    for (const m of METRICS) lists[m] = findScenes(trace, { ...opts, metric: m }).scenes.map(s => s.at);
    const ref = lists[reference];
    const out = {};
    for (const m of METRICS) {
        const shared = lists[m].filter(a => ref.some(b => Math.abs(a - b) <= tolMs)).length;
        out[m] = { scenes: lists[m].length, sharedWithReference: shared, onlyThis: lists[m].length - shared };
    }
    return { reference, perMetric: out };
}
