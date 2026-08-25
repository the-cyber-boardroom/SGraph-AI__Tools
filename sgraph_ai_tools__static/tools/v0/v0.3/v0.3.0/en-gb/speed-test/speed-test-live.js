/**
 * speed-test-live.js — Server-mode adapter using ChunkedUploader / ChunkedDownloader.
 *
 * Measures real network throughput against a live SG/Send API endpoint.
 *
 * Upload test:
 *   Encrypts a random payload using sg-send-crypto, then uploads it via
 *   ChunkedUploader (real presigned multipart). Speed is measured by the
 *   uploader's rolling-window tracker.
 *
 * Download test:
 *   Downloads a resource from a user-supplied URL via ChunkedDownloader
 *   using HTTP Range requests. Accepts any CORS-accessible URL.
 *   After a live upload, the caller should pass the returned downloadUrl.
 *
 * Named exports only. No default export.
 *
 * @module speed-test-live
 * @version 0.1.39
 */

import {
    generateToken,
    deriveTransferId,
    deriveKey,
    buildSgmetaEnvelope,
    encrypt,
} from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-crypto.js';

import {
    ChunkedUploader,
    formatSpeed,
    formatEta,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_MAX_CONCURRENT,
} from '/core/sg-send-upload/v1/v1.1/v1.1.0/sg-send-upload.js';

import {
    ChunkedDownloader,
    decryptWithProgress,
} from '/core/sg-send-download/v1/v1.0/v1.0.0/sg-send-download.js';

import { randomBytes } from './speed-test-sim.js';

export { formatSpeed, formatEta };

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} LiveUploadResult
 * @property {'upload'}  type
 * @property {number}    bps
 * @property {number}    mbps
 * @property {string}    label
 * @property {number}    bytesTotal
 * @property {number}    durationMs
 * @property {string}    transferId
 * @property {string}    token
 * @property {string}    downloadUrl   - URL suitable for passing to runLiveDownload().
 * @property {boolean}   aborted
 */

/**
 * @typedef {Object} LiveDownloadResult
 * @property {'download'} type
 * @property {number}     bps
 * @property {number}     mbps
 * @property {string}     label
 * @property {number}     bytesTotal
 * @property {number}     durationMs
 * @property {boolean}    aborted
 */

// ── Probe size helper ─────────────────────────────────────────────────────────

/**
 * Create a plaintext probe payload and encrypt it into an SGMETA envelope.
 *
 * @param {number} sizeBytes - Desired plaintext size.
 * @returns {Promise<{ token, transferId, ciphertext: Uint8Array }>}
 */
async function buildProbePayload(sizeBytes) {
    const token    = generateToken();
    const filename = `speed-test-${Date.now()}.bin`;

    const [transferId, key] = await Promise.all([
        deriveTransferId(token),
        deriveKey(token),
    ]);

    const rawBytes = randomBytes(sizeBytes);
    const envelope = buildSgmetaEnvelope(rawBytes, filename);
    const ciphertext = await encrypt(envelope, key);

    return { token, transferId, ciphertext: new Uint8Array(ciphertext) };
}

// ── Live upload ───────────────────────────────────────────────────────────────

/**
 * Upload a random test payload to a live SG/Send endpoint and measure speed.
 *
 * @param {object}   opts
 * @param {string}   opts.sendUrl         - Base URL (no trailing slash).
 * @param {string}   opts.accessToken     - x-sgraph-access-token value.
 * @param {number}   [opts.sizeBytes]     - Plaintext probe size (default 2 MB).
 * @param {number}   [opts.chunkSize]     - Override default chunk size.
 * @param {number}   [opts.maxConcurrent] - Parallel threads.
 * @param {Function} [opts.onProgress]    - `(UploadProgress) => void`
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<LiveUploadResult>}
 */
