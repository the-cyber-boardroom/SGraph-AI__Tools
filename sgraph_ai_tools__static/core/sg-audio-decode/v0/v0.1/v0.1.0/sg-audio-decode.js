/**
 * sg-audio-decode — reliable in-browser audio decode → PCM → WAV.
 *
 * The headline use case is WhatsApp `.opus` (Ogg/Opus) voice notes, which
 * `AudioContext.decodeAudioData` CANNOT decode on Safari/iOS. This module
 * decodes audio to PCM and writes a 16-bit WAV on EVERY browser with NO
 * hard-stop, via a tiered strategy:
 *
 *   tier-2  native `AudioContext.decodeAudioData` → PCM   (cheap; Chrome/FF do
 *           Ogg/Opus and webm/opus here).
 *   tier-3  on tier-2 failure (Safari + Opus, or any decode error) → the WASM
 *           Opus decoder (`sg-opus-loader`, lazy CDN load, Cache-API persisted).
 *
 * (Tier-1 — passing through an already-OpenRouter-accepted format without any
 * decode — is the caller's policy, implemented in the tool's `audio-format.js`;
 * `needsDecode()` here exposes the same OR-supported set so callers can pre-check.)
 *
 * @module sg-audio-decode
 * @version 0.1.0
 */

import { encodeWav } from './sg-wav-encoder.js';
import { decodeOggOpus } from './sg-opus-loader.js';

/** Formats OpenRouter audio input explicitly accepts (no decode needed). */
export const OR_SUPPORTED = Object.freeze(['wav', 'mp3', 'aac', 'ogg', 'flac', 'm4a']);

/**
 * Derive a lowercase extension from a name/hint.
 * @param {string} name
 * @returns {string}
 */
function extOf(name) {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)\s*$/);
    return m ? m[1] : '';
}

/**
 * Whether a file/blob looks like it needs decoding to a WAV before sending to
 * OpenRouter (i.e. it is NOT one of the explicitly-accepted formats). Callers
 * can use this to skip the decode for supported inputs.
 *
 * @param {{ name?: string, type?: string }} file - a File/Blob or `{name,type}`.
 * @returns {boolean}
 */
export function needsDecode(file = {}) {
    const ext = extOf(file.name);
    const mime = String(file.type || '').toLowerCase();
    // .opus reports inconsistent MIME — always decode it (Safari can't natively).
    if (ext === 'opus' || mime.includes('opus')) return true;
    if (ext && OR_SUPPORTED.includes(ext)) return false;
    for (const fmt of OR_SUPPORTED) {
        if (mime.includes(fmt) || (fmt === 'mp3' && mime.includes('mpeg'))) return false;
    }
    return true;
}

/**
 * Read a Blob into a Uint8Array.
 * @param {Blob} blob
 * @returns {Promise<Uint8Array>}
 */
async function blobBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Try the native `AudioContext.decodeAudioData` path (tier-2). Resolves to PCM
 * or throws (so the caller can fall through to tier-3).
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{ channelData: Float32Array[], sampleRate: number }>}
 */
async function decodeNative(arrayBuffer) {
    const AC = (typeof AudioContext !== 'undefined' && AudioContext)
        || (typeof webkitAudioContext !== 'undefined' && webkitAudioContext);
    if (!AC) throw new Error('AudioContext unavailable');
    const ctx = new AC();
    try {
        // decodeAudioData copies the buffer; pass a slice to be safe across impls.
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const channelData = [];
        for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
            channelData.push(audioBuffer.getChannelData(c));
        }
        return { channelData, sampleRate: audioBuffer.sampleRate };
    } finally {
        try { await ctx.close(); } catch { /* ignore */ }
    }
}

/**
 * Decode an arbitrary audio blob to PCM channel data, NEVER hard-stopping on
 * Opus. Tries native decode first; on failure (or for `.opus`, which Safari
 * cannot decode natively) falls through to the WASM Opus decoder.
 *
 * @param {Blob} blob
 * @param {{ hintName?: string }} [opts]
 * @returns {Promise<{ channelData: Float32Array[], sampleRate: number }>}
 */
export async function decodeToPcm(blob, opts = {}) {
    const hint = opts.hintName || (blob && blob.name) || '';
    const looksOpus = extOf(hint) === 'opus' || String(blob && blob.type || '').includes('opus');
    const bytes = await blobBytes(blob);

    // For .opus, prefer the WASM decoder outright — it is the one path that works
    // on every browser (Safari included) and avoids a guaranteed Safari failure.
    if (looksOpus) {
        try {
            return await decodeOggOpus(bytes);
        } catch (_) {
            // Fall through to native as a last resort (Chrome/FF may still do it).
        }
    }

    try {
        return await decodeNative(bytes.buffer.slice(0));
    } catch (_) {
        // tier-3: WASM Opus decode (covers Safari/Opus + any native failure).
        return await decodeOggOpus(bytes);
    }
}

/**
 * Decode an audio blob and re-encode it as a 16-bit PCM WAV blob. The output
 * (`audio/wav`) is universally accepted by OpenRouter audio models.
 *
 * @param {Blob} blob
 * @param {{ hintName?: string }} [opts]
 * @returns {Promise<Blob>} a WAV blob.
 */
export async function blobToWav(blob, opts = {}) {
    const pcm = await decodeToPcm(blob, opts);
    return encodeWav(pcm);
}
