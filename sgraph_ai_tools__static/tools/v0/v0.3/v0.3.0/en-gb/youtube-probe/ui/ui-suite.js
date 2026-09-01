/**
 * ui-suite.js
 * The test list — one row per hypothesis, with its verdict and its evidence.
 *
 * Each row shows the HYPOTHESIS, not just a title, because half of these are
 * questions nobody has answered and the reader needs to know what is being asked
 * before a green tick means anything. Expanding a row shows what a pass and a
 * fail each MEAN for the pack — a result should change the plan, not colour a row.
 *
 * @module ui-suite
 */

const ICON = { pass: '✅', fail: '❌', info: 'ℹ️', blocked: '⏸️', error: '💥', running: '⏳' };

export function initSuite(el, state, ctx, api) {
    if (!el) return;
    el.innerHTML = `<div class="yp-suite">
        <div class="yp-row">
          <button id="yp-run-auto" class="yp-btn yp-btn--primary">▶ Run the offline tests (A1–A7)</button>
          <button id="yp-run-all" class="yp-btn">▶ Run everything except M8</button>
          <button id="yp-reset" class="yp-btn yp-btn--sm">Reset</button>
        </div>
        <div class="yp-note">
          The <b>A</b> tests need no token, no network and no clicks — and A3/A4 are the pair
          the region-mask decision stands or falls on. They record a synthetic talk in-page,
          so they take about a minute.
        </div>
        <div id="yp-progress" class="yp-muted"></div>
        <div id="yp-list" class="yp-list"></div>
      </div>`;

    const q = s => el.querySelector(s);
    let tests = [];

    Promise.resolve(api.listTests()).then(r => { tests = r.tests; render(); });

    function resultFor(id) { return state.results.find(r => r.id === id) || null; }

    function render() {
        const groups = [...new Set(tests.map(t => t.group))];
        q('#yp-list').innerHTML = groups.map(g => `
            <div class="yp-group">
              <div class="yp-group__h">${g}</div>
              ${tests.filter(t => t.group === g).map(row).join('')}
            </div>`).join('');
    }

    function row(t) {
        const r = resultFor(t.id);
        const running = state.running === t.id;
        const status = running ? 'running' : (r ? r.status : '');
        return `<div class="yp-test is-${status || 'none'}" data-id="${t.id}">
            <div class="yp-test__head">
              <span class="yp-test__icon">${ICON[status] || '·'}</span>
              <span class="yp-test__id">${t.id}</span>
              <span class="yp-test__title">${t.title}</span>
              ${t.needs ? `<span class="yp-chip">needs ${t.needs}</span>` : ''}
              <button class="yp-btn yp-btn--sm" data-run="${t.id}">${r ? 'Re-run' : 'Run'}</button>
            </div>
            <div class="yp-test__hyp">${t.hypothesis}</div>
            ${r ? `<div class="yp-test__detail">${escapeHtml(r.detail)}</div>` : ''}
            ${r && r.status === 'error'
                ? '<div class="yp-test__meaning"><b>What this means:</b> <b>nothing</b> — the harness'
                  + ' broke before the hypothesis was tested. Re-run it; this is not evidence either way.</div>'
                : r && r.meaning && r.meaning[r.status]
                    ? `<div class="yp-test__meaning"><b>What this means:</b> ${escapeHtml(r.meaning[r.status])}</div>` : ''}
            ${r && r.evidence != null
                ? `<details class="yp-test__ev"><summary>evidence (${r.ms} ms)</summary><pre>${
                    escapeHtml(JSON.stringify(r.evidence, null, 1))}</pre></details>` : ''}
          </div>`;
    }

    el.addEventListener('click', async (e) => {
        const id = e.target?.dataset?.run;
        if (!id) return;
        state.running = id; render();
        try { await api.runTest({ id }); }
        catch (err) { q('#yp-progress').textContent = `${err.code || 'error'}: ${err.message}`; }
        state.running = null; render();
    });

    q('#yp-run-auto').addEventListener('click', async () => {
        q('#yp-progress').textContent = 'running the offline battery…';
        try { await api.runAuto(); } catch (err) { q('#yp-progress').textContent = err.message; }
        q('#yp-progress').textContent = '';
        render();
    });
    q('#yp-run-all').addEventListener('click', async () => {
        q('#yp-progress').textContent = 'running…';
        try { await api.runAll({}); } catch (err) { q('#yp-progress').textContent = err.message; }
        q('#yp-progress').textContent = '';
        render();
    });
    q('#yp-reset').addEventListener('click', async () => { await api.reset(); render(); });

    window.addEventListener('yp:test:started', e => {
        state.running = e.detail.id;
        q('#yp-progress').textContent = `running ${e.detail.id} — ${e.detail.title}…`;
        render();
    });
    window.addEventListener('yp:test:progress', e => {
        if (e.detail?.message) q('#yp-progress').textContent = e.detail.message;
    });
    window.addEventListener('yp:test:complete', () => { state.running = null; render(); });
}

function escapeHtml(s) {
    return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}
