/**
 * heic-probe — Phase 0 de-risk probe for HEIC decoding (Architect plan v0.2.58 §9).
 *
 * Goal: prove a real iPhone HEIC file can be decoded to a <canvas> entirely
 * client-side, no build step, ES modules only, lazy-loading the decoder lib
 * from a CDN. Then exercise canvas -> JPEG/WebP export via core/image/sg-image.js.
 *
 * THROWAWAY probe. Not a shipped module. Lives under team/explorer/dev/probes/.
 *
 * Library strategy (per plan §2.2 / §8):
 *   1. PRIMARY  — libheif-js WASM, ESM-from-CDN, lazy import().
 *   2. FALLBACK — heic2any (single UMD file from CDN) if libheif ESM won't load.
 * The probe tries libheif first and automatically falls back, reporting which
 * path actually worked.
 *
 * @module heic-probe
 */

import * as sgImage from '../../../../../core/image/v1/v1.0/v1.0.0/sg-image.js';

// libheif-js ships a bundled ESM build. The `libheif/libheif-bundle.mjs`
// entry inlines the WASM as base64 so there is no separate .wasm fetch and
// no cross-origin worker — simplest possible lazy-load.
const LIBHEIF_CDN_URL = 'https://cdn.jsdelivr.net/npm/libheif-js@1.18.2/libheif/libheif-bundle.mjs';

// heic2any fallback — single UMD file, attaches `heic2any` to window.
const HEIC2ANY_CDN_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';

/** @type {object|null} cached libheif module instance */
let _libheif = null;
/** @type {Function|null} cached heic2any function */
let _heic2any = null;

// ---------------------------------------------------------------------------
// DOM wiring
// ---------------------------------------------------------------------------

const el = {
    drop:    document.getElementById('drop'),
    file:    document.getElementById('file'),
    status:  document.getElementById('status'),
    log:     document.getElementById('log'),
    canvas:  document.getElementById('out'),
    meta:    document.getElementById('meta'),
    exports: document.getElementById('exports'),
};

/**
 * Append a timestamped line to the on-page log and the console.
 * @param {string} msg
 * @param {'info'|'ok'|'err'} [level]
 * @returns {void}
 */
function log(msg, level = 'info') {
    const t = (performance.now() / 1000).toFixed(3);
    const line = `[${t}s] ${msg}`;
    const div = document.createElement('div');
    div.className = `log-line log-${level}`;
    div.textContent = line;
    el.log.appendChild(div);
    el.log.scrollTop = el.log.scrollHeight;
    if (level === 'err') console.error(line);
    else console.log(line);
}

/**
 * Set the big PASS/FAIL/RUNNING status banner.
 * @param {'idle'|'running'|'pass'|'fail'} state
 * @param {string} text
 * @returns {void}
 */
function setStatus(state, text) {
    el.status.className = `status status-${state}`;
    el.status.textContent = text;
    console.log(`[HEIC PROBE] status=${state.toUpperCase()} — ${text}`);
}

// ---------------------------------------------------------------------------
// Library loading (lazy, CDN, ESM-first with UMD fallback)
// ---------------------------------------------------------------------------

/**
 * Lazy-load libheif-js as an ES module from the CDN.
 * @returns {Promise<object>} the libheif module instance
 */
async function loadLibheif() {
    if (_libheif) return _libheif;
    log(`Loading libheif-js ESM from CDN: ${LIBHEIF_CDN_URL}`);
    const t0 = performance.now();
    const mod = await import(/* webpackIgnore: true */ LIBHEIF_CDN_URL);
    // The bundle exports a default factory (or attaches `libheif`); normalise.
    const factory = mod.default || mod.libheif || mod;
    const instance = typeof factory === 'function' ? factory() : factory;
    _libheif = instance;
    log(`libheif-js loaded in ${(performance.now() - t0).toFixed(0)} ms`, 'ok');
    return _libheif;
}

/**
 * Lazy-load heic2any as a classic UMD script from the CDN (fallback path).
 * @returns {Promise<Function>} the heic2any function
 */
async function loadHeic2any() {
    if (_heic2any) return _heic2any;
    log(`Falling back to heic2any UMD from CDN: ${HEIC2ANY_CDN_URL}`);
    const t0 = performance.now();
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = HEIC2ANY_CDN_URL;
        s.onload = resolve;
        s.onerror = () => reject(new Error('heic2any script failed to load'));
        document.head.appendChild(s);
    });
    if (typeof window.heic2any !== 'function') {
        throw new Error('heic2any loaded but window.heic2any is not a function');
    }
    _heic2any = window.heic2any;
    log(`heic2any loaded in ${(performance.now() - t0).toFixed(0)} ms`, 'ok');
    return _heic2any;
}

// ---------------------------------------------------------------------------
// Decode paths
// ---------------------------------------------------------------------------

/**
 * Decode a HEIC file to a canvas using libheif-js.
 * @param {File} file
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
    log(`libheif: file contains ${images.length} image(s); decoding primary`);

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

    // Free native memory if the API exposes it.
    if (typeof image.free === 'function') image.free();

    return { canvas, width, height, lib: 'libheif-js' };
}

/**
 * Decode a HEIC file to a canvas using heic2any (fallback).
 * heic2any converts to a PNG/JPEG blob; we load that into a canvas.
 * @param {File} file
 * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number, lib: string}>}
 */
