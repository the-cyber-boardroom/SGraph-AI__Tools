/**
 * api-convert — addFiles / convertOne / convertAll implementations.
 *
 * Pure-ish — depends on the state container, sg-heic for decode, and sg-image
 * for re-encode. Emits events via the passed `emit` helper (an SgToolApi._emit
 * bound to the api instance). The api layer (`heic-converter-api.js`) wires
 * these together and registers them.
 *
 * @module heic-converter/api-convert
 */

import * as sgHeic from '/core/sg-heic/v0/v0.1/v0.1.0/sg-heic.js';
import * as sgImage from '/core/image/v1/v1.0/v1.0.0/sg-image.js';
import { HC_EVENTS } from './heic-converter-events.js';

const EXT_FOR_MIME = Object.freeze({
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/png':  'png',
    'image/avif': 'avif',
});

function outputNameFor(srcName, mime) {
    const ext = EXT_FOR_MIME[mime] || 'bin';
    const base = (srcName || 'image').replace(/\.(heic|heif)$/i, '').replace(/\.[^.]+$/, '') || 'image';
    return `${base}.${ext}`;
}

/**
 * Build the convert methods bound to a given state + emit function.
 * @param {{state: object, emit: (name: string, detail?: object) => void}} ctx
 * @returns {{addFiles: Function, convertOne: Function, convertAll: Function, reset: Function, getItems: Function, setFormat: Function, setQuality: Function}}
 */
export function buildConvertMethods({ state, emit }) {
    /**
     * Add a list of files to the queue. Only HEIC files are accepted; the
     * rest are returned as `skipped` so the UI can show a warning.
     * @param {{files: File[]|FileList}} params
     * @returns {Promise<{added: string[], skipped: Array<{name:string, reason:string}>}>}
     */
    async function addFiles(params = {}) {
        const list = Array.from(params.files || []);
        const added = [];
        const skipped = [];
        for (const f of list) {
            if (!sgHeic.isHeic(f)) {
                skipped.push({ name: f.name || '(unnamed)', reason: 'not-heic' });
                continue;
            }
            const id = state.addFile(f);
            if (id === null) {
                skipped.push({ name: f.name, reason: 'duplicate' });
            } else {
                added.push(id);
            }
        }
        emit(HC_EVENTS.ITEMS_ADDED, { addedIds: added, skipped });
        return { added, skipped };
    }

    /**
     * Convert one queued item to the currently-selected output format/quality.
     * @param {{id: string}} params
     * @returns {Promise<{id: string, outputType: string, outputSize: number}>}
     */
    async function convertOne(params = {}) {
        const id = params && params.id;
        const item = state.getItem(id);
        if (!item) {
            throw Object.assign(new Error(`Unknown item id: ${id}`), { code: 'unknown-item' });
        }
        if (item.status === 'running') {
            throw Object.assign(new Error(`Item ${id} is already running`), { code: 'busy' });
        }

        const format = state.getFormat();
        const quality = state.getQuality();

        state.updateItem(id, { status: 'running', error: undefined });
        emit(HC_EVENTS.ITEM_STARTED, { id });

        try {
            emit(HC_EVENTS.ITEM_PROGRESS, { id, stage: 'decode', pct: 0 });
            const { canvas, width, height, lib } = await sgHeic.decodeHeicToCanvas(item.file);

            emit(HC_EVENTS.ITEM_PROGRESS, { id, stage: 'encode', pct: 50 });
            // JPEG can't carry alpha — flatten first to avoid weird artefacts.
            const canvasToEncode = format === 'image/jpeg' ? sgImage.flattenTransparency(canvas) : canvas;
            const blob = await sgImage.exportImage(canvasToEncode, format, quality);

            const outputName = outputNameFor(item.name, format);
            const thumbnailUrl = URL.createObjectURL(blob);

            state.updateItem(id, {
                status: 'done',
                outputBlob: blob,
                outputType: format,
                outputName,
                outputSize: blob.size,
                width,
                height,
                decodeLib: lib,
                thumbnailUrl,
            });
            emit(HC_EVENTS.ITEM_PROGRESS, { id, stage: 'done', pct: 100 });
            emit(HC_EVENTS.ITEM_COMPLETE, { id, outputSize: blob.size, outputType: format });
            return { id, outputType: format, outputSize: blob.size };
        } catch (err) {
            const message = (err && err.message) || String(err);
            state.updateItem(id, { status: 'error', error: message });
            emit(HC_EVENTS.ITEM_ERROR, { id, error: message });
            throw err;
        }
    }

    /**
     * Convert every queued item sequentially. Errors on individual items are
     * captured but do not abort the batch.
     * @returns {Promise<{ok: number, failed: number}>}
     */
    async function convertAll() {
        const queue = state.getItems().filter((it) => it.status === 'queued' || it.status === 'error');
        emit(HC_EVENTS.BATCH_STARTED, { count: queue.length });
        let ok = 0;
        let failed = 0;
        for (const it of queue) {
            try {
                await convertOne({ id: it.id });
                ok += 1;
            } catch (_) {
                failed += 1;
            }
        }
        emit(HC_EVENTS.BATCH_COMPLETE, { ok, failed });
        return { ok, failed };
    }

    /** Reset the queue (revoke all blob URLs, clear items). */
    function reset() {
        state.reset();
        emit(HC_EVENTS.RESET, {});
        return { ok: true };
    }

    /** Return a serialisable item list (no Files / Blobs). */
    function getItems() {
        return state.getItems().map((it) => ({
            id: it.id,
            name: it.name,
            sizeBytes: it.sizeBytes,
            status: it.status,
            error: it.error || null,
            outputType: it.outputType || null,
            outputSize: it.outputSize || null,
            outputName: it.outputName || null,
            width: it.width || null,
            height: it.height || null,
            decodeLib: it.decodeLib || null,
        }));
    }

    function setFormat(params = {}) {
        const f = params.format;
        const allowed = ['image/webp', 'image/jpeg', 'image/png', 'image/avif'];
        if (!allowed.includes(f)) {
            throw Object.assign(new Error(`format must be one of ${allowed.join(', ')}`), { code: 'invalid-arg' });
        }
        state.setFormat(f);
        emit(HC_EVENTS.FORMAT_CHANGED, { format: f });
        return { format: f };
    }

    function setQuality(params = {}) {
        const q = Number(params.quality);
        if (!Number.isFinite(q) || q < 0 || q > 1) {
            throw Object.assign(new Error('quality must be a number in [0, 1]'), { code: 'invalid-arg' });
        }
        state.setQuality(q);
        emit(HC_EVENTS.QUALITY_CHANGED, { quality: q });
        return { quality: q };
    }

    return { addFiles, convertOne, convertAll, reset, getItems, setFormat, setQuality };
}
