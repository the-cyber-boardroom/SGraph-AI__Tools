/**
 * mv-pipeline — the glue between state and core/markdown.
 *
 * Everything here is DOM-free and returns plain data, so the same functions
 * serve the UI, the JS API and a headless Playwright driver.
 *
 * @module markdown-viewer/mv-pipeline
 */

import { parseMarkdown } from '/core/markdown/v1/v1.1/v1.1.0/sg-markdown.js';
import { state, clearDocument, savePrefs, hasDocument } from './mv-state.js';
import { MV_EVENTS, MV_ERRORS } from './mv-events.js';

/** Fire a tool event on `document`, so any listener can hear it. */
export function emit(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
}

/** A typed failure: reported as an event AND thrown, so both styles work. */
function fail(code, message) {
    emit(MV_EVENTS.ERROR, { code, message });
    return Object.assign(new Error(message), { code });
}

/**
 * Re-parse the current source and refresh the derived state.
 *
 * @returns {{ html: string, headings: Array, config: object }}
 */
export function render() {
    const out = parseMarkdown(state.source, {
        pageBreakBefore: state.pageBreakBefore,
        imageSrc:        'direct',
    });
    state.html     = out.html;
    state.config   = out.config;
    state.headings = out.headings;

    emit(MV_EVENTS.RENDERED, { headings: state.headings.length, bytes: state.bytes });
    return { html: out.html, headings: out.headings, config: out.config };
}

/**
 * Render markdown without touching the loaded document.
 *
 * The parser as a plain function, for callers that want HTML out of a string —
 * an agent formatting a reply, a sibling tool previewing a snippet — with no
 * side effects on what the reader is looking at.
 *
 * @param {string} text - Markdown source
 * @param {object} [options] - Passed through to core/markdown's parseMarkdown
 * @returns {{ html: string, headings: Array, config: object }}
 */
export function renderStandalone(text, options = {}) {
    const out = parseMarkdown(String(text ?? ''), options);
    return { html: out.html, headings: out.headings, config: out.config };
}

/**
 * Load markdown from a string.
 *
 * @param {string} text - Markdown source
 * @param {string} [name] - Display name for the document
 * @param {string} [from] - 'file' | 'text' | 'url'
 * @returns {{ name: string, bytes: number, headings: Array, config: object }}
 */
export function loadText(text, name = 'pasted.md', from = 'text') {
    state.source     = String(text ?? '');
    state.name       = name;
    state.bytes      = new TextEncoder().encode(state.source).length;
    state.loadedFrom = from;

    const out = render();

    // A `title` in the front matter is a better name than the filename.
    if (typeof out.config.title === 'string' && out.config.title.trim()) {
        state.name = out.config.title.trim();
    }

    emit(MV_EVENTS.LOADED, {
        name:     state.name,
        bytes:    state.bytes,
        headings: state.headings.length,
        config:   state.config,
        from,
    });
    return { name: state.name, bytes: state.bytes, headings: state.headings, config: state.config };
}

/**
 * Load markdown from a File or Blob.
 *
 * @param {File|Blob} file
 * @returns {Promise<{ name: string, bytes: number, headings: Array, config: object }>}
 */
export async function loadFile(file) {
    if (!file) throw fail(MV_ERRORS.READ_FAILED, 'No file given');
    let text;
    try {
        text = await file.text();
    } catch (err) {
        throw fail(MV_ERRORS.READ_FAILED, `Could not read the file: ${err?.message || err}`);
    }
    return loadText(text, file.name || 'document.md', 'file');
}

/**
 * Fetch markdown over HTTP and load it.
 *
 * Cross-origin reads depend entirely on the far host's CORS headers — there is
 * no server here to proxy through, by design. A blocked fetch reports
 * `fetch-failed` rather than pretending the document is empty.
 *
 * @param {string} url - http(s) or same-origin relative URL
 * @returns {Promise<{ name: string, bytes: number, headings: Array, config: object }>}
 */
export async function loadUrl(url) {
    let parsed;
    try {
        parsed = new URL(url, window.location.href);
    } catch {
        throw fail(MV_ERRORS.BAD_URL, `Not a URL: ${url}`);
    }
    if (!/^https?:$/.test(parsed.protocol)) {
        throw fail(MV_ERRORS.BAD_URL, `Only http(s) URLs can be fetched (got ${parsed.protocol})`);
    }

    let res;
    try {
        res = await fetch(parsed.href);
    } catch (err) {
        throw fail(MV_ERRORS.FETCH_FAILED,
            `Could not fetch ${parsed.href} — the host may not allow cross-origin reads (${err?.message || err})`);
    }
    if (!res.ok) throw fail(MV_ERRORS.FETCH_FAILED, `${parsed.href} returned HTTP ${res.status}`);

    const name = parsed.pathname.split('/').filter(Boolean).pop() || 'document.md';
    return loadText(await res.text(), decodeURIComponent(name), 'url');
}

/**
 * Switch between the rendered document and its raw source.
 *
 * @param {boolean} [on] - Omit to toggle
 * @returns {{ source: boolean }}
 */
export function setSourceView(on) {
    state.showSource = on === undefined ? !state.showSource : !!on;
    savePrefs();
    emit(MV_EVENTS.VIEW, { source: state.showSource });
    return { source: state.showSource };
}

/**
 * Set render/layout options.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.wide] - Drop the reading-measure cap
 * @param {*} [opts.pageBreakBefore] - Override the document's own setting;
 *   `null` hands control back to the front matter
 * @returns {{ wide: boolean, pageBreakBefore: * }}
 */
export function setOptions(opts = {}) {
    let needsRender = false;

    if (opts.wide !== undefined) { state.wide = !!opts.wide; savePrefs(); }
    if (opts.pageBreakBefore !== undefined) {
        state.pageBreakBefore = opts.pageBreakBefore;
        needsRender = true;
    }

    emit(MV_EVENTS.OPTIONS, { wide: state.wide, pageBreakBefore: state.pageBreakBefore });
    if (needsRender && hasDocument()) render();

    return { wide: state.wide, pageBreakBefore: state.pageBreakBefore };
}

/** Clear the loaded document. @returns {{ ok: boolean }} */
export function clear() {
    clearDocument();
    emit(MV_EVENTS.CLEARED, {});
    return { ok: true };
}

/**
 * Open the browser's print dialog for the rendered document.
 *
 * The page's print stylesheet hides the chrome and prints only the document, so
 * this needs no separate print window — which also means it works identically
 * whether a human clicked Print or a script called `print()`.
 *
 * @returns {{ name: string }}
 */
export function print() {
    if (!hasDocument()) throw fail(MV_ERRORS.NO_DOCUMENT, 'Load a document before printing');
    emit(MV_EVENTS.PRINTED, { name: state.name });
    window.print();
    return { name: state.name };
}
