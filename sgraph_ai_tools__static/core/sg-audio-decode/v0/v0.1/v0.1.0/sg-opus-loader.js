/**
 * sg-opus-loader — lazy CDN loader for the `ogg-opus-decoder` WASM decoder.
 *
 * Loads eshaz `wasm-audio-decoders`' `ogg-opus-decoder` (MIT wrapper over
 * BSD-3-Clause libopus) from jsDelivr as a self-contained ES module. The WASM
 * binary is inlined in the single JS file (yEnc + DEFLATE) → no separate
 * `.wasm` fetch, no Web Worker, no SharedArrayBuffer, no COOP/COEP headers; it
 * decodes Ogg/Opus on the main thread, which works on EVERY browser including
 * Safari/iOS (where `AudioContext.decodeAudioData` cannot decode Opus).
 *
 * The module is loaded THROUGH `core/sg-wasm-cache.cachedImport`, so the decoder
 * is persisted in the Cache API (version-keyed by the pinned URL) and downloads
 * once. Bumping `OPUS_DECODER_URL` is automatic cache invalidation; the stale
 * version is pruned.
 *
 * @module sg-opus-loader
 * @version 0.1.0
 */

import { cachedImport, pruneOldVersions } from '../../../../sg-wasm-cache/v0/v0.1/v0.1.0/sg-wasm-cache.js';

/** Pinned, versioned decoder URL. Bumping the version is automatic cache-bust. */
export const OPUS_DECODER_URL = 'https://cdn.jsdelivr.net/npm/ogg-opus-decoder@1.7.3/+esm';
/** Prefix for pruning superseded versions from the Cache API. */
const OPUS_DECODER_PREFIX = 'https://cdn.jsdelivr.net/npm/ogg-opus-decoder@';

/** @type {Promise<object>|null} cached singleton decoder promise. */
let _decoderPromise = null;

/**
 * Lazy-load (and cache) the `ogg-opus-decoder`, returning a ready decoder.
 * Cached as a singleton — repeated calls reuse the same decoder instance.
 *
 * @returns {Promise<{ decodeFile: Function, reset?: Function, free?: Function }>}
 */
export function loadOpusDecoder() {
    if (_decoderPromise) return _decoderPromise;
    _decoderPromise = (async () => {
        const mod = await cachedImport(OPUS_DECODER_URL);
        // Evict any older pinned version we may have cached previously.
        pruneOldVersions(OPUS_DECODER_PREFIX, OPUS_DECODER_URL).catch(() => {});
        const Ctor = mod.OggOpusDecoder || (mod.default && mod.default.OggOpusDecoder) || mod.default;
        if (typeof Ctor !== 'function') {
            throw new Error('sg-opus-loader: OggOpusDecoder constructor not found in module');
        }
        const decoder = new Ctor();
        await decoder.ready;
        return decoder;
    })();
    return _decoderPromise;
}

/**
 * Decode an Ogg/Opus byte stream to PCM channel data.
 *
 * @param {Uint8Array} uint8 - the full Ogg/Opus file bytes.
 * @returns {Promise<{ channelData: Float32Array[], sampleRate: number }>}
 */
export async function decodeOggOpus(uint8) {
    const decoder = await loadOpusDecoder();
    const out = await decoder.decodeFile(uint8);
    // ogg-opus-decoder returns { channelData:[Float32Array], samplesDecoded, sampleRate }
    if (!out || !Array.isArray(out.channelData) || out.channelData.length === 0) {
        throw new Error('sg-opus-loader: decoder returned no channel data');
    }
    // Reset so the singleton can decode the next file cleanly.
    if (typeof decoder.reset === 'function') {
        try { await decoder.reset(); } catch { /* ignore */ }
    }
    return { channelData: out.channelData, sampleRate: out.sampleRate || 48000 };
}
