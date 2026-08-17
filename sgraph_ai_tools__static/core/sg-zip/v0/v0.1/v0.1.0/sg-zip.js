/**
 * sg-zip — lazy JSZip loading + generic entry-list zipping.
 *
 * Extracted from the established repo pattern (audio-transcribe v0.1.60
 * api/audio-zip.js loadJSZip, itself copied from heic-converter): JSZip is
 * lazy-loaded from a pinned CDN URL via classic <script> injection, and
 * `zipEntries` turns a flat list of `{ path, blob? | text? }` entries into a
 * .zip Blob. JSZip is injectable for headless tests.
 *
 * Tool-specific bundle SHAPES (which files go in, manifests, index.txt) stay
 * in the tools — this module only loads the library and writes entries.
 *
 * @module sg-zip
 * @version 0.1.0
 */

const JSZIP_CDN_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

/** @type {Promise<void>|null} */
let _jszipLoad = null;

/**
 * Lazy-load JSZip via classic <script> tag injection (publishes globalThis.JSZip).
 * @returns {Promise<void>}
 */
export function loadJSZip() {
    if (typeof globalThis !== 'undefined' && globalThis.JSZip) return Promise.resolve();
    if (_jszipLoad) return _jszipLoad;
    _jszipLoad = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${JSZIP_CDN_URL}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load JSZip: ${JSZIP_CDN_URL}`)), { once: true });
            return;
        }
        const tag = document.createElement('script');
        tag.src = JSZIP_CDN_URL;
        tag.onload = () => resolve();
        tag.onerror = () => reject(new Error(`Failed to load JSZip: ${JSZIP_CDN_URL}`));
        document.head.appendChild(tag);
    });
    return _jszipLoad;
}

/**
 * Build a .zip Blob from a flat entry list. Folder structure comes from the
 * `path` values (e.g. `images/pair-01.png`). Each entry carries either a
 * `blob` (binary) or a `text` (string) payload; entries with neither are
 * written as empty files.
 *
 * @param {Array<{ path: string, blob?: Blob, text?: string }>} entries
 * @param {{ JSZip?: Function }} [opts] - inject a JSZip constructor (default: load from CDN).
 * @returns {Promise<Blob>} the zip file
 */
export async function zipEntries(entries, opts = {}) {
    if (!Array.isArray(entries)) throw new Error('sg-zip: entries must be an array');
    let JSZip = opts.JSZip;
    if (!JSZip) {
        await loadJSZip();
        JSZip = globalThis.JSZip;
    }
    if (!JSZip) throw new Error('JSZip not available after load');
    const zip = new JSZip();
    for (const e of entries) {
        if (!e || !e.path) continue;
        if (e.blob) zip.file(e.path, e.blob);
        else zip.file(e.path, e.text ?? '');
    }
    return zip.generateAsync({ type: 'blob' });
}
