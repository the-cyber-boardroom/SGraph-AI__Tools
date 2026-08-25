/**
 * ui-align.js
 * How far the picture leads the words — measured, with narrated-review's assumed
 * window drawn over it.
 *
 * The tool currently searches 2500 ms before speech to 1200 ms after. Those two
 * numbers were reasoned, not measured. This panel shows the real distribution and
 * whether the assumption holds for this speaker.
 *
 * @module ui-align
 */

export function initAlign(el, state, api) {
    if (!el) return;
    el.innerHTML = `<div class="mp-align">
        <div class="mp-row">
          <button id="mp-run-align" class="mp-btn mp-btn--sm">Measure alignment</button>
          <span id="mp-align-state" class="mp-muted">needs both lanes</span>
        </div>
        <div id="mp-align-plot" class="mp-bars"></div>
        <div id="mp-align-note" class="mp-muted"></div>
      </div>`;

    const q = s => el.querySelector(s);

    q('#mp-run-align').addEventListener('click', async () => {
        try { await api.alignSignals({}); render(); }
        catch (err) { q('#mp-align-state').textContent = `${err.code || 'error'}: ${err.message}`; }
    });

    function render() {
        const a = state.align;
        if (!a) { q('#mp-align-plot').innerHTML = '<span class="mp-muted">not measured yet</span>'; return; }
        q('#mp-align-state').textContent = `${a.count} pairings from ${a.onsets} speech onsets`;

        // Histogram of (speech onset − scene change): positive means the picture
        // led. 500 ms buckets over ±6 s.
        const buckets = new Map();
        for (const d of a.deltas) {
            const b = Math.floor(d.deltaMs / 500) * 500;
            buckets.set(b, (buckets.get(b) || 0) + 1);
        }
        const keys = [...buckets.keys()].sort((x, y) => x - y);
        const max = Math.max(1, ...buckets.values());
        q('#mp-align-plot').innerHTML = keys.map(k => {
            const inAssumed = k >= -2500 && k <= 1200;   // narrated-review's window
            const inMeasured = k >= -(a.suggestedLeadMs || 0) && k <= (a.suggestedLagMs || 0);
            return `<div class="mp-bar-row${inAssumed ? ' is-assumed' : ''}${inMeasured ? ' is-measured' : ''}"
                        title="${k} to ${k + 500} ms${inAssumed ? ' — inside the assumed 2500/1200 window' : ''}">
                <span class="mp-bar-row__lab">${k > 0 ? '+' : ''}${k}</span>
                <span class="mp-bar-row__bar"><i style="width:${Math.round(100 * buckets.get(k) / max)}%"></i></span>
                <span class="mp-bar-row__val">${buckets.get(k)}</span></div>`;
        }).join('');

        const lines = [];
        lines.push(`Median <b>${a.median} ms</b> (p10 ${a.p10}, p90 ${a.p90}). Positive = the picture led the words.`);
        lines.push(`Measured window: lead <b>${a.suggestedLeadMs} ms</b> / lag <b>${a.suggestedLagMs} ms</b>. narrated-review assumes 2500 / 1200.`);
        if (!a.correlated) {
            lines.push(`<b>Only ${Math.round(a.pairedRatio * 100)}% of scene changes have a speech onset nearby.</b>
                The pictures and the words in this recording do not really track each other, so any pairing —
                by this tool or by narrated-review — will be somewhat arbitrary.`);
        }
        q('#mp-align-note').innerHTML = lines.join('<br>');
    }

    for (const ev of ['mp:analyse:complete', 'mp:reset']) window.addEventListener(ev, render);
    render();
}
