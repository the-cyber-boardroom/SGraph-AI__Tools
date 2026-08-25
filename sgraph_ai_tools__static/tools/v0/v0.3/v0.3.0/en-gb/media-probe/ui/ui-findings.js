/**
 * ui-findings.js
 * The verdict in words, refreshed as each lane lands — including what has NOT
 * been measured yet.
 * @module ui-findings
 */

import { renderMarkdown } from '/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js';

export function initFindings(el, state, api) {
    if (!el) return;
    el.innerHTML = `<div class="mp-findings">
        <div class="mp-row">
          <button id="mp-copy-findings" class="mp-btn mp-btn--sm">Copy</button>
          <span id="mp-findings-state" class="mp-muted"></span>
        </div>
        <div id="mp-findings-body" class="mp-md"></div>
      </div>`;

    const q = s => el.querySelector(s);
    let last = '';

    async function render() {
        try {
            const { markdown } = await api.getFindings();
            last = markdown;
            q('#mp-findings-body').innerHTML = renderMarkdown(markdown);
        } catch (err) { q('#mp-findings-body').textContent = err.message; }
    }

    q('#mp-copy-findings').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(last); q('#mp-findings-state').textContent = 'copied'; }
        catch (_) { q('#mp-findings-state').textContent = 'clipboard unavailable'; }
        setTimeout(() => { q('#mp-findings-state').textContent = ''; }, 1500);
    });

    for (const ev of ['mp:source:loaded', 'mp:analyse:complete', 'mp:plan:ready', 'mp:threshold:changed', 'mp:reset']) {
        window.addEventListener(ev, () => render());
    }
    render();
}
