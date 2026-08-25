/**
 * yp-tests-auto.js
 * Tests that need no token, no gesture and no network. Run these first.
 *
 * A3/A4 are the pair the pack's Decision 3 stands or falls on: the SAME recorded
 * talk, analysed once over the whole frame and once over the slide region only.
 * If both find the slides, masking is unnecessary and Decision 3 evaporates —
 * which is a perfectly good outcome and one this suite is designed to be able to
 * report.
 *
 * @module yp-tests-auto
 */

import { recordTalk, TRUE_SLIDE_REGION } from './yp-synth.js';
import { maskedSignature, traceFromSignatures, suggestMask, gridSample, FULL_FRAME } from './yp-mask.js';
import { openSource } from '/core/sg-media-analysis/v0/v0.1/v0.1.0/sampler.js';
import { findScenes } from '/core/sg-media-analysis/v0/v0.1/v0.1.0/scenes.js';
import { estimateCost } from '/core/sg-media-analysis/v0/v0.1/v0.1.0/plan.js';
import { parseCaptions, groupCuesByBoundaries, cleanCueText } from './yp-captions.js';

/** Recorded clips are expensive; cache one per layout for the session. */
const clips = new Map();
async function clipFor(layout, ctx) {
    if (clips.has(layout)) return clips.get(layout);
    ctx.emit?.('yp:test:progress', { message: `recording a synthetic ${layout} talk (~18 s)…` });
    const clip = await recordTalk({ layout, slideCount: 4, slideMs: 4000 });
    clips.set(layout, clip);
    return clip;
}
export function clearClips() { clips.clear(); }

/**
 * Sample a clip once, producing BOTH the whole-frame and the masked trace.
 * One seek per sample serves both, so the comparison costs no more than a single
 * analysis and the two traces are sampled at identical instants — which they must
 * be, or the comparison measures the sampler rather than the mask.
 */
async function dualTrace(clip, mask, stepMs = 250) {
    const src = await openSource(clip.blob);
    const dims = { width: clip.w, height: clip.h };
    const full = [], masked = [], grid = [];
    try {
        for (let at = 0; at < (src.durationMs || clip.durationMs); at += stepMs) {
            await seekTo(src, at);
            full.push({ at, sig: maskedSignature(src.el, FULL_FRAME, dims) });
            if (mask) masked.push({ at, sig: maskedSignature(src.el, mask, dims) });
            grid.push({ at, full: gridSample(src.el, dims) });
        }
    } finally { src.release(); }
    return { full: traceFromSignatures(full), masked: mask ? traceFromSignatures(masked) : null, grid };
}

function seekTo(src, ms) {
    const el = src.el;
    const sec = Math.max(0, Math.min((src.durationMs || 0) / 1000 - 0.05, ms / 1000));
    if (Math.abs(el.currentTime - sec) < 0.005 && el.readyState >= 2) return Promise.resolve();
    return new Promise(res => {
        const done = () => { el.removeEventListener('seeked', done); clearTimeout(t); res(); };
        const t = setTimeout(done, 3000);
        el.addEventListener('seeked', done, { once: true });
        el.currentTime = sec;
    });
}

/**
 * How much HEADROOM was there between the slide changes and everything else?
 *
 * A detector can pass for two very different reasons: because it is good, or
 * because the fixture was easy. If the slide-change samples measure 100x the
 * background motion, any threshold works and the test says nothing about real
 * footage where a speaker is large, fast and high-contrast. So report the ratio
 * and let the reader judge — a pass with headroom 3 is evidence, a pass with
 * headroom 200 is a fixture that needs hardening.
 */
function headroom(trace, truthMs, metric = 'blockMax', tolMs = 1500) {
    const atChange = [], elsewhere = [];
    for (const t of trace) {
        if (t.first) continue;
        (truthMs.some(x => Math.abs(t.at - x) <= tolMs) ? atChange : elsewhere).push(t[metric]);
    }
    if (!atChange.length || !elsewhere.length) return null;
    const sorted = elsewhere.slice().sort((a, b) => a - b);
    const bg = sorted[Math.floor(sorted.length * 0.95)] || 1e-6;
    const peak = Math.max(...atChange);
    return {
        peakAtChange: round5(peak), backgroundP95: round5(bg),
        ratio: round5(peak / Math.max(bg, 1e-6)),
        backgroundMax: round5(Math.max(...elsewhere)),
    };
}
function round5(v) { return Math.round(v * 100000) / 100000; }

