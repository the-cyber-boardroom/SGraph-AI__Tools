/**
 * ui-report.js
 * The findings, in words — copyable, and honest about what did not run.
 * @module ui-report
 */

import { renderMarkdown } from '/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js';

export function initReport(el, state, api) {
    if (!el) return;
    el.innerHTML = `<div class="yp-report">
        <div class="yp-row">
          <button id="yp-copy" class="yp-btn yp-btn--sm">Copy</button>
          <button id="yp-dl-md" class="yp-btn yp-btn--sm">⬇ findings.md</button>
          <button id="yp-dl-json" class="yp-btn yp-btn--sm">⬇ results.json</button>
          <span id="yp-report-state" class="yp-muted"></span>
        </div>
        <div id="yp-report-body" class="yp-md"></div>
      </div>`;

    const q = s => el.querySelector(s);
    let last = '';

    async function render() {
        try {
            const { markdown } = await api.getReport();
            last = markdown;
            q('#yp-report-body').innerHTML = renderMarkdown(markdown);
        } catch (err) { q('#yp-report-body').textContent = err.message; }
    }

    q('#yp-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(last); q('#yp-report-state').textContent = 'copied'; }
        catch (_) { q('#yp-report-state').textContent = 'clipboard unavailable'; }
        setTimeout(() => { q('#yp-report-state').textContent = ''; }, 1500);
    });
    q('#yp-dl-md').addEventListener('click', () => api.downloadReport({ format: 'md' }));
    q('#yp-dl-json').addEventListener('click', () => api.downloadReport({ format: 'json' }));

    for (const ev of ['yp:test:complete', 'yp:suite:complete', 'yp:reset']) {
        window.addEventListener(ev, () => render());
    }
    render();
}