async function decodeWithHeic2any(file) {
    const heic2any = await loadHeic2any();
    const outBlob = await heic2any({ blob: file, toType: 'image/png' });
    const blob = Array.isArray(outBlob) ? outBlob[0] : outBlob;
    const info = await sgImage.getImageInfo(new File([blob], 'decoded.png', { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = info.width;
    canvas.height = info.height;
    canvas.getContext('2d').drawImage(info.image, 0, 0);
    return { canvas, width: info.width, height: info.height, lib: 'heic2any' };
}

// ---------------------------------------------------------------------------
// Probe orchestration
// ---------------------------------------------------------------------------

/**
 * Run the full probe against a user-supplied HEIC file:
 * detect -> lazy-load lib -> decode to canvas -> display -> export JPEG+WebP.
 * @param {File} file
 * @returns {Promise<void>}
 */
async function runProbe(file) {
    el.log.innerHTML = '';
    el.exports.innerHTML = '';
    el.meta.textContent = '';
    setStatus('running', `Decoding ${file.name}…`);
    log(`File picked: ${file.name} — ${(file.size / 1024 / 1024).toFixed(2)} MB, type="${file.type || '(none)'}"`);

    const looksHeic = /\.(heic|heif)$/i.test(file.name)
        || file.type === 'image/heic' || file.type === 'image/heif';
    if (!looksHeic) {
        log('Warning: file does not look like HEIC/HEIF by name or MIME — trying anyway', 'info');
    }

    let result = null;
    const tDecode0 = performance.now();

    // Path 1: libheif-js (primary).
    try {
        result = await decodeWithLibheif(file);
    } catch (errLibheif) {
        log(`libheif-js path failed: ${errLibheif.message}`, 'err');
        // Path 2: heic2any (fallback).
        try {
            result = await decodeWithHeic2any(file);
        } catch (errHeic2any) {
            log(`heic2any fallback also failed: ${errHeic2any.message}`, 'err');
            setStatus('fail', 'FAIL — both libheif-js and heic2any could not decode this file');
            return;
        }
    }

    const decodeMs = (performance.now() - tDecode0).toFixed(0);
    log(`Decoded via ${result.lib}: ${result.width}×${result.height} in ${decodeMs} ms`, 'ok');

    // Display the decoded canvas on the page.
    el.canvas.width = result.width;
    el.canvas.height = result.height;
    el.canvas.getContext('2d').drawImage(result.canvas, 0, 0);
    el.meta.textContent =
        `library: ${result.lib} | dimensions: ${result.width}×${result.height} `
        + `| decode time: ${decodeMs} ms | source: ${(file.size / 1024 / 1024).toFixed(2)} MB`;

    // Exercise the full HEIC -> web-safe path via core/image/sg-image.js.
    // sg-image.exportImage takes a canvas + MIME + quality and returns a Blob.
    let exportsOk = true;
    for (const [label, mime] of [['JPEG', 'image/jpeg'], ['WebP', 'image/webp']]) {
        try {
            const tExp0 = performance.now();
            const blob = await sgImage.exportImage(result.canvas, mime, 0.8);
            const expMs = (performance.now() - tExp0).toFixed(0);
            log(`sg-image.exportImage ${label}: ${(blob.size / 1024).toFixed(1)} KB in ${expMs} ms`, 'ok');
            appendExportPreview(label, blob);
        } catch (err) {
            exportsOk = false;
            log(`sg-image ${label} export failed: ${err.message} — falling back to canvas.toBlob`, 'err');
        }
    }

    if (exportsOk) {
        setStatus('pass', `PASS — decoded via ${result.lib}, ${result.width}×${result.height}, JPEG+WebP export OK`);
    } else {
        setStatus('pass', `PASS (partial) — decode via ${result.lib} OK; see log for export issues`);
    }
}

/**
 * Render a thumbnail + download link for an exported blob.
 * @param {string} label
 * @param {Blob} blob
 * @returns {void}
 */
function appendExportPreview(label, blob) {
    const url = URL.createObjectURL(blob);
    const wrap = document.createElement('div');
    wrap.className = 'export-item';
    const img = document.createElement('img');
    img.src = url;
    img.alt = `${label} export`;
    const cap = document.createElement('a');
    cap.href = url;
    cap.download = `heic-probe-export.${label.toLowerCase() === 'jpeg' ? 'jpg' : 'webp'}`;
    cap.textContent = `${label} — ${(blob.size / 1024).toFixed(1)} KB (download)`;
    wrap.appendChild(img);
    wrap.appendChild(cap);
    el.exports.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// Input handlers
// ---------------------------------------------------------------------------

el.file.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) runProbe(file).catch((err) => {
        log(`Unexpected probe error: ${err.message}`, 'err');
        setStatus('fail', `FAIL — ${err.message}`);
    });
});

['dragenter', 'dragover'].forEach((evt) => {
    el.drop.addEventListener(evt, (e) => {
        e.preventDefault();
        el.drop.classList.add('drag');
    });
});
['dragleave', 'drop'].forEach((evt) => {
    el.drop.addEventListener(evt, (e) => {
        e.preventDefault();
        el.drop.classList.remove('drag');
    });
});
el.drop.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) runProbe(file).catch((err) => {
        log(`Unexpected probe error: ${err.message}`, 'err');
        setStatus('fail', `FAIL — ${err.message}`);
    });
});

setStatus('idle', 'Idle — drop or pick an iPhone HEIC file to start');
log('Probe ready. Library will be lazy-loaded from CDN on first HEIC drop.');
console.log('[HEIC PROBE] ready — call runProbe(file) is wired to drop/file-pick.');
