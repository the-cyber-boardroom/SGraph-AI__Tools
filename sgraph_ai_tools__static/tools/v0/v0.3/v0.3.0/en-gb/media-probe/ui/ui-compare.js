/**
 * ui-compare.js
 * What narrated-review does today versus what the plan proposes — in captures,
 * in forced cuts, and in money.
 *
 * The money column is the honest way to state "more efficient". Spend scales with
 * the NUMBER of captures, because cleanup sends a screenshot per capture and
 * images dominate the token count. So fewer, better-placed captures is a cost win
 * and a quality win at the same time, which is rare and worth showing plainly.
 *
 * @module ui-compare
 */

export function initCompare(el, state, api) {
    if (!el) return;
    el.innerHTML = `<div class="mp-compare">
        <div class="mp-row">
          <button id="mp-run-compare" class="mp-btn mp-btn--sm">Compare</button>
          <span id="mp-compare-state" class="mp-muted"></span>
        </div>
        <div id="mp-compare-table" class="mp-table"></div>
        <div id="mp-compare-cuts" class="mp-cuts"></div>
        <div id="mp-compare-basis" class="mp-muted"></div>
      </div>`;

    const q = s => el.querySelector(s);

    q('#mp-run-compare').addEventListener('click', render);

    async function render() {
        let c;
        try { c = await api.compare(); }
        catch (err) { q('#mp-compare-state').textContent = `${err.code || 'error'}: ${err.message}`; return; }
        q('#mp-compare-state').textContent = '';

        const row = (label, today, planned, fmt = String) =>
            `<div class="mp-table__row"><span>${label}</span><span>${fmt(today)}</span><span>${fmt(planned)}</span></div>`;
        const usd = v => `$${Number(v || 0).toFixed(3)}`;

        q('#mp-compare-table').innerHTML =
            `<div class="mp-table__row mp-table__row--head"><span></span><span>today</span><span>plan (${c.plan.strategy})</span></div>`
            + row('captures', c.today.captures, c.plan.captures)
            + row('force-cut at the length limit', c.today.capped, c.plan.capped)
            + row('mean segment', c.today.meanSegmentMs || 0, '—', v => (typeof v === 'number' ? `${(v / 1000).toFixed(1)} s` : v))
            + row('transcription', c.today.estimate.transcribeUsd, c.plan.estimate.transcribeUsd, usd)
            + row('cleanup', c.today.estimate.cleanUsd, c.plan.estimate.cleanUsd, usd)
            + row('<b>total</b>', c.today.estimate.totalUsd, c.plan.estimate.totalUsd, usd);

        const saving = -c.delta.usd;
        q('#mp-compare-basis').innerHTML = (saving > 0.0005
            ? `<b>${usd(saving)} less</b>, because spend scales with the number of captures — cleanup sends a screenshot each time.<br>`
            : saving < -0.0005 ? `<b>${usd(-saving)} more</b> — the plan proposes more captures than the current segmentation.<br>` : '')
            + `Cost basis: ${c.basis}`;

        // The proposed cuts, each with the reason it exists. A boundary with no
        // reason is the thing this whole tool was built to stop shipping.
        const cuts = (state.plan && state.plan.cuts) || [];
        q('#mp-compare-cuts').innerHTML = cuts.length ? `<h4>Proposed cuts, and why</h4>` + cuts.map((cut, i) => {
            const shot = (state.plan.shots || [])[i];
            const why = cut.source === 'silence' ? `a ${cut.evidence.gapMs} ms pause`
                : cut.source === 'scene' ? `${cut.evidence.metric} ${fmtNum(cut.evidence.value)} > ${fmtNum(cut.evidence.threshold)}`
                    : cut.source === 'scene+silence' ? `a scene change, snapped ${cut.evidence.snappedByMs} ms to a ${cut.evidence.snappedToGapMs} ms pause`
                        : cut.source === 'length-limit' ? '<b class="mp-warn-text">ARBITRARY — no pause or scene change within the limit</b>'
                            : cut.evidence.note || '';
            const shotWhy = shot && shot.evidence.source === 'scene'
                ? `frame at ${fmtTime(shot.tMs)} (${shot.evidence.offsetFromCutMs > 0 ? '+' : ''}${shot.evidence.offsetFromCutMs} ms)`
                : 'frame at the cut itself';
            return `<div class="mp-cut"><span class="mp-mono">${fmtTime(cut.tMs)}</span>
                <span>${cut.source}</span><span class="mp-muted">${why}</span><span class="mp-muted">${shotWhy}</span></div>`;
        }).join('') : '<span class="mp-muted">no plan yet — or the plan refused (see Findings)</span>';
    }

    for (const ev of ['mp:plan:ready', 'mp:reset']) window.addEventListener(ev, () => render().catch(() => {}));
}

function fmtNum(v) { return typeof v === 'number' ? v.toFixed(4) : String(v); }
function fmtTime(ms) {
    const t = Math.round(ms / 1000);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
