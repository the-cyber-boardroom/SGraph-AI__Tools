/**
 * plan — choose where to cut the audio and where to take the screenshots.
 *
 * THE INSIGHT THIS MODULE EXISTS FOR. narrated-review runs in exactly one
 * direction: audio pauses become boundaries, then a frame is found for each. When
 * a recording has no usable pauses, that chain has no first link and everything
 * downstream is arbitrary — which is precisely what happened to a real 4m21s
 * screencast: nine segments of exactly 30000 ms, sentences cut mid-clause.
 *
 * But such a recording usually still has perfectly clear VISUAL boundaries. So
 * the direction should be chosen per recording, not fixed:
 *
 *   usable topic gaps      → audio-led: cut at pauses, then find each frame
 *   none, but scenes exist → video-led: cut at scene changes, take the words between
 *   both, disagreeing      → hybrid: scenes primary, snapped to nearby pauses
 *   neither                → NONE. Say so. Do not invent boundaries.
 *
 * Every cut carries the evidence that produced it, and `none` is a legitimate
 * answer — a plausible fabrication is worse than an honest refusal.
 *
 * @module sg-media-analysis/plan
 * @version 0.1.0
 */

/**
 * Measured per-capture model cost, from the real narrated-review session
 * `nr-video-n16w` (9 captures, 4m21s, google/gemini-3.5-flash, 17 Aug 2026):
 * $0.1173 transcription and $0.3089 cleanup in total. Cleanup is 72% of spend
 * because it sends a SCREENSHOT per capture and images dominate the token count.
 *
 * The consequence is the whole cost argument: spend scales with the NUMBER of
 * captures, almost independently of how long each one is. One capture per visual
 * state instead of one per clock tick is cheaper and better at the same time.
 */
export const COST_BASIS = Object.freeze({
    session: 'nr-video-n16w (9 captures, 4m21s, google/gemini-3.5-flash, 17 Aug 2026)',
    transcribeUsdPerCapture: 0.0130,
    cleanUsdPerCapture: 0.0343,
});

/** @returns {{ captures, transcribeUsd, cleanUsd, totalUsd, basis }} */
export function estimateCost(captures) {
    const t = captures * COST_BASIS.transcribeUsdPerCapture;
    const c = captures * COST_BASIS.cleanUsdPerCapture;
    return { captures, transcribeUsd: t, cleanUsd: c, totalUsd: t + c, basis: COST_BASIS.session };
}

/** Defaults for strategy selection — all per-recording, none absolute. */
export const PLAN_DEFAULTS = Object.freeze({
    topicGapsPerFiveMin: 3,     // fewer than this and audio-led has nothing to cut on
    minMedianSceneMs: 4000,     // shorter and "scenes" are probably animation, not topics
    snapWindowMs: 2000,         // hybrid: how far a scene may reach for a pause
    maxCaptureMs: 90000,        // a very long capture is still worth splitting
});

/**
 * Pick a strategy and produce the cuts and shots.
 *
 * @param {object} m the measured inputs
 * @param {{ rms, frameMs, gaps, populations, calibration, durationMs }} m.audio
 * @param {{ scenes, trace }} m.video
 * @param {object} m.align  from align.leadLag()
 * @param {{ strategy?: string }} [opts] force a strategy instead of selecting
 * @returns {object} the plan
 */
