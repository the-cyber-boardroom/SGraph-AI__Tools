/**
 * ui-histograms.js
 * The two pictures that make a threshold decision obvious, plus the table that
 * makes the original failure a one-glance diagnosis.
 *
 *   energy histogram   where the noise floor and the speaking level actually are
 *   gap histogram      whether topic-length pauses exist at all
 *   threshold table    per candidate: gaps, topic gaps, segments, FORCE-CUTS
 *
 * The table row `0.01 → topicGaps 0, capped 8` is the whole story of the defect
 * that prompted this tool, in one line.
 *
 * @module ui-histograms
 */

import { POPULATIONS } from '/core/sg-media-analysis/v0/v0.1/v0.1.0/distributions.js';

export function initHistograms(el, state, config, api) {
    if (!el) return;
    el.innerHTML = `<div class="mp-hist">
        <h4>Energy distribution <span class="mp-muted">— dBFS bins</span></h4>
        <div id="mp-hist-energy" class="mp-bars"></div>
        <div id="mp-hist-energy-note" class="mp-muted"></div>

        <h4>Gap lengths <span class="mp-muted">— at the current threshold</span></h4>
        <div id="mp-hist-gaps" class="mp-bars"></div>
        <div id="mp-hist-gaps-note" class="mp-muted"></div>

        <h4>Every candidate threshold, evaluated at once</h4>
        <div id="mp-thr-table" class="mp-table"></div>
        <div class="mp-muted">A row with <b>0 topic gaps</b> and a high force-cut count is a recording that
          cannot be segmented from audio at that threshold. Click a row to adopt it.</div>
      </div>`;

    const q = s => el.querySelector(s);

    function render() {
        const a = state.audio;
        if (!a) { q('#mp-hist-energy').innerHTML = '<span class="mp-muted">run the audio lane</span>'; return; }

        // ── Energy ────────────────────────────────────────────────────────────
        const h = a.histogram;
        const fl = Math.round(a.dbfsLevels.floor), sp = Math.round(a.dbfsLevels.speech);
        const thrDb = 20 * Math.log10(Math.max(config.threshold, 1e-5));
        q('#mp-hist-energy').innerHTML = h.bins.map(b => {
            const pct = Math.round(100 * b.count / (h.max || 1));
            const isFloor = Math.abs(b.db - fl) <= 2, isSpeech = Math.abs(b.db - sp) <= 2;
            const cls = isFloor ? ' is-floor' : isSpeech ? ' is-speech' : '';
            const marker = Math.abs(b.db - thrDb) <= 1 ? ' is-threshold' : '';
            return `<div class="mp-bar-row${cls}${marker}" title="${b.db} dBFS — ${b.count} frames">
                <span class="mp-bar-row__lab">${b.db}</span>
                <span class="mp-bar-row__bar"><i style="width:${pct}%"></i></span>
                <span class="mp-bar-row__val">${b.count}</span></div>`;
        }).join('');
        q('#mp-hist-energy-note').innerHTML = a.levels.bimodal
            ? `Floor mode ≈ <b>${fl} dBFS</b>, speech mode ≈ <b>${sp} dBFS</b> — separable, so a threshold between them is meaningful.`
            : `<b>Not bimodal.</b> The quiet and loud modes are not separable, so no silence threshold can split speech from the floor on this recording.`;

        // ── Gaps ──────────────────────────────────────────────────────────────
        const g = state.gaps;
        if (g) {
            const gh = g.histogram;
            q('#mp-hist-gaps').innerHTML = gh.bins.map(b => {
                const pct = Math.round(100 * b.count / (gh.max || 1));
                const pop = POPULATIONS.find(p => b.fromMs >= p.minMs && b.fromMs < p.maxMs);
                return `<div class="mp-bar-row is-${pop ? pop.key : 'word'}">
                    <span class="mp-bar-row__lab">${b.toMs === Infinity ? `${b.fromMs}+` : `${b.fromMs}`}</span>
                    <span class="mp-bar-row__bar"><i style="width:${pct}%"></i></span>
                    <span class="mp-bar-row__val">${b.count}</span></div>`;
            }).join('');
            const p = g.populations;
            q('#mp-hist-gaps-note').innerHTML =
                `word ${p.word.count} · sentence ${p.sentence.count} · <b>topic ${p.topic.count}</b>` +
                (p.topic.count === 0
                    ? ' — <b>nothing to cut on.</b> This is the condition that produced nine identical 30-second captures on a real screencast.'
                    : ` (median ${p.topic.medianMs} ms) — usable as boundaries.`);
        }

        // ── The table ─────────────────────────────────────────────────────────
        const rows = state.thresholds || [];
        q('#mp-thr-table').innerHTML = rows.length ? `
            <div class="mp-table__row mp-table__row--head">
              <span>threshold</span><span>dBFS</span><span>gaps</span><span>topic</span><span>segments</span><span>force-cut</span>
            </div>` + rows.map(r => {
            const bad = r.topicGaps === 0 || (r.cappedRatio || 0) > 0.5;
            const active = Math.abs(r.value - config.threshold) < 1e-9;
            return `<div class="mp-table__row${bad ? ' is-bad' : ''}${active ? ' is-active' : ''}" data-thr="${r.value}">
                <span class="mp-mono">${r.value.toFixed(4)}${r.value === 0.01 ? ' ⚠' : ''}</span>
                <span>${r.db}</span><span>${r.gaps}</span><span>${r.topicGaps}</span>
                <span>${r.segments ?? '—'}</span><span>${r.capped ?? '—'}</span></div>`;
        }).join('') : '<span class="mp-muted">run the audio lane</span>';
    }

    q('#mp-thr-table').addEventListener('click', e => {
        const row = e.target.closest('[data-thr]');
        if (!row) return;
        Promise.resolve(api.setThreshold({ value: Number(row.dataset.thr) })).then(render).catch(() => {});
    });

    for (const ev of ['mp:analyse:complete', 'mp:threshold:changed', 'mp:reset']) {
        window.addEventListener(ev, render);
    }
    render();
}
