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
import { isVideoFile, extractFirstFrame } from '/core/sg-video-frames/v0/v0.1/v0.1.0/sg-video-frames.js';
import { groupLivePhotos } from './live-photo.js';
import { HC_EVENTS } from './heic-converter-events.js';

const EXT_FOR_MIME = Object.freeze({
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/png':  'png',
    'image/avif': 'avif',
});

/** Swap a source filename's extension for the chosen output extension. */
function outputNameFor(srcName, mime) {
    const ext = EXT_FOR_MIME[mime] || 'bin';
    const base = (srcName || 'image').replace(/\.[^.]+$/, '') || 'image';
    return `${base}.${ext}`;
}

/**
 * Mirror a relative path but swap the file extension to the output format.
 * @param {string} relativePath
 * @param {string} mime
 * @returns {string}
 */
export function outputPathFor(relativePath, mime) {
    if (!relativePath) return '';
    const slash = relativePath.lastIndexOf('/');
    const dir = slash >= 0 ? relativePath.slice(0, slash + 1) : '';
    const leaf = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
    return `${dir}${outputNameFor(leaf, mime)}`;
}

/**
 * Build the convert methods bound to a given state + emit function.
 * @param {{state: object, emit: (name: string, detail?: object) => void}} ctx
 * @returns {{addFiles: Function, convertOne: Function, convertAll: Function, reset: Function, getItems: Function, setFormat: Function, setQuality: Function}}
 */
export function buildConvertMethods({ state, emit }) {
    /**
     * Add a list of files to the queue. Accepts HEIC/HEIF stills AND videos
     * (mp4/mov/m4v); anything else is returned in `skipped`.
     *
     * Each entry may carry a `relativePath` (from a folder drop/pick) so the
     * output ZIP can mirror the folder structure. A plain `File[]`/`FileList`
     * is also accepted (the legacy flat path), in which case
     * `file.webkitRelativePath` is honoured if present.
     *
     * @param {{files?: File[]|FileList, entries?: Array<{file: File, relativePath?: string}>}} params
     * @returns {Promise<{added: string[], skipped: Array<{name:string, reason:string}>}>}
     */
    async function addFiles(params = {}) {
        // Normalise into [{ file, relativePath }]. Support both the flat
        // `files` shape and the folder `entries` shape.
        const entries = Array.isArray(params.entries)
            ? params.entries
            : Array.from(params.files || []).map((f) => ({
                file: f,
                relativePath: (f && f.webkitRelativePath) || '',
            }));

        const added = [];
        const skipped = [];

        // Record the top-level folder name (first segment of any relative path).
        for (const e of entries) {
            const rp = e && e.relativePath;
            if (rp && rp.includes('/')) {
                state.setFolderName(rp.split('/')[0]);
                break;
            }
        }

        for (const e of entries) {
            const f = e && e.file;
            if (!f) continue;
            let kind = null;
            if (sgHeic.isHeic(f)) kind = 'heic';
            else if (isVideoFile(f)) kind = 'video';
            if (!kind) {
                skipped.push({ name: f.name || '(unnamed)', reason: 'not-supported' });
                continue;
            }
            const id = state.addFile(f, { kind, relativePath: e.relativePath || '' });
            if (id === null) {
                skipped.push({ name: f.name, reason: 'duplicate' });
            } else {
                added.push(id);
            }
        }

        applyLivePhotoDedup();
        emit(HC_EVENTS.ITEMS_ADDED, { addedIds: added, skipped });
        return { added, skipped };
    }

    /**
     * Re-evaluate Live Photo pairing over the whole queue. When dedup is ON,
     * mark the motion (video) half of every Live Photo pair as `skipped`
     * (reason `live-photo-duplicate`) — but never touch items already
     * converted. When dedup is OFF, un-skip any previously-deduped videos.
     */
    function applyLivePhotoDedup() {
        const all = state.getItems();
        const { pairedVideoNames } = groupLivePhotos(all);
        const dedup = state.getLivePhotoDedup();
        for (const it of all) {
            const isPairedVideo = it.kind === 'video' && pairedVideoNames.has(it.name);
            if (dedup && isPairedVideo && (it.status === 'queued' || it.status === 'error')) {
                state.updateItem(it.id, { status: 'skipped', skippedReason: 'live-photo-duplicate' });
                emit(HC_EVENTS.ITEM_SKIPPED, { id: it.id, reason: 'live-photo-duplicate' });
            } else if (!dedup && it.status === 'skipped' && it.skippedReason === 'live-photo-duplicate') {
                state.updateItem(it.id, { status: 'queued', skippedReason: undefined });
            }
        }
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
            let blob;
            let width = null;
            let height = null;
            let lib;

            if (item.kind === 'video') {
                // Videos: decode the first frame. HEVC .mov takes the slow
                // FFmpeg path inside extractFirstFrame; surface its load ratio.
                emit(HC_EVENTS.ITEM_PROGRESS, { id, stage: 'decode', pct: 0 });
                const onProgress = (p) => {
                    const pct = p && typeof p.ratio === 'number' ? Math.round(p.ratio * 100) : 0;
                    emit(HC_EVENTS.ITEM_PROGRESS, { id, stage: 'decode', pct });
                };
                // For video we encode straight to the chosen format inside the
                // module (it always re-encodes from pixels → metadata-free).
                blob = await extractFirstFrame(item.file, { at: 0, format, quality, onProgress });
                lib = 'video';
                // Best-effort dimensions from the resulting blob.
                try {
                    const bmp = await createImageBitmap(blob);
                    width = bmp.width; height = bmp.height;
                    if (typeof bmp.close === 'function') bmp.close();
                } catch (_) { /* dimensions optional */ }
            } else {
                emit(HC_EVENTS.ITEM_PROGRESS, { id, stage: 'decode', pct: 0 });
                const decoded = await sgHeic.decodeHeicToCanvas(item.file);
                width = decoded.width; height = decoded.height; lib = decoded.lib;
                emit(HC_EVENTS.ITEM_PROGRESS, { id, stage: 'encode', pct: 50 });
                // JPEG can't carry alpha — flatten first to avoid weird artefacts.
                const canvasToEncode = format === 'image/jpeg'
                    ? sgImage.flattenTransparency(decoded.canvas) : decoded.canvas;
                blob = await sgImage.exportImage(canvasToEncode, format, quality);
            }

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
        // Make sure dedup decisions are current before we batch.
        applyLivePhotoDedup();
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
            kind: it.kind || 'heic',
            relativePath: it.relativePath || null,
            sizeBytes: it.sizeBytes,
            status: it.status,
            skippedReason: it.skippedReason || null,
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

    /**
     * Toggle Live Photo dedup. When enabled (default), the motion clip of a
     * Live Photo pair (a video sharing a basename with a still) is skipped and
     * excluded from the ZIP. When disabled, those motion clips are also
     * frame-extracted. Standalone videos are always converted regardless.
     * @param {{enabled: boolean}} params
     * @returns {{enabled: boolean}}
     */
    function setLivePhotoDedup(params = {}) {
        const enabled = !!params.enabled;
        state.setLivePhotoDedup(enabled);
        applyLivePhotoDedup();
        emit(HC_EVENTS.LIVE_PHOTO_DEDUP, { enabled });
        return { enabled };
    }

    return {
        addFiles, convertOne, convertAll, reset, getItems,
        setFormat, setQuality, setLivePhotoDedup,
    };
}
