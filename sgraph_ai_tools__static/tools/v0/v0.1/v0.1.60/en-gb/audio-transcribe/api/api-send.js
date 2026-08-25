/**
 * api-send — downloadZip + sendViaSgSend.
 *
 * Both build the session bundle via audio-zip. `downloadZip` triggers a browser
 * download; `sendViaSgSend` hands the zip blob to the embedded <sg-send-drop>
 * component and resolves on its `sg-send-complete` event with the share URL.
 *
 * The bundler, the download trigger, and the sg-send dropper are injectable so
 * this is testable without a DOM, JSZip CDN, or a live send.sgraph.ai.
 *
 * @module audio-transcribe/api-send
 */

import { buildZip } from './audio-zip.js';
import { AT_EVENTS } from './audio-transcribe-events.js';

/**
 * Trigger a browser download of `blob` as `filename`.
 * @param {Blob} blob @param {string} filename @returns {void}
 */
function defaultDownloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ } }, 2000);
}

/** Default zip base name. */
function defaultZipName() {
    return `audio-transcribe-${new Date().toISOString().slice(0, 10)}.zip`;
}

/**
 * Resolve which `done` items to bundle (optionally a subset by id).
 * @param {object} state @param {string[]} [ids] @returns {object[]} raw items.
 */
function selectItems(state, ids) {
    let raw = state.getRawItems().filter((it) => it.status === 'done');
    if (Array.isArray(ids) && ids.length) {
        const set = new Set(ids);
        raw = raw.filter((it) => set.has(it.id));
    }
    return raw;
}

/**
 * Build the bundle + send methods.
 *
 * @param {object} ctx
 * @param {object} ctx.state
 * @param {(name: string, detail?: object) => void} ctx.emit
 * @param {(items: object[], include: object) => Promise<{ blob: Blob, count: number }>} [ctx.buildZipFn]
 * @param {(blob: Blob, name: string) => void} [ctx.downloadBlob]
 * @param {() => object|null} [ctx.getDropper] - returns the <sg-send-drop> element.
 * @returns {{ downloadZip: Function, sendViaSgSend: Function }}
 */
export function buildSendMethods({ state, emit, buildZipFn, downloadBlob, getDropper }) {
    const zipFn = buildZipFn || ((items, include) => buildZip(items, include));
    const download = downloadBlob || defaultDownloadBlob;

    /**
     * Build a .zip from the session (or a subset) and trigger a download.
     * @param {{ include?: { audio?: boolean, transcripts?: boolean }, items?: string[], name?: string }} [params]
     * @returns {Promise<{ ok: true, count: number, zipSize: number, name: string }>}
     */
    async function downloadZip(params = {}) {
        const include = params.include || { audio: false, transcripts: true };
        const items = selectItems(state, params.items);
        if (items.length === 0) {
            throw Object.assign(new Error('No transcribed items to bundle'), { code: 'empty' });
        }
        const { blob, count } = await zipFn(items, include);
        const name = params.name || defaultZipName();
        download(blob, name);
        emit(AT_EVENTS.BUNDLE_CREATED, { count, zipSize: blob.size, name });
        return { ok: true, count, zipSize: blob.size, name };
    }

    /**
     * Build the same bundle and send it via the embedded <sg-send-drop>.
     * Resolves on `sg-send-complete` with the share URL.
     * @param {{ include?: object, items?: string[], accessToken?: string, name?: string }} [params]
     * @returns {Promise<{ shareUrl: string, token: string }>}
     */
    async function sendViaSgSend(params = {}) {
        const dropper = getDropper && getDropper();
        if (!dropper) throw Object.assign(new Error('Send component not available'), { code: 'no-send-component' });

        const include = params.include || { audio: false, transcripts: true };
        const items = selectItems(state, params.items);
        if (items.length === 0) {
            throw Object.assign(new Error('No transcribed items to send'), { code: 'empty' });
        }

        emit(AT_EVENTS.SEND_STARTED, {});
        if (params.accessToken && typeof dropper.setAccessToken === 'function') {
            dropper.setAccessToken(params.accessToken);
        }

        const { blob } = await zipFn(items, include);
        const name = params.name || defaultZipName();

        return new Promise((resolve, reject) => {
            const onComplete = (e) => {
                cleanup();
                const detail = e.detail || {};
                emit(AT_EVENTS.SEND_COMPLETE, { shareUrl: detail.url, token: detail.token });
                resolve({ shareUrl: detail.url, token: detail.token });
            };
            const onError = (e) => {
                cleanup();
                const msg = (e.detail && e.detail.error) || 'send failed';
                emit(AT_EVENTS.SEND_ERROR, { error: msg });
                reject(Object.assign(new Error(msg), { code: 'send-error' }));
            };
            const onAuth = () => {
                cleanup();
                const err = Object.assign(new Error('SG/Send access token required'), { code: 'send-auth-required' });
                emit(AT_EVENTS.SEND_ERROR, { error: err.message });
                reject(err);
            };
            function cleanup() {
                dropper.removeEventListener('sg-send-complete', onComplete);
                dropper.removeEventListener('sg-send-error', onError);
                dropper.removeEventListener('sg-send-auth-required', onAuth);
            }
            dropper.addEventListener('sg-send-complete', onComplete);
            dropper.addEventListener('sg-send-error', onError);
            dropper.addEventListener('sg-send-auth-required', onAuth);
            dropper.offerFile(blob, name);
        });
    }

    return { downloadZip, sendViaSgSend };
}