export async function runLiveUpload(opts = {}) {
    const {
        sendUrl,
        accessToken,
        sizeBytes    = 2 * 1024 * 1024,
        chunkSize    = DEFAULT_CHUNK_SIZE,
        maxConcurrent = DEFAULT_MAX_CONCURRENT,
        onProgress,
        signal,
    } = opts;

    if (!sendUrl)     throw new Error('sendUrl is required for live upload test');
    if (!accessToken) throw new Error('accessToken is required for live upload test');

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // 1. Build encrypted probe payload
    if (typeof onProgress === 'function') {
        onProgress({ percent: 5, stage: 'preparing', chunksTotal: 0, chunksDone: 0,
            bytesTotal: 0, bytesUploaded: 0, bytesPerSecond: 0, etaSecs: Infinity, threadCount: 0 });
    }

    const { token, transferId, ciphertext } = await buildProbePayload(sizeBytes);

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // 2. Upload using ChunkedUploader
    const t0 = Date.now();

    const uploader = new ChunkedUploader(ciphertext, {
        transferId,
        sendUrl,
        accessToken,
        chunkSize,
        maxConcurrent,
        onProgress,
    });

    // Wire abort signal to uploader cancel
    const abortHandler = () => uploader.cancel();
    signal?.addEventListener('abort', abortHandler);

    try {
        await uploader.start();
    } finally {
        signal?.removeEventListener('abort', abortHandler);
    }

    if (signal?.aborted) {
        return { type: 'upload', bps: 0, mbps: 0, label: '—', bytesTotal: sizeBytes,
            durationMs: Date.now() - t0, transferId, token, downloadUrl: '', aborted: true };
    }

    const durationMs = Date.now() - t0;
    // Total bytes = ciphertext size (what actually crossed the wire)
    const totalBytes = ciphertext.byteLength;
    const bps = durationMs > 0 ? (totalBytes / durationMs) * 1_000 : 0;

    // Construct the share / download URL (the viewer URL for the transfer)
    const downloadUrl = `${sendUrl}/${transferId}`;

    return {
        type:        'upload',
        bps,
        mbps:        (bps * 8) / 1_000_000,
        label:       formatSpeed(bps),
        bytesTotal:  totalBytes,
        durationMs,
        transferId,
        token,
        downloadUrl,
        aborted:     false,
    };
}

// ── Live download ─────────────────────────────────────────────────────────────

/**
 * Download a resource from `url` using ChunkedDownloader and measure speed.
 *
 * The URL should be a direct binary URL (not an HTML viewer page).
 * After a `runLiveUpload()`, pass the URL of the actual encrypted object,
 * or pass any CORS-accessible binary URL for a generic download benchmark.
 *
 * @param {string}   url
 * @param {object}   [opts]
 * @param {number}   [opts.chunkSize]
 * @param {number}   [opts.maxConcurrent]
 * @param {Function} [opts.onProgress]    - `(DownloadProgress) => void`
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<LiveDownloadResult>}
 */
export async function runLiveDownload(url, opts = {}) {
    const { chunkSize, maxConcurrent, onProgress, signal } = opts;

    if (!url) throw new Error('url is required for live download test');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const t0 = Date.now();

    const dl = new ChunkedDownloader(url, {
        chunkSize,
        maxConcurrent,
        onProgress,
    });

    const abortHandler = () => dl.cancel();
    signal?.addEventListener('abort', abortHandler);

    try {
        await dl.probe();
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        await dl.start();
    } finally {
        signal?.removeEventListener('abort', abortHandler);
    }

    if (signal?.aborted) {
        return { type: 'download', bps: 0, mbps: 0, label: '—', bytesTotal: 0,
            durationMs: Date.now() - t0, aborted: true };
    }

    const durationMs = Date.now() - t0;
    const totalBytes = dl._totalBytes;
    const bps = durationMs > 0 ? (totalBytes / durationMs) * 1_000 : 0;

    return {
        type:       'download',
        bps,
        mbps:       (bps * 8) / 1_000_000,
        label:      formatSpeed(bps),
        bytesTotal: totalBytes,
        durationMs,
        aborted:    false,
    };
}
