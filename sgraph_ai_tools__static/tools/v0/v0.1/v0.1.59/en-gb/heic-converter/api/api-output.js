/**
 * api-output — downloadOne / downloadAllZip implementations.
 *
 * Triggers browser downloads from in-memory blobs. ZIP packaging lazy-loads
 * JSZip from the CDN (same pattern as components/video-splitter).
 *
 * @module heic-converter/api-output
 */

const JSZIP_CDN_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

/** @type {Promise<void>|null} cached pending load */
let _jszipLoad = null;

/**
 * Lazy-load JSZip via classic <script> tag injection. The library publishes
 * itself as `globalThis.JSZip`. Reuses an existing tag if one is already in
 * the DOM.
 * @returns {Promise<void>}
 */
function loadJSZip() {
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
 * Trigger a browser download of `blob` as `filename`.
 * @param {Blob} blob
 * @param {string} filename
 * @returns {void}
 */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Defer revoke so the browser has time to dispatch the download.
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ } }, 2000);
}

/**
 * Build the output methods bound to a given state container.
 * @param {{state: object}} ctx
 * @returns {{downloadOne: Function, downloadAllZip: Function}}
 */
export function buildOutputMethods({ state }) {
    /**
     * Trigger a browser download of a single completed item.
     * @param {{id: string}} params
     * @returns {Promise<{ok: true, name: string, size: number}>}
     */
    async function downloadOne(params = {}) {
        const item = state.getItem(params && params.id);
        if (!item) throw Object.assign(new Error(`Unknown item id: ${params && params.id}`), { code: 'unknown-item' });
        if (!item.outputBlob) throw Object.assign(new Error(`Item ${item.id} not converted yet`), { code: 'not-ready' });
        downloadBlob(item.outputBlob, item.outputName || `${item.id}.bin`);
        return { ok: true, name: item.outputName, size: item.outputSize };
    }

    /**
     * Pack every completed item into a single ZIP and trigger a download.
     * Items still queued or in error are silently skipped.
     * @returns {Promise<{ok: true, count: number, zipSize: number}>}
     */
    async function downloadAllZip() {
        const completed = state.getItems().filter((it) => it.outputBlob && it.status === 'done');
        if (completed.length === 0) {
            throw Object.assign(new Error('No converted items to zip'), { code: 'empty' });
        }
        await loadJSZip();
        const JSZip = globalThis.JSZip;
        if (!JSZip) throw new Error('JSZip not available after load');
        const zip = new JSZip();
        // Disambiguate any duplicate output names by appending the item id.
        const namesSeen = new Map();
        for (const it of completed) {
            let name = it.outputName || `${it.id}.bin`;
            if (namesSeen.has(name)) {
                const i = namesSeen.get(name) + 1;
                namesSeen.set(name, i);
                const dot = name.lastIndexOf('.');
                name = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`;
            } else {
                namesSeen.set(name, 1);
            }
            zip.file(name, it.outputBlob);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(blob, `heic-converter-${new Date().toISOString().slice(0, 10)}.zip`);
        return { ok: true, count: completed.length, zipSize: blob.size };
    }

    return { downloadOne, downloadAllZip };
}
