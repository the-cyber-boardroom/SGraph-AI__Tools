/**
 * composer-export-debug.js — diagnostic CustomEvent dispatcher for export.
 * Listen on document: document.addEventListener('composer:export-debug', e => …).
 * @module video-composer/composer-export-debug
 */

const EVENT_NAME = 'composer:export-debug';

/**
 * Dispatch a `composer:export-debug` CustomEvent on `document` (no-op outside a DOM).
 * @param {string} stage Short stage label, e.g. 'start', 'recorder-start', 'clip-active', 'finish', 'blob', 'error'.
 * @param {object} [info] Arbitrary context payload (clipId, time, mimeType, size, error...).
 * @returns {void}
 */
export function debug(stage, info) {
    if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
    try {
        document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { stage, info: info || {} } }));
    } catch (_) { /* best-effort */ }
}

export { EVENT_NAME as EXPORT_DEBUG_EVENT };
