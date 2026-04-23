/**
 * speed-test-sim.js — Local / offline crypto benchmark adapter.
 *
 * Measures client-side throughput without requiring a live server:
 *   - Encryption throughput (AES-256-GCM via sg-crypto)
 *   - Decryption throughput (AES-256-GCM via sg-crypto)
 *
 * This establishes the upper bound for upload/download speed — no transfer
 * can be faster than the client can encrypt or decrypt the data.
 *
 * Named exports only. No default export.
 *
 * @module speed-test-sim
 * @version 0.1.39
 */

import {
    generateKey,
    encryptFile,
    decryptFile,
} from '/core/crypto/v1/v1.0/v1.0.0/sg-crypto.js';

import { formatSpeed, formatEta } from '/core/sg-send-upload/v1/v1.1/v1.1.0/sg-send-upload.js';

export { formatSpeed, formatEta };

// ── Random payload helper (fixes crypto.getRandomValues 65536-byte limit) ─────

/**
 * Create a random Uint8Array of `size` bytes.
 * The Web Crypto spec limits `getRandomValues()` to 65,536 bytes per call;
 * this helper fills the buffer in chunks.
 *
 * @param {number} size - Bytes to generate.
 * @returns {Uint8Array}
 */
export function randomBytes(size) {
    const buf = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += 65_536) {
        crypto.getRandomValues(buf.subarray(offset, offset + Math.min(65_536, size - offset)));
    }
    return buf;
}

// ── Crypto benchmark ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} SimResult
 * @property {'sim'}    type
 * @property {number}   encryptBps       - Encryption bytes/second.
 * @property {number}   decryptBps       - Decryption bytes/second.
 * @property {string}   encryptLabel     - formatSpeed(encryptBps)
 * @property {string}   decryptLabel     - formatSpeed(decryptBps)
 * @property {number}   encryptMs        - Elapsed milliseconds for encryption.
 * @property {number}   decryptMs        - Elapsed milliseconds for decryption.
 * @property {number}   sizeBytes        - Payload size measured.
 * @property {boolean}  aborted
 */

/**
 * Run a crypto benchmark: generate a random payload, encrypt it, then decrypt.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.sizeBytes=8388608]  - Payload size (default 8 MB).
 * @param {Function} [opts.onProgress]         - `({ stage, percent }) => void`
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<SimResult>}
 */
export async function runSimBenchmark(opts = {}) {
    const { sizeBytes = 8 * 1024 * 1024, onProgress, signal } = opts;

    function notify(stage, percent) {
        if (typeof onProgress === 'function') onProgress({ stage, percent });
    }

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    notify('generating', 5);
    const plaintext = randomBytes(sizeBytes);

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    notify('keygen', 10);
    const key = await generateKey();

    // ── Encryption ──────────────────────────────────────────────────────────
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    notify('encrypting', 15);

    const encT0 = performance.now();
    const ciphertext = await encryptFile(key, plaintext);
    const encMs  = performance.now() - encT0;
    const encBps = encMs > 0 ? (sizeBytes / encMs) * 1_000 : 0;

    notify('encrypting', 55);

    // ── Decryption ──────────────────────────────────────────────────────────
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    notify('decrypting', 60);

    const decT0 = performance.now();
    await decryptFile(key, ciphertext);
    const decMs  = performance.now() - decT0;
    const decBps = decMs > 0 ? (sizeBytes / decMs) * 1_000 : 0;

    notify('complete', 100);

    return {
        type:         'sim',
        encryptBps:   encBps,
        decryptBps:   decBps,
        encryptLabel: formatSpeed(encBps),
        decryptLabel: formatSpeed(decBps),
        encryptMs:    Math.round(encMs),
        decryptMs:    Math.round(decMs),
        sizeBytes,
        aborted:      false,
    };
}