export function plan(m, opts = {}) {
    const cfg = { ...PLAN_DEFAULTS, ...opts };
    const warnings = [];
    const audio = m.audio || {};
    const scenes = (m.video && m.video.scenes) || [];
    const durationMs = audio.durationMs || 0;
    const minutes = Math.max(1 / 60, durationMs / 60000);

    const topicGaps = (audio.gaps || []).filter(g => g.durationMs >= 1000);
    const topicRate = topicGaps.length / (minutes / 5);
    const sceneLens = scenes.map(s => s.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
    const medianScene = sceneLens.length ? sceneLens[Math.floor(sceneLens.length / 2)] : 0;

    const audioViable = topicRate >= cfg.topicGapsPerFiveMin && audio.levels && audio.levels.bimodal;
    const videoViable = scenes.length >= 2 && medianScene >= cfg.minMedianSceneMs;

    let strategy = opts.strategy;
    let reason;
    if (!strategy) {
        if (audioViable && videoViable && m.align && !m.align.correlated) {
            strategy = 'hybrid';
            reason = `both signals present but only ${Math.round((m.align.pairedRatio || 0) * 100)}% of scene changes have a nearby speech onset — scenes lead, snapped to pauses`;
        } else if (audioViable) {
            strategy = 'audio-led';
            reason = `${topicGaps.length} topic gaps (>1000 ms) in ${(durationMs / 1000).toFixed(0)} s, energy histogram is bimodal`;
        } else if (videoViable) {
            strategy = 'video-led';
            reason = `only ${topicGaps.length} topic gaps in ${(durationMs / 1000).toFixed(0)} s — not enough to cut on — but ${scenes.length} scene changes with a median of ${(medianScene / 1000).toFixed(0)} s`;
        } else {
            strategy = 'none';
            reason = `no usable signal: ${topicGaps.length} topic gaps and ${scenes.length} scene changes`
                + (audio.levels && !audio.levels.bimodal ? '; the energy histogram is not bimodal, so no silence threshold can separate speech from the floor' : '');
        }
    } else {
        reason = `forced by caller: ${strategy}`;
    }

    if (strategy === 'none') {
        // Deliberately no cuts. The caller decides what to do about it; guessing
        // here is how nine meaningless 30-second captures got shipped.
        return { strategy, reason, cuts: [], shots: [], estimate: estimateCost(0),
            warnings: [{ code: 'no-usable-signal', message: reason }], basis: COST_BASIS.session };
    }

    // ── Boundaries ────────────────────────────────────────────────────────────
    let cuts = [];
    if (strategy === 'audio-led') {
        cuts = topicGaps.map(g => ({
            tMs: Math.round(g.tMs + g.durationMs / 2),
            source: 'silence',
            evidence: { gapMs: g.durationMs, gapStartMs: g.tMs, threshold: audio.calibration && audio.calibration.silenceThreshold },
        }));
    } else {
        for (const s of scenes) {
            const cut = { tMs: s.at, source: 'scene', evidence: { metric: s.metric, value: round(s.value), threshold: round(s.threshold), agreed: s.agreed } };
            if (strategy === 'hybrid') {
                // Prefer a real pause near the visual change: cutting mid-word is
                // what makes a transcript unreadable even when the picture is right.
                const near = (audio.gaps || [])
                    .filter(g => Math.abs(g.tMs + g.durationMs / 2 - s.at) <= cfg.snapWindowMs && g.durationMs >= 300)
                    .sort((a, b) => Math.abs(a.tMs - s.at) - Math.abs(b.tMs - s.at))[0];
                if (near) {
                    cut.tMs = Math.round(near.tMs + near.durationMs / 2);
                    cut.source = 'scene+silence';
                    cut.evidence.snappedToGapMs = near.durationMs;
                    cut.evidence.snappedByMs = cut.tMs - s.at;
                }
            }
            cuts.push(cut);
        }
    }

    cuts.sort((a, b) => a.tMs - b.tMs);
    if (!cuts.length || cuts[0].tMs > 0) cuts.unshift({ tMs: 0, source: 'start', evidence: { note: 'the recording begins' } });

    // Split anything absurdly long — but SAY so, rather than doing it silently.
    const split = [];
    for (let i = 0; i < cuts.length; i++) {
        split.push(cuts[i]);
        const end = i + 1 < cuts.length ? cuts[i + 1].tMs : durationMs;
        let span = end - cuts[i].tMs;
        let at = cuts[i].tMs;
        while (span > cfg.maxCaptureMs) {
            at += cfg.maxCaptureMs;
            split.push({ tMs: at, source: 'length-limit', evidence: { note: `no boundary found within ${cfg.maxCaptureMs / 1000} s — this cut is ARBITRARY` } });
            warnings.push({ code: 'arbitrary-cut', message: `a cut at ${(at / 1000).toFixed(0)} s was forced by the length limit, not by a pause or a scene change` });
            span -= cfg.maxCaptureMs;
        }
    }
    cuts = split;

    // ── Shots: the frame each segment is about ────────────────────────────────
    const lead = (m.align && m.align.suggestedLeadMs) || 2500;
    const lag = (m.align && m.align.suggestedLagMs) || 1200;
    const shots = cuts.map((c, i) => {
        // A scene change inside the measured lead/lag window is the frame the
        // words are about; failing that, the cut itself.
        const near = scenes
            .filter(s => s.at >= c.tMs - lead && s.at <= c.tMs + lag)
            .sort((a, b) => b.value - a.value)[0];
        return {
            tMs: near ? near.at : c.tMs,
            forCutIndex: i,
            evidence: near
                ? { source: 'scene', metric: near.metric, value: round(near.value), offsetFromCutMs: near.at - c.tMs, windowMs: [-lead, lag] }
                : { source: 'cut', note: 'no scene change in the measured lead/lag window — using the cut itself' },
        };
    });

    return {
        strategy, reason, cuts, shots,
        estimate: estimateCost(cuts.length),
        window: { leadMs: lead, lagMs: lag, measured: !!(m.align && m.align.suggestedLeadMs) },
        warnings, basis: COST_BASIS.session,
    };
}

function round(v) { return typeof v === 'number' ? Math.round(v * 100000) / 100000 : v; }

/**
 * What narrated-review does TODAY on this recording, for the compare view — from
 * a real `createVad` replay, not a model of one.
 * @param {{ segments: Array, capped: number }} replayed
 */
export function todayFromReplay(replayed) {
    const segs = replayed.segments || [];
    const lens = segs.map(s => s.tEnd - s.tStart);
    return {
        captures: segs.length,
        capped: replayed.capped || 0,
        cappedRatio: segs.length ? (replayed.capped || 0) / segs.length : 0,
        meanSegmentMs: lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0,
        estimate: estimateCost(segs.length),
    };
}
