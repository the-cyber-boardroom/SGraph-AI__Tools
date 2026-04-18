/**
 * save-sg-send.js
 * Upload a recording to SG/Send.
 *
 * Delegates all encryption + upload to uploadFile() which handles token generation,
 * key derivation, SGMETA envelope, AES-256-GCM encryption, and multipart upload.
 *
 * The accessToken is the user's platform auth token (x-sgraph-access-token header),
 * read from localStorage key 'sgraph-send-token'. Without it the server returns 401.
 *
 * @module save-sg-send
 */

import { uploadFile } from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-upload.js';
import { SGA_RECORDER } from './recorder-events.js';

const SEND_URL = 'https://send.sgraph.ai';

/**
 * Encrypt and upload a Blob to SG/Send.
 *
 * @param {Blob}   blob
 * @param {{ filename?: string, accessToken?: string }} [opts]
 * @param {(percent: number, message: string) => void}  [onProgress]
 * @returns {Promise<{ token: string, shareUrl: string }>}
 */
export async function saveSendFile(blob, opts = {}, onProgress) {
    const filename    = opts.filename ?? `recording-${Date.now()}.webm`;
    const accessToken = opts.accessToken ?? localStorage.getItem('sgraph-send-token');

    if (!accessToken) {
        throw new Error('SG/Send token required. Enter your token in the Save panel.');
    }

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'sg-send', percent: 0, message: 'Encrypting & uploading…' });

    const result = await uploadFile(blob, filename, SEND_URL, accessToken, ({ percent, stage }) => {
        _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'sg-send', percent, message: stage });
        if (onProgress) onProgress(percent, stage);
    });

    const shareUrl = `${SEND_URL}/#${result.token}`;
    _dispatch(SGA_RECORDER.SAVE_COMPLETE, { target: 'sg-send', token: result.token, url: shareUrl });

    return { token: result.token, shareUrl };
}

function _dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}
