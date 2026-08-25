/**
 * mp-findings.js
 * The verdict, in words.
 *
 * The plots are for a person with the tool open. This is for the person in a
 * hurry and for the agent that was handed a recording and needs to answer "will
 * this segment cleanly?" without rendering anything. Same facts, different
 * surface — and it must state what was NOT measured, because a confident summary
 * that quietly omits an unrun lane is the failure mode this tool exists to end.
 *
 * @module mp-findings
 */

import { state, notMeasured } from './mp-state.js';

const usd = v => `$${Number(v || 0).toFixed(2)}`;
const secs = ms => `${(ms / 1000).toFixed(0)} s`;

/** @returns {{ markdown: string }} */
export function findings() {
    const L = [];
    const s = state.source;
    if (!s) return { markdown: '_No recording loaded._' };

    L.push(`## Media probe — ${s.name}${s.durationMs ? ` (${fmt(s.durationMs)})` : ''}`);
    L.push('');

    const a = state.audio;
    const g = state.gaps;
    if (!a) {
        L.push('**The audio lane has not run**, so nothing can be said about segmentation yet.');
    } else {
        const topic = g.populations.topic.count;
        const viable = a.levels.bimodal && topic > 0;
        L.push(viable
            ? `**Audio-led segmentation looks viable on this recording.**`
            : `**Audio-led segmentation will NOT work on this recording as configured.**`);
        L.push('');
        L.push(`- Noise floor sits at RMS ${f(a.levels.floor)} (${a.dbfsLevels.floor.toFixed(1)} dBFS); speech at ${f(a.levels.speech)} (${a.dbfsLevels.speech.toFixed(1)} dBFS).`);
        if (a.levels.floor >= 0.01) {
            // The exact shape of the original failure, called out by name.
            L.push(`- **The old fixed threshold of 0.01 is at or below that floor**, so no frame would count as silence and every segment would force-cut at the length limit. This is the condition that produced nine captures of exactly 30 s on a real screencast.`);
        }
        if (!a.levels.bimodal) {
            L.push(`- The energy histogram is **not bimodal** — there is no separable quiet and loud mode, so no silence threshold can split speech from the floor here.`);
        }
        if (a.flatnessLevels.floorMedian != null && a.flatnessLevels.speechMedian != null) {
            const narrow = a.flatnessLevels.floorMedian < a.flatnessLevels.speechMedian / 2;
            L.push(`- Spectral flatness: floor ${f(a.flatnessLevels.floorMedian)} vs speech ${f(a.flatnessLevels.speechMedian)}${narrow ? ' — the floor is narrow-band, i.e. room tone or mains hum rather than genuine silence' : ''}.`);
        }
        L.push(`- At the calibrated threshold (${f(a.calibration.silenceThreshold)}, ${a.calibration.method}) there are ${g.all.length} gaps: ${g.populations.word.count} word-length, ${g.populations.sentence.count} sentence-length, **${topic} topic-length (>1000 ms)**.`);
        if (state.today) {
            L.push(`- Replaying the real VAD at that threshold: **${state.today.captures} captures, ${state.today.capped} force-cut** at the length limit (mean ${secs(state.today.meanSegmentMs)}).`);
        }
    }

    L.push('');
    if (!state.frames) {
        L.push('**The frame lane has not run**, so no scene changes are known — that is not the same as there being none.');
    } else {
        const sc = state.scenes;
        L.push(`- Frame sweep: ${state.frames.trace.length} samples over ${state.frames.passes} pass(es). **${sc.scenes.length} scene changes** on \`${sc.metric}\` above ${f(sc.threshold)}.`);
        const pm = sc.perMetric || {};
        const others = Object.keys(pm).filter(k => k !== sc.metric);
        if (others.length) {
            L.push(`- Metric agreement vs \`${sc.metric}\`: ` + others.map(k => `\`${k}\` ${pm[k].scenes} (${pm[k].onlyThis} unique)`).join(', ') + '.');
            const missed = others.filter(k => pm[k].scenes < pm[sc.metric].scenes);
            if (missed.length) L.push(`  ${missed.map(k => `\`${k}\``).join(', ')} ${missed.length === 1 ? 'finds' : 'find'} fewer — consistent with change that is localised rather than global.`);
        }
    }

    if (state.align) {
        const al = state.align;
        L.push(`- The picture leads the words by a median of ${al.median} ms (p10 ${al.p10}, p90 ${al.p90}) across ${al.count} pairings.`);
        L.push(`  Measured window: lead ${al.suggestedLeadMs} ms / lag ${al.suggestedLagMs} ms — narrated-review currently assumes 2500 / 1200.`);
        if (!al.correlated) L.push(`  **Only ${Math.round(al.pairedRatio * 100)}% of scene changes have a nearby speech onset** — the two signals do not really track each other here.`);
    }

    if (state.plan) {
        const p = state.plan;
        L.push('');
        if (p.strategy === 'none') {
            L.push(`**Recommendation: none.** ${p.reason}`);
            L.push('');
            L.push('No boundaries are proposed. An honest refusal beats a plausible set of arbitrary cuts — which is exactly what shipped the first time.');
        } else {
            L.push(`**Recommendation: ${p.strategy}.** ${p.reason}`);
            L.push('');
            L.push(`${p.cuts.length} captures proposed, estimated ${usd(p.estimate.totalUsd)}` +
                (state.today ? ` versus ${state.today.captures} and ${usd(state.today.estimate.totalUsd)} today` : '') + '.');
            if (state.today && p.cuts.length < state.today.captures) {
                L.push(`That is ${usd(state.today.estimate.totalUsd - p.estimate.totalUsd)} less, because spend scales with the NUMBER of captures — cleanup sends a screenshot each time.`);
            }
            const arb = p.warnings.filter(w => w.code === 'arbitrary-cut').length;
            L.push(arb ? `${arb} of those cuts are still arbitrary (no pause or scene change within the limit).`
                : 'Every proposed cut is backed by a pause or a scene change.');
        }
        L.push('');
        L.push(`_Cost basis: ${p.basis}._`);
    }

    const nm = notMeasured();
    if (nm.length) {
        L.push('');
        L.push('### Not measured');
        L.push('');
        for (const x of nm) L.push(`- \`${x.code}\` — ${x.message}`);
    }
    L.push('');
    return { markdown: L.join('\n') };
}

function f(v) { return v == null ? '—' : Number(v).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''); }
function fmt(ms) {
    const t = Math.round(ms / 1000);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