/** Score a detected scene list against the known slide changes. */
function score(scenes, truthMs, tolMs = 1500) {
    const detected = scenes.map(s => s.at);
    const matched = [];
    const remaining = [...detected];
    for (const t of truthMs) {
        const i = remaining.findIndex(d => Math.abs(d - t) <= tolMs);
        if (i >= 0) { matched.push({ truth: t, at: remaining[i] }); remaining.splice(i, 1); }
    }
    return {
        truth: truthMs.length, detected: detected.length,
        matched: matched.length, missed: truthMs.length - matched.length, spurious: remaining.length,
        detectedAt: detected, truthAt: truthMs,
    };
}

export const AUTO_TESTS = [
    {
        id: 'A1', group: 'Captions (offline)', needs: null,
        title: 'Caption parsers read VTT, SRT and SBV',
        hypothesis: 'YouTube\'s three download formats can be parsed to identical cues, with cue settings and karaoke word-timing tags stripped.',
        meaning: {
            pass: 'The parser is ready to promote into core/youtube-api once M4 says there is a source to feed it.',
            fail: 'Fix before anything downstream — every later stage inherits the cues verbatim.',
        },
        async run() {
            const vtt = 'WEBVTT\n\nNOTE ignore me\n\n00:00:01.000 --> 00:00:04.000 align:start position:0%\n<v Dinis>Risk <00:00:02.100>chains</v>\n\n2\n00:00:05.500 --> 00:00:07.250\n<c.colorE5E5E5>second cue</c>\n';
            const srt = '1\n00:00:01,000 --> 00:00:04,000\nRisk chains\n\n2\n00:00:05,500 --> 00:00:07,250\nsecond cue\n';
            const sbv = '0:00:01.000,0:00:04.000\nRisk chains\n\n0:00:05.500,0:00:07.250\nsecond cue\n';
            const v = parseCaptions(vtt), s = parseCaptions(srt), b = parseCaptions(sbv);
            const shape = x => JSON.stringify(x.cues.map(c => [c.tMs, c.endMs, c.text]));
            const wanted = JSON.stringify([[1000, 4000, 'Risk chains'], [5500, 7250, 'second cue']]);
            const junk = parseCaptions('this is not a caption file at all');
            const ok = shape(v) === wanted && shape(s) === wanted && shape(b) === wanted
                && v.format === 'vtt' && s.format === 'srt' && b.format === 'sbv'
                && junk.cues.length === 0 && v.dropped === 0;
            return {
                status: ok ? 'pass' : 'fail',
                detail: ok
                    ? 'All three formats parse to identical cues; markup stripped; junk yields nothing rather than garbage.'
                    : `Mismatch. vtt=${shape(v)} srt=${shape(s)} sbv=${shape(b)}`,
                evidence: {
                    vtt: v.cues, dropped: { vtt: v.dropped, srt: s.dropped, sbv: b.dropped },
                    formatsSniffed: [v.format, s.format, b.format],
                    tagStripping: cleanCueText('<v Name>a <00:00:01.000>b</v>'),
                },
            };
        },
    },
    {
        id: 'A2', group: 'Captions (offline)', needs: null,
        title: 'Cues group into slide-sized spans by midpoint',
        hypothesis: 'Cues are words-with-timings, not captures. Grouping them against slide boundaries by cue MIDPOINT keeps a straddling cue on the side it mostly belongs to, and loses none.',
        meaning: {
            pass: 'Pack Decision 6 is implementable as written: ~800 cues become ~40 captures, not 800.',
            fail: 'Grouping is wrong — captures would inherit the wrong words, which no amount of cleanup fixes.',
        },
        async run() {
            const cues = [
                { tMs: 0, endMs: 2000, text: 'opening words' },
                { tMs: 2500, endMs: 4000, text: 'still slide one' },
                { tMs: 4800, endMs: 6200, text: 'straddles the change' },   // midpoint 5500 → after 5000
                { tMs: 7000, endMs: 9000, text: 'slide two' },
            ];
            const spans = groupCuesByBoundaries(cues, [5000], 10000);
            const totalCues = spans.reduce((n, s) => n + s.cueCount, 0);
            const ok = spans.length === 2 && totalCues === cues.length
                && spans[0].cueCount === 2 && spans[1].cueCount === 2
                && spans[1].text.startsWith('straddles');
            return {
                status: ok ? 'pass' : 'fail',
                detail: ok
                    ? 'Two spans, every cue kept, and the straddling cue landed on the side its midpoint falls in.'
                    : `Unexpected grouping: ${JSON.stringify(spans)}`,
                evidence: { spans, totalCuesIn: cues.length, totalCuesOut: totalCues },
            };
        },
    },
    {
        id: 'A3', group: 'Talk footage (the mask hypothesis)', needs: null,
        title: 'Whole-frame analysis on a talk — the control',
        hypothesis: 'On talk footage (a constantly-moving speaker beside slides), whole-frame scene detection — what narrated-review ships today — will NOT cleanly find the slide changes.',
        meaning: {
            fail: 'Predicted. The speaker\'s motion drowns the slide advances. Decision 3 (region mask) is justified — see A4 for whether masking fixes it.',
            pass: 'DECISION 3 IS FALSIFIED, and that is a good outcome: the shipped code already handles talk footage and the mask can be dropped from the plan.',
        },
        async run(ctx) {
            const clip = await clipFor('side', ctx);
            const { full } = await dualTrace(clip, null);
            const scenes = findScenes(full, { metric: 'blockMax' });
            const sc = score(scenes.scenes, clip.slideChangesMs);
            const clean = sc.missed === 0 && sc.spurious === 0;
            return {
                // "pass" here means the CONTROL succeeded, i.e. no mask is needed.
                status: clean ? 'pass' : 'fail',
                detail: clean
                    ? `Whole-frame analysis found all ${sc.truth} slide changes with no false positives — a mask may be unnecessary.`
                    : `Found ${sc.detected} scenes for ${sc.truth} real slide changes (${sc.matched} matched, ${sc.missed} missed, ${sc.spurious} spurious). ${scenes.basis}.`,
                evidence: {
                    ...sc, basis: scenes.basis, threshold: scenes.threshold, split: scenes.split,
                    samples: full.length,
                    // Read this before believing the verdict — see headroom().
                    headroom: headroom(full, clip.slideChangesMs),
                },
            };
        },
    },
    {
        id: 'A4', group: 'Talk footage (the mask hypothesis)', needs: null,
        title: 'Masked to the slide region — the treatment',
        hypothesis: 'Cropping the signature to the slide region before measuring makes the same clip segment cleanly, with no change to any downstream code.',
        meaning: {
            pass: 'Decision 3 confirmed and cheap: masking is a source-rectangle on one drawImage, and everything downstream is untouched. Compare the numbers with A3.',
            fail: 'Masking is NOT sufficient. Before building it, find out why — the metric, the threshold, or the sampling rate.',
        },
        async run(ctx) {
            const clip = await clipFor('side', ctx);
            const { full, masked } = await dualTrace(clip, TRUE_SLIDE_REGION.side);
            const fullScenes = findScenes(full, { metric: 'blockMax' });
            const maskScenes = findScenes(masked, { metric: 'blockMax' });
            const a = score(fullScenes.scenes, clip.slideChangesMs);
            const b = score(maskScenes.scenes, clip.slideChangesMs);
            const better = (b.missed + b.spurious) < (a.missed + a.spurious);
            const perfect = b.missed === 0 && b.spurious === 0;
            return {
                status: perfect ? 'pass' : better ? 'info' : 'fail',
                detail: perfect
                    ? `Masked: all ${b.truth} slide changes, no false positives. Unmasked on the same clip: ${a.matched} matched, ${a.missed} missed, ${a.spurious} spurious.`
                      + ` Headroom over background — masked ${headroom(masked, clip.slideChangesMs)?.ratio}x vs unmasked ${headroom(full, clip.slideChangesMs)?.ratio}x.`
                    : better
                        ? `Masking improved matters but is not clean: ${b.matched}/${b.truth} matched, ${b.spurious} spurious (unmasked: ${a.matched}/${a.truth}, ${a.spurious} spurious).`
                        : `Masking did NOT help: masked ${b.matched}/${b.truth} with ${b.spurious} spurious vs unmasked ${a.matched}/${a.truth} with ${a.spurious}.`,
                evidence: {
                    masked: b, unmasked: a, maskUsed: TRUE_SLIDE_REGION.side,
                    maskedBasis: maskScenes.basis, unmaskedBasis: fullScenes.basis,
                    // The number that says WHY, not just whether. Masking should
                    // widen the gap between a slide change and the background
                    // even when both detectors happen to score the same.
                    headroomMasked: headroom(masked, clip.slideChangesMs),
                    headroomUnmasked: headroom(full, clip.slideChangesMs),
                },
            };
        },
    },
    {
        id: 'A5', group: 'Talk footage (the mask hypothesis)', needs: null,
        title: 'The slide region can be found automatically',
        hypothesis: 'The slide region changes rarely but completely; the speaker changes constantly and slightly. Ranking cells by SPARSITY — how rarely a cell changes at all, weighted by how big the change is when it comes — should recover the slide rectangle without being told. (Peakiness, max ÷ mean, was tried first and picked the speaker: periodic motion has near-zero deltas at its turning points, which drags the mean down and inflates the ratio.)',
        meaning: {
            pass: 'The operator gets a proposed rectangle instead of drawing one — the mask stops being a chore.',
            fail: 'Ship the mask as a manual rectangle over the filmstrip. Auto-suggestion is a nicety, not a blocker.',
        },
        async run(ctx) {
            const clip = await clipFor('side', ctx);
            const { grid } = await dualTrace(clip, null, 250);
            const s = suggestMask(grid);
            const truth = TRUE_SLIDE_REGION.side;
            // Intersection-over-union against the region we actually drew.
            const ix = Math.max(0, Math.min(s.mask.x + s.mask.w, truth.x + truth.w) - Math.max(s.mask.x, truth.x));
            const iy = Math.max(0, Math.min(s.mask.y + s.mask.h, truth.y + truth.h) - Math.max(s.mask.y, truth.y));
            const inter = ix * iy;
            const iou = inter / (s.mask.w * s.mask.h + truth.w * truth.h - inter);
            return {
                status: iou >= 0.5 ? 'pass' : 'fail',
                detail: `Suggested {x:${s.mask.x.toFixed(2)} y:${s.mask.y.toFixed(2)} w:${s.mask.w.toFixed(2)} h:${s.mask.h.toFixed(2)}} vs true region — IoU ${iou.toFixed(2)}, confidence ${s.confidence.toFixed(2)}. ${s.basis}.`,
                evidence: { suggested: s.mask, truth, iou, confidence: s.confidence, basis: s.basis, cells: s.cells.length },
            };
        },
    },
    {
        id: 'A6', group: 'Talk footage (the mask hypothesis)', needs: null,
        title: 'Intercut footage is refused, not guessed at',
        hypothesis: 'When the camera cuts between speaker and slides, no fixed rectangle can work — and the tool should say so rather than emit a scene list built on camera cuts.',
        meaning: {
            pass: 'The honest-refusal discipline carries over to this pack. A caption-only fallback is the right behaviour here.',
            fail: 'The tool would produce a confident, wrong document from intercut footage — the exact failure mode of the 30-second-slices bug, in a new place.',
        },
        async run(ctx) {
            const clip = await clipFor('cut', ctx);
            const { grid, full } = await dualTrace(clip, null, 250);
            const s = suggestMask(grid);
            const scenes = findScenes(full, { metric: 'blockMax' });
            // Two independent signals that a fixed rectangle is hopeless: the
            // suggester has no confidence, and the detected "scenes" outnumber the
            // real slide changes because every camera cut fires.
            const lowConfidence = s.confidence < 0.35;
            const overDetects = scenes.scenes.length > clip.slideChangesMs.length;
            const detectable = lowConfidence || overDetects;
            return {
                status: detectable ? 'pass' : 'fail',
                detail: detectable
                    ? `Detectable as intercut: suggester confidence ${s.confidence.toFixed(2)}${overDetects ? `, and ${scenes.scenes.length} "scenes" for ${clip.slideChangesMs.length} real slide changes` : ''}.`
                    : `NOT detectable by either signal — confidence ${s.confidence.toFixed(2)}, ${scenes.scenes.length} scenes vs ${clip.slideChangesMs.length} changes. A refusal rule would need a different test.`,
                evidence: { confidence: s.confidence, basis: s.basis, scenes: scenes.scenes.length,
                    realSlideChanges: clip.slideChangesMs.length, lowConfidence, overDetects },
            };
        },
    },
    {
        id: 'A7', group: 'Cost', needs: null,
        title: 'What a corpus of talks would cost',
        hypothesis: 'Captions remove the transcription lane (27% of spend); cleanup (73%) stays because it is what corrects auto-caption errors against the slide.',
        meaning: {
            default: 'Numbers come from the measured nr-video-n16w session. Sanity-check them against your own corpus size before committing to a run.',
        },
        async run(ctx) {
            const talks = ctx.talks || 15;
            const perTalk = ctx.capturesPerTalk || 40;
            const both = estimateCost(talks * perTalk);
            const cleanOnly = { ...both, transcribeUsd: 0, totalUsd: both.cleanUsd };
            return {
                status: 'info',
                detail: `${talks} talks × ${perTalk} captures — transcribe+clean $${both.totalUsd.toFixed(2)}, captions+clean $${cleanOnly.totalUsd.toFixed(2)} (saving $${(both.totalUsd - cleanOnly.totalUsd).toFixed(2)}).`,
                evidence: { talks, capturesPerTalk: perTalk, transcribeAndClean: both, captionsAndClean: cleanOnly, basis: both.basis },
            };
        },
    },
];
