/**
 * sg-heic — shared HEIC decode helpers (browser, no build step).
 *
 * Pure ES module. Lazy-loads its decoder dependency from a pinned CDN; if the
 * primary library (`heic-to`) refuses to load, falls back to `libheif-js`. The
 * proven recipe was first piloted by the Phase 0 probe at
 * `tools/v0/v0.1/v0.1.58/en-gb/heic-decode/heic-probe.js` — this module is the
 * production extraction of that probe.
 *
 * Returns real DOM canvases / blobs so callers can downstream into
 * `core/image/sg-image.js` for resize / re-encode work.
 *
 * @module sg-heic
 * @version 0.1.0
 */

import * as sgImage from '../../../../image/v1/v1.0/v1.0.0/sg-image.js';

/** heic-to ESM bundle (primary). Named exports `heicTo`, `isHeic`. */
const HEIC_TO_CDN_URL = 'https://cdn.jsdelivr.net/npm/heic-to@1.4.2/dist/heic-to.min.js';
/** libheif-js ESM bundle (fallback). Inlines WASM as base64 — no separate fetch. */
const LIBHEIF_CDN_URL = 'https://cdn.jsdelivr.net/npm/libheif-js@1.18.2/libheif-wasm/libheif-bundle.mjs';

/** @type {{heicTo: Function, isHeic: Function}|null} module-level cache */
let _heicTo = null;
/** @type {object|null} module-level cache */
let _libheif = null;

/**
 * Best-effort detection of HEIC/HEIF input.
 *
 * Sniffs by file extension AND MIME type. We deliberately do NOT read the
 * `ftyp` box bytes: browsers sometimes deliver iPhone HEIC with an empty MIME
 * AND a `.JPG` extension (when a user has renamed it), and a byte sniff would
 * still need an async `slice().arrayBuffer()` call — at which point the
 * caller may as well try the decode path. Documented limitation: callers can
 * still pass a non-matching file to `decodeHeicToCanvas` and the decoder
 * itself will reject if it can't parse the bytes.
 *
 * @param {File|Blob} file
 * @returns {boolean}
 */
export function isHeic(file) {
    if (!file) return false;
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    if (/\.(heic|heif)$/i.test(name)) return true;
    if (type === 'image/heic' || type === 'image/heif') return true;
    return false;
}

/**
 * Lazy-load heic-to from the pinned CDN. Cached for the page lifetime.
 * @returns {Promise<{heicTo: Function, isHeic: Function}>}
 */
async function loadHeicTo() {
    if (_heicTo) return _heicTo;
    const mod = await import(/* webpackIgnore: true */ HEIC_TO_CDN_URL);
    if (typeof mod.heicTo !== 'function') {
        throw new Error('heic-to loaded but heicTo export is not a function');
    }
    _heicTo = { heicTo: mod.heicTo, isHeic: mod.isHeic };
    return _heicTo;
}

/**
 * Lazy-load libheif-js from the pinned CDN. Cached for the page lifetime.
 * @returns {Promise<object>}
 */
async function loadLibheif() {
    if (_libheif) return _libheif;
    const mod = await import(/* webpackIgnore: true */ LIBHEIF_CDN_URL);
    const factory = mod.default || mod.libheif || mod;
    const instance = typeof factory === 'function' ? factory() : factory;
    _libheif = instance;
    return _libheif;
}

/**
 * Decode a HEIC file to a canvas via heic-to (the primary path).
 *
 * heic-to renders to a JPEG/PNG blob; we then paint that blob onto a fresh
 * canvas via sg-image.getImageInfo. Quality is intentionally high (0.95) so
 * the canvas keeps headroom for any subsequent re-encode the caller wants.
 *
 * @param {File|Blob} file
 * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number, lib: string}>}
 */
async function decodeWithHeicTo(file) {
    const { heicTo } = await loadHeicTo();
    const outBlob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.95 });
    const info = await sgImage.getImageInfo(
        new File([outBlob], 'decoded.jpg', { type: 'image/jpeg' })
    );
    const canvas = document.createElement('canvas');
    canvas.width = info.width;
    canvas.height = info.height;
    canvas.getContext('2d').drawImage(info.image, 0, 0);
    return { canvas, width: info.width, height: info.height, lib: 'heic-to' };
}

/**
 * Decode a HEIC file to a canvas via libheif-js (fallback path).
 *
 * @param {File|Blob} file
 * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number, lib: string}>}
 */
async function decodeWithLibheif(file) {
    const libheif = await loadLibheif();
    const buf = new Uint8Array(await file.arrayBuffer());

    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(buf);
    if (!images || images.length === 0) {
        throw new Error('libheif: no images decoded from file');
    }

    const image = images[0];
    const width = image.get_width();
    const height = image.get_height();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);

    await new Promise((resolve, reject) => {
        image.display(imageData, (displayData) => {
            if (!displayData) {
                reject(new Error('libheif: display() returned null'));
                return;
            }
            ctx.putImageData(displayData, 0, 0);
            resolve();
        });
    });

    if (typeof image.free === 'function') image.free();

    return { canvas, width, height, lib: 'libheif-js' };
}

/**
 * Decode a HEIC file to a real `<canvas>` element.
 *
 * Tries heic-to first; on any error falls back to libheif-js. The returned
 * canvas is a fresh element — the caller owns it (resize / re-encode / append
 * to DOM as they wish). The `lib` field tells you which path actually
 * succeeded ("heic-to" or "libheif-js").
 *
 * @param {File|Blob} file
 * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number, lib: string}>}
 */
export async function decodeHeicToCanvas(file) {
    let firstErr = null;
    try {
        return await decodeWithHeicTo(file);
    } catch (err) {
        firstErr = err;
    }
    try {
        return await decodeWithLibheif(file);
    } catch (err) {
        const msg = `HEIC decode failed (heic-to: ${firstErr && firstErr.message}; libheif: ${err.message})`;
        throw Object.assign(new Error(msg), { code: 'heic-decode-failed' });
    }
}

/**
 * Decode a HEIC file and re-encode it as a web-safe image blob in one call.
 *
 * Convenience wrapper around `decodeHeicToCanvas` + `sg-image.exportImage`.
 * Format defaults to JPEG at quality 0.9; pass `format: 'image/webp'`,
 * `'image/png'`, or `'image/avif'` to switch encoders. PNG ignores quality.
 *
 * @param {File|Blob} file
 * @param {{format?: string, quality?: number}} [opts]
 * @returns {Promise<Blob>}
 */
export async function decodeHeicToBlob(file, opts = {}) {
    const format = opts.format || 'image/jpeg';
    const quality = typeof opts.quality === 'number' ? opts.quality : 0.9;
    const { canvas } = await decodeHeicToCanvas(file);
    return sgImage.exportImage(canvas, format, quality);
}
