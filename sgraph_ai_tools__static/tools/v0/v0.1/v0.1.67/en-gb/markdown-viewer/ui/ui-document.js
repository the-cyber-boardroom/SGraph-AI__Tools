/**
 * ui-document — the reading pane: rendered document, raw source, outline.
 *
 * @module markdown-viewer/ui-document
 */

import { state, hasDocument }   from '../api/mv-state.js';
import { MV_EVENTS }            from '../api/mv-events.js';

let elDoc, elSource, elOutline, elEmpty, elMain;

/**
 * Wire the reading pane to the elements already in index.html.
 * Called once, after DOMContentLoaded.
 */
export function mountDocument() {
    elMain    = document.getElementById('mv-main');
    elDoc     = document.getElementById('mv-rendered');
    elSource  = document.getElementById('mv-source');
    elOutline = document.getElementById('mv-outline');
    elEmpty   = document.getElementById('mv-empty');

    for (const evt of [MV_EVENTS.LOADED, MV_EVENTS.RENDERED, MV_EVENTS.VIEW,
                       MV_EVENTS.OPTIONS, MV_EVENTS.CLEARED]) {
        document.addEventListener(evt, refresh);
    }

    // Outline clicks scroll the document rather than navigating, so a deep
    // link inside a long file does not add a history entry per heading.
    elOutline.addEventListener('click', (e) => {
        const link = e.target.closest('a[data-id]');
        if (!link) return;
        e.preventDefault();
        const target = elDoc.querySelector(`[id="${CSS.escape(link.dataset.id)}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    refresh();
}

/** Re-paint everything from state. Cheap enough to run on any change. */
export function refresh() {
    const loaded = hasDocument();

    elEmpty.hidden = loaded;
    elMain.hidden  = !loaded;
    if (!loaded) { elOutline.innerHTML = ''; return; }

    // The parser guarantees escaped output — this is the one innerHTML in the
    // tool, and it is fed only by core/markdown.
    elDoc.innerHTML     = state.html;
    elSource.textContent = state.source;

    elDoc.hidden    = state.showSource;
    elSource.hidden = !state.showSource;

    elMain.classList.toggle('mv-main--wide', state.wide);

    renderOutline();
    document.title = `${state.name} — Markdown Viewer`;
}

/** Build the heading outline. Hidden when a document has too few headings. */
function renderOutline() {
    const headings = state.headings;
    elOutline.hidden = headings.length < 2;
    if (elOutline.hidden) { elOutline.innerHTML = ''; return; }

    // textContent per node: heading text is author-controlled and must never be
    // concatenated into an HTML string here.
    elOutline.replaceChildren(...headings.map((h) => {
        const a = document.createElement('a');
        a.href           = `#${h.id}`;
        a.dataset.id     = h.id;
        a.className      = `mv-outline__item mv-outline__item--h${h.level}`;
        a.textContent    = h.text.replace(/[*_`~]/g, '');
        return a;
    }));
}
