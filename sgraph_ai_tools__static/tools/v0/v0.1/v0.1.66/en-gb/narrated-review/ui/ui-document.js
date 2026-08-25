/**
 * ui-document.js
 * Rendered preview of the assembled review.md (core/markdown). Image refs in
 * the markdown point into the bundle (images/pair-NN.png), so the preview
 * swaps them for live object URLs.
 * @module ui-document
 */

import { renderMarkdown } from '/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js';
import { imageName } from '../api/nr-document.js';

export function initDocument(el, state, api) {
    if (!el) return;
    el.innerHTML = `<div class="nr-doc">
        <div class="nr-doc__bar">
          <button id="nr-doc-build" class="nr-btn nr-btn--primary">📄 Build document</button>
          <button id="nr-doc-copy" class="nr-btn" disabled>⧉ Copy markdown</button>
        </div>
        <div id="nr-doc-preview" class="nr-doc__preview nr-muted">Build to preview review.md</div>
      </div>`;

    const q = s => el.querySelector(s);
    let markdown = '';
    const urls = [];

    async function build() {
        const doc = await api.buildDocument();
        markdown = doc.markdown;
        for (const u of urls.splice(0)) URL.revokeObjectURL(u);
        let html = renderMarkdown(markdown);
        // core/markdown v1.0.0 has no image syntax — it renders `![alt](src)`
        // as a literal "!" followed by a link. Promote those back to real
        // <img> tags so the preview shows the pairs (the exported review.md is
        // plain markdown and unaffected).
        html = html.replace(/!<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g, '<img src="$1" alt="$2">');
        // Swap bundle-relative image refs for live blobs.
        for (const p of state.pairs) {
            if (!p.screenshot) continue;
            const url = URL.createObjectURL(p.screenshot);
            urls.push(url);
            html = html.split(`images/${imageName(p)}`).join(url);
        }
        q('#nr-doc-preview').innerHTML = html;
        q('#nr-doc-preview').classList.remove('nr-muted');
        q('#nr-doc-copy').disabled = false;
    }

    q('#nr-doc-build').addEventListener('click', () => build().catch(() => {}));
    q('#nr-doc-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(markdown); q('#nr-doc-copy').textContent = '✓ Copied'; }
        catch (_) { q('#nr-doc-copy').textContent = 'copy failed'; }
        setTimeout(() => { q('#nr-doc-copy').textContent = '⧉ Copy markdown'; }, 1500);
    });
    window.addEventListener('nr:reset', () => {
        markdown = '';
        q('#nr-doc-preview').textContent = 'Build to preview review.md';
        q('#nr-doc-preview').classList.add('nr-muted');
        q('#nr-doc-copy').disabled = true;
    });
}
