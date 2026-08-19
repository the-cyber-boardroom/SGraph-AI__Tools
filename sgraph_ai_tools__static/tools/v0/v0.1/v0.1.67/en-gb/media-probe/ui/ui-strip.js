/**
 * ui-strip.js
 * Every detected scene change as a thumbnail, with the metric values that fired.
 *
 * This is where you find out whether `blockMax` caught a real change or a moving
 * cursor. A detector you cannot inspect is a detector you have to trust, and the
 * hardcoded single metric it replaces was trusted for exactly that reason.
 *
 * @module ui-strip
 */

import { METRIC_NOTES, METRICS } from '/core/sg-media-analysis/v0/v0.1/v0.1.0/frame-metrics.js';

export function initStrip(el, state, api) {
    if (!el) return;
    el.innerHTML = `<div class="mp-strip">
        <div class="mp-row">
          <label>detect on
            <select id="mp-metric">${METRICS.map(m => `<option value="${m}">${m}</option>`).join('')}</select>
          </label>
          <label><input id="mp-otsu" type="checkbox" checked> natural break</label>
          <label>× p95 <input id="mp-factor" type="number" min="0.5" max="10" step="0.25" value="1.5" disabled></label>
          <button id="mp-redetect" class="mp-btn mp-btn--sm">Re-detect</button>
          <span id="mp-strip-state" class="mp-muted"></span>
        </div>
        <div id="mp-metric-note" class="mp-muted"></div>
        <div id="mp-agree" class="mp-agree"></div>
        <div id="mp-shots" class="mp-shots"></div>
      </div>`;

    const q = s => el.querySelector(s);
    let rendering = false;

    function note() {
        q('#mp-metric-note').textContent = METRIC_NOTES[q('#mp-metric').value] || '';
    }
    q('#mp-metric').addEventListener('change', () => { note(); redetect(); });
    q('#mp-redetect').addEventListener('click', redetect);
    q('#mp-otsu').addEventListener('change', () => { q('#mp-factor').disabled = q('#mp-otsu').checked; redetect(); });
    note();

    async function redetect() {
        if (!state.frames) { q('#mp-strip-state').textContent = 'run the frame sweep first'; return; }
        try {
            // Default: let the recording's own distribution pick the split. The
            // p95 factor is the old behaviour, kept switchable for comparison.
            await api.findScenes(q('#mp-otsu').checked
                ? { metric: q('#mp-metric').value }
                : { metric: q('#mp-metric').value, factor: Number(q('#mp-factor').value) });
            render();
        } catch (err) { q('#mp-strip-state').textContent = `${err.code || 'error'}: ${err.message}`; }
    }

    async function render() {
        const sc = state.scenes;
        if (!sc) { q('#mp-shots').innerHTML = '<span class="mp-muted">run the frame sweep</span>'; return; }
        q('#mp-metric').value = sc.metric;
        q('#mp-strip-state').textContent = sc.scenes.length
            ? `${sc.scenes.length} scenes above ${sc.threshold.toFixed(4)} — ${sc.basis}`
            : `no scenes — ${sc.basis}`;

        // Metric agreement — the empirical answer to "which metric should we use?".
        const pm = sc.perMetric || {};
        q('#mp-agree').innerHTML = Object.entries(pm).map(([m, v]) =>
            `<span class="mp-agree__i${m === sc.metric ? ' is-ref' : ''}">${m}: <b>${v.scenes}</b>` +
            (m === sc.metric ? ' (reference)' : ` · ${v.sharedWithReference} shared, ${v.onlyThis} unique`) + '</span>').join('');

        if (rendering) return;
        rendering = true;
        q('#mp-shots').innerHTML = sc.scenes.map((s, i) =>
            `<div class="mp-shot" data-at="${s.at}">
               <div class="mp-shot__imgs"><img data-slot="before" alt=""><img data-slot="after" alt=""></div>
               <div class="mp-shot__meta">
                 <b>#${i + 1}</b> ${fmt(s.at)} · ${s.metric} ${s.value.toFixed(4)}
                 · held ${(s.durationMs / 1000).toFixed(1)}s
                 ${s.agreed && s.agreed.length ? `· also ${s.agreed.join(', ')}` : '· <i>this metric only</i>'}
               </div>
             </div>`).join('');
        // Thumbnails are fetched one at a time — each is a seek, and a burst of
        // parallel seeks on one <video> element just fights itself.
        for (const row of q('#mp-shots').querySelectorAll('.mp-shot')) {
            const at = Number(row.dataset.at);
            try {
                const before = await api.getSceneThumb({ at: Math.max(0, at - 700), width: 150 });
                const after = await api.getSceneThumb({ at, width: 150 });
                row.querySelector('[data-slot="before"]').src = before.dataUrl;
                row.querySelector('[data-slot="after"]').src = after.dataUrl;
            } catch (_) { /* no picture — leave the metadata */ }
        }
        rendering = false;
    }

    for (const ev of ['mp:analyse:complete', 'mp:reset']) window.addEventListener(ev, () => render().catch(() => {}));
    render().catch(() => {});
}

function fmt(ms) {
    const t = Math.round(ms / 1000);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
