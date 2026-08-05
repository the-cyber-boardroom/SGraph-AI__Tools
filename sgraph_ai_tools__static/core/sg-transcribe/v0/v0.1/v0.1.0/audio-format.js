/**
 * audio-format — OpenRouter audio-format POLICY (the thin tool-local layer).
 *
 * OpenRouter audio input accepts: wav, mp3, aiff, aac, ogg, flac, m4a, pcm.
 * webm/opus (what core/sg-audio records by default) and bare `.opus`
 * (WhatsApp voice notes) are NOT reliably accepted, so undecodable/unsupported
 * inputs are converted to WAV via core/sg-audio-decode before sending.
 *
 * The heavy lifting (codec decode + WAV write) lives in core/sg-audio-decode;
 * this file only decides WHICH path to take and produces the base64 data URL
 * the LLM message needs.
 *
 * @module audio-transcribe/audio-format
 */

import { needsDecode, blobToWav } from '../../../../sg-audio-decode/v0/v0.1/v0.1.0/sg-audio-decode.js';

/** Formats OpenRouter explicitly accepts (no decode needed). */
export const OR_SUPPORTED = Object.freeze(['wav', 'mp3', 'aac', 'ogg', 'flac', 'm4a']);

/** Extensions we accept as audio (incl. .opus + container formats we decode). */
const AUDIO_EXTS = Object.freeze(['opus', 'ogg', 'wav', 'mp3', 'm4a', 'aac', 'flac', 'mp4', 'webm', 'aiff', 'oga']);

/**
 * Lowercase file extension (without the dot).
 * @param {string} name
 * @returns {string}
 */
export function extOf(name) {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)\s*$/);
    return m ? m[1] : '';
}

/**
 * Whether a File/Blob looks like audio we can ingest. `.opus` reports an
 * inconsistent MIME (audio/ogg | audio/opus | empty), so we sniff on the
 * EXTENSION as well as the MIME type.
 *
 * @param {{ name?: string, type?: string }} file
 * @returns {boolean}
 */
export function isAudioFile(file = {}) {
    const mime = String(file.type || '').toLowerCase();
    if (mime.startsWith('audio/')) return true;
    const ext = extOf(file.name);
    return AUDIO_EXTS.includes(ext);
}

/**
 * Whether the input is already an OpenRouter-accepted format (so it can pass
 * through with no decode). `.opus` is intentionally NOT considered supported
 * here (per-model `ogg` acceptance is unverified; we decode it to WAV).
 *
 * @param {{ name?: string, type?: string }|string} mimeOrName - a File/Blob, or a name/mime string.
 * @returns {boolean}
 */
export function isSupportedAudio(mimeOrName) {
    const file = typeof mimeOrName === 'string'
        ? { name: mimeOrName, type: mimeOrName }
        : (mimeOrName || {});
    return !needsDecode(file);
}

/**
 * Map a blob/name to the OpenRouter `format` string for the input_audio block.
 * @param {string} mime @param {string} name @returns {string}
 */
function orFormat(mime, name) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('wav')) return 'wav';
    if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
    if (m.includes('flac')) return 'flac';
    if (m.includes('aac')) return 'aac';
    if (m.includes('m4a') || m.includes('mp4')) return 'm4a';
    if (m.includes('ogg')) return 'ogg';
    const ext = extOf(name);
    if (OR_SUPPORTED.includes(ext)) return ext;
    if (ext === 'mp4') return 'm4a';
    return 'wav';
}

/**
 * Read a Blob into a base64 data URL.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
    if (typeof FileReader !== 'undefined') {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
            fr.readAsDataURL(blob);
        });
    }
    // Node / no-FileReader fallback.
    return blob.arrayBuffer().then((buf) => {
        const b64 = Buffer.from(buf).toString('base64');
        return `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
    });
}

/**
 * Convert an arbitrary recorded/loaded audio blob into a model-accepted base64
 * data URL, using the three-tier NEVER-FAIL strategy:
 *   (1) already OpenRouter-accepted (m4a/mp3/wav/ogg/flac/aac) → pass through.
 *   (2)/(3) else → core/sg-audio-decode.blobToWav() (native decode, falling
 *       through to the WASM Opus decoder for Safari/Opus or any failure).
 * There is no tier that throws `opus-decode-unsupported`; `.opus` always
 * becomes WAV.
 *
 * @param {Blob} blob
 * @param {string} [hintName] - original filename (for extension sniffing).
 * @returns {Promise<{ dataUrl: string, mime: string, format: string }>}
 */
export async function toSupportedDataUrl(blob, hintName) {
    const name = hintName || (blob && blob.name) || '';
    if (!needsDecode({ name, type: blob && blob.type })) {
        const mime = blob.type || 'audio/mpeg';
        const dataUrl = await blobToDataUrl(blob);
        return { dataUrl, mime, format: orFormat(mime, name) };
    }
    // Decode (tier-2 native → tier-3 WASM Opus) to a universally-accepted WAV.
    const wav = await blobToWav(blob, { hintName: name });
    const dataUrl = await blobToDataUrl(wav);
    return { dataUrl, mime: 'audio/wav', format: 'wav' };
}
