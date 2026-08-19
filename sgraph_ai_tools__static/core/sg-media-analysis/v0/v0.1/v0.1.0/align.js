/**
 * align — measure how far the picture leads the words, instead of assuming it.
 *
 * narrated-review searches a window from 2500 ms BEFORE speech to 1200 ms after,
 * on the reasoning that a presenter switches screen, waits a beat, then talks.
 * The reasoning is sound; those two magnitudes are invented. This module
 * measures the real distribution for a given speaker and recording.
 *
 * It also answers a question nobody has asked: are the two signals correlated at
 * all? If scene changes and speech onsets are independent, this recording's
 * pictures and words do not line up, and ANY pairing is arbitrary. Saying so is
 * more useful than a confident document.
 *
 * @module sg-media-analysis/align
 * @version 0.1.0
 */

/**
 * Speech onsets from framewise energy: a rising edge into a sustained run of
 * speech, ignoring blips.
 * @returns {number[]} onset times (ms)
 */
export function speechOnsets(rms, frameMs, speechThreshold, minRunMs = 300) {
    const need = Math.max(1, Math.round(minRunMs / frameMs));
    const onsets = [];
    let run = 0, start = -1;
    for (let i = 0; i < rms.length; i++) {
        if (rms[i] >= speechThreshold) {
            if (run === 0) start = i;
            run += 1;
        } else {
            if (run >= need && start >= 0) onsets.push(start * frameMs);
            run = 0; start = -1;
        }
    }
    if (run >= need && start >= 0) onsets.push(start * frameMs);
    return onsets;
}

function quantile(sorted, q) {
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

/**
 * For each scene change, the offset to the nearest speech onset.
 *
 * POSITIVE means the words came AFTER the picture — the picture led. Negative
 * means the speaker started talking about something before switching to it,
 * which is the case that defeats a naive "grab the frame where the words start".
 *
 * @param {Array<{at:number}>} scenes
 * @param {number[]} onsets
 * @param {{ maxMs?: number }} opts  ignore pairings further apart than this;
 *   beyond it the two events are unrelated and would only add noise.
 */
export function leadLag(scenes, onsets, opts = {}) {
    const maxMs = opts.maxMs || 6000;
    const deltas = [];
    for (const s of scenes) {
        let best = null;
        for (const o of onsets) {
            const d = o - s.at;
            if (Math.abs(d) > maxMs) continue;
            if (best === null || Math.abs(d) < Math.abs(best)) best = d;
        }
        if (best !== null) deltas.push({ sceneAt: s.at, deltaMs: best });
    }
    const sorted = deltas.map(d => d.deltaMs).sort((a, b) => a - b);

    // How many scene changes found ANY nearby onset. This is the correlation
    // measure that matters: a low ratio means the signals are independent.
    const paired = scenes.length ? deltas.length / scenes.length : 0;

    const p10 = quantile(sorted, 0.10);
    const p90 = quantile(sorted, 0.90);
    return {
        deltas, count: deltas.length, pairedRatio: paired,
        median: quantile(sorted, 0.50), p10, p90,
        // A window that would actually contain 80% of this recording's pairings,
        // with a margin — the measured replacement for 2500/1200.
        suggestedLeadMs: p10 == null ? null : Math.max(500, Math.round(-Math.min(0, p10) + 800)),
        suggestedLagMs: p90 == null ? null : Math.max(500, Math.round(Math.max(0, p90) + 400)),
        // Below this the pictures and words simply do not track each other.
        correlated: paired >= 0.5,
    };
}
