/**
 * ui-toolbar — the top bar: file name, view toggles, Print, Close.
 *
 * @module markdown-viewer/ui-toolbar
 */

import { state, hasDocument } from '../api/mv-state.js';
import { MV_EVENTS }          from '../api/mv-events.js';
import * as pipeline          from '../api/mv-pipeline.js';

let elName, elMeta, elSourceBtn, elWideBtn, elPrintBtn, elCloseBtn;

/** Wire the toolbar. Called once, after DOMContentLoaded. */
export function mountToolbar() {
    elName      = document.getElementById('mv-name');
    elMeta      = document.getElementById('mv-meta');
    elSourceBtn = document.getElementById('mv-toggle-source');
    elWideBtn   = document.getElementById('mv-toggle-wide');
    elPrintBtn  = document.getElementById('mv-print');
    elCloseBtn  = document.getElementById('mv-close');

    elSourceBtn.addEventListener('click', () => pipeline.setSourceView());
    elWideBtn  .addEventListener('click', () => pipeline.setOptions({ wide: !state.wide }));
    elPrintBtn .addEventListener('click', () => pipeline.print());
    elCloseBtn .addEventListener('click', () => pipeline.clear());

    for (const evt of [MV_EVENTS.LOADED, MV_EVENTS.VIEW, MV_EVENTS.OPTIONS, MV_EVENTS.CLEARED]) {
        document.addEventListener(evt, refreshToolbar);
    }

    // Ctrl/Cmd-P prints the document rather than the whole page furniture.
    // The print stylesheet does the same job for the browser's own menu item,
    // so this is only about intent, not correctness.
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p' && hasDocument()) {
            e.preventDefault();
            pipeline.print();
        }
    });

    refreshToolbar();
}

/** Reflect state into the toolbar. */
export function refreshToolbar() {
    const loaded = hasDocument();

    elName.textContent = loaded ? state.name : 'No document';
    elMeta.textContent = loaded ? metaLine() : '';

    for (const btn of [elSourceBtn, elWideBtn, elPrintBtn, elCloseBtn]) btn.disabled = !loaded;

    elSourceBtn.textContent = state.showSource ? 'Rendered' : 'Source';
    elSourceBtn.setAttribute('aria-pressed', String(state.showSource));
    elWideBtn.setAttribute('aria-pressed', String(state.wide));
}

/** "12.4 KB · 18 headings · page breaks: H1" */
function metaLine() {
    const parts = [formatBytes(state.bytes)];
    if (state.headings.length) parts.push(`${state.headings.length} headings`);

    const pb = state.pageBreakBefore ?? state.config.page_break_before;
    if (pb) {
        const levels = (Array.isArray(pb) ? pb : [pb])
            .map(v => String(v).toUpperCase().replace(/^H?([1-6])$/, 'H$1'))
            .join(' ');
        parts.push(`page breaks: ${levels}`);
    }
    return parts.join('  ·  ');
}

/** @param {number} n @returns {string} */
function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
