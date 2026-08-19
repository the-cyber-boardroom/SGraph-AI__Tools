/**
 * mv-events — the tool's event names, frozen.
 *
 * Every name lives here so the UI, the API layer and the SKILL docs cannot
 * drift apart on a string literal.
 *
 * @module markdown-viewer/mv-events
 */

export const MV_EVENTS = Object.freeze({
    /** A document was loaded and parsed. detail: { name, bytes, headings, config, source } */
    LOADED:      'mv:document:loaded',
    /** The rendered HTML changed (load, or a re-render after an option change). */
    RENDERED:    'mv:document:rendered',
    /** Rendered ↔ source view toggled. detail: { source } */
    VIEW:        'mv:view:changed',
    /** A render option changed. detail: { pageBreakBefore, wide } */
    OPTIONS:     'mv:options:changed',
    /** The print dialog was opened. detail: { name } */
    PRINTED:     'mv:print:opened',
    /** The document was cleared. */
    CLEARED:     'mv:document:cleared',
    /** Something failed. detail: { code, message } */
    ERROR:       'mv:error',
});

/** Typed failure codes, so callers can branch without matching on prose. */
export const MV_ERRORS = Object.freeze({
    NO_DOCUMENT:  'no-document',
    FETCH_FAILED: 'fetch-failed',
    READ_FAILED:  'read-failed',
    BAD_URL:      'bad-url',
});
