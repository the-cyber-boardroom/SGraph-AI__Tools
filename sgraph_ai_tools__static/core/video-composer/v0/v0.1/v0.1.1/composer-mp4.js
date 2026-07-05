/**
 * composer-mp4.js — MP4 mimeType picker and WebM→MP4 remux fallback.
 * @module video-composer/composer-mp4
 */

const MP4_CANDIDATES = [
    'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
];

/**
 * First MP4 mimeType supported by MediaRecorder, or null if none.
 * @returns {string|null}
 */
export function pickMp4MimeType() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const m of MP4_CANDIDATES) {
        if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return null;
}

/**
 * True if a blob needs WebM→MP4 remuxing.
 * @param {Blob} blob
 * @returns {boolean}
 */
export function needsRemux(blob) {
    return !!blob && typeof blob.type === 'string' && blob.type.startsWith('video/webm');
}

/**
 * Remux a WebM blob to MP4 via sg-video's convertToMp4.
 * @param {Blob} blob
 * @param {Function} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function remuxToMp4(blob, onProgress) {
    const mod = await import('../../../../video/v1/v1.0/v1.0.1/sg-video.js');
    return mod.convertToMp4(blob, onProgress);
}

/**
 * Return an MP4 blob, remuxing from WebM if necessary.
 * @param {Blob} blob
 * @param {Function} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function ensureMp4(blob, onProgress) {
    if (needsRemux(blob)) return remuxToMp4(blob, onProgress);
    return blob;
}
