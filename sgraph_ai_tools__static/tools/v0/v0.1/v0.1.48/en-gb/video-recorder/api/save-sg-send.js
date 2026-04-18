/**
 * save-sg-send.js
 * Encrypt and upload a recording via sg-send (SG/Send platform).
 *
 * Generates a token, derives an AES-GCM key, encrypts the blob, uploads it,
 * and returns the token + share URL. sg-send encrypts everything at the platform
 * level — no additional encryption layer is needed.
 *
 * @module save-sg-send
 */

import { generateToken, deriveKey, deriveTransferId, buildSgmetaEnvelope, encrypt }
    from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-crypto.js';
import { uploadFile }
    from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-upload.js';
import { SGA_RECORDER } from './recorder-events.js';

const SEND_URL = 'https://send.sgraph.ai';

/**
 * Encrypt and upload a Blob to SG/Send.
 *
 * @param {Blob} blob                     Video recording Blob
 * @param {{ filename?: string }} [opts]
 * @param {(percent: number, message: string) => void} [onProgress]
 * @returns {Promise<{ token: string, shareUrl: string }>}
 */
export async function saveSendFile(blob, opts = {}, onProgress) {
    const filename = opts.filename ?? `recording-${Date.now()}.webm`;
    const token    = generateToken();
    const key      = await deriveKey(token);
    const id       = await deriveTransferId(token);

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'sg-send', percent: 0, message: 'Encrypting…' });

    // Encrypt: wrap plaintext in SGMETA envelope then AES-256-GCM
    const plaintext = buildSgmetaEnvelope(await blob.arrayBuffer(), filename);
    const encrypted = await encrypt(plaintext, key);

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'sg-send', percent: 20, message: 'Uploading…' });

    const encBlob = new Blob([encrypted], { type: 'application/octet-stream' });

    await uploadFile(encBlob, filename, SEND_URL, id, (progress) => {
        const pct = 20 + Math.round(progress * 80);
        _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'sg-send', percent: pct, message: 'Uploading…' });
        if (onProgress) onProgress(pct, 'Uploading…');
    });

    const shareUrl = `${SEND_URL}/#${token}`;
    _dispatch(SGA_RECORDER.SAVE_COMPLETE, { target: 'sg-send', token, url: shareUrl });

    return { token, shareUrl };
}

function _dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}
