/**
 * mv-state — the tool's mutable state, in one place.
 *
 * Plain in-memory object. The one thing that outlives a reload is the two view
 * preferences, kept in localStorage: a reader who has chosen wide measure once
 * should not have to choose it on every document.
 *
 * @module markdown-viewer/mv-state
 */

const PREFS_KEY = 'sg-markdown-viewer-prefs';

/** @type {{ name: string|null, source: string, html: string, config: object,
 *           headings: Array, bytes: number, loadedFrom: string|null,
 *           showSource: boolean, wide: boolean, pageBreakBefore: * }} */
export const state = {
    name:            null,   // file name, or a label for pasted text
    source:          '',     // raw markdown, including front matter
    html:            '',     // last rendered HTML
    config:          {},     // front matter
    headings:        [],     // [{ level, text, id }] for the outline
    bytes:           0,
    loadedFrom:      null,   // 'file' | 'text' | 'url'
    showSource:      false,
    wide:            false,
    pageBreakBefore: null,   // overrides front matter when set
};

/** True when a document is loaded. */
export const hasDocument = () => state.source !== '';

/**
 * Reset to the empty state, keeping the reader's view preferences.
 */
export function clearDocument() {
    state.name       = null;
    state.source     = '';
    state.html       = '';
    state.config     = {};
    state.headings   = [];
    state.bytes      = 0;
    state.loadedFrom = null;
}

/**
 * Load the persisted view preferences.
 *
 * localStorage is unavailable in some embedding contexts, so every access is
 * guarded — a failure here must never stop the tool from opening a document.
 */
export function loadPrefs() {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw) return;
        const prefs = JSON.parse(raw);
        if (typeof prefs.wide === 'boolean')       state.wide       = prefs.wide;
        if (typeof prefs.showSource === 'boolean') state.showSource = prefs.showSource;
    } catch { /* no persistence available — defaults stand */ }
}

/** Persist the view preferences. */
export function savePrefs() {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify({
            wide:       state.wide,
            showSource: state.showSource,
        }));
    } catch { /* ignore */ }
}

/**
 * A serialisable snapshot for `getStatus()` — no document text, which can be
 * large and is available through `getSource()`.
 *
 * @returns {object}
 */
export function snapshot() {
    return {
        loaded:          hasDocument(),
        name:            state.name,
        bytes:           state.bytes,
        loadedFrom:      state.loadedFrom,
        headings:        state.headings.length,
        config:          state.config,
        showSource:      state.showSource,
        wide:            state.wide,
        pageBreakBefore: state.pageBreakBefore,
    };
}
