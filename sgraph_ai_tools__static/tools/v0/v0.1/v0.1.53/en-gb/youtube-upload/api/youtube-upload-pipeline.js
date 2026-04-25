/**
 * youtube-upload-pipeline.js
 * Glues the core/youtube-upload module + token cache into the tool's state
 * and emits SGA_YT events. UI never imports core directly — it goes through
 * the SgToolApi methods, which call into here.
 *
 * @module youtube-upload-pipeline
 */

import { requestAccess, YouTubeUpload }
    from '/core/youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js';
import { getCachedToken, setCachedToken, clearCachedToken }
    from '/components/video/upload/sg-youtube-upload/v0/v0.1/v0.1.0/youtube-token-cache.js';
import { state, resetUpload } from './youtube-upload-state.js';
import { SGA_YT }             from './youtube-upload-events.js';

const LS_CLIENT_ID = 'sg-youtube-client-id';

let _uploader = null;

/** Hydrate connected state from any cached token at boot. */
export function hydrate() {
    const cached = getCachedToken();
    if (cached) {
        _uploader        = new YouTubeUpload(cached.accessToken);
        state.connected  = true;
        state.expiresAt  = cached.expiresAt;
    }
}

export function getClientId() {
    return localStorage.getItem(LS_CLIENT_ID) || '';
}

/** @param {string} v */
export function setClientId(v) {
    const trimmed = (v || '').trim();
    if (trimmed) localStorage.setItem(LS_CLIENT_ID, trimmed);
    else         localStorage.removeItem(LS_CLIENT_ID);
}

/**
 * Acquire / reuse a youtube.upload access token.
 * Tries cache → silent grant → interactive grant.
 *
 * @param {{ clientId?: string, silent?: boolean, emit?: Function }} opts
 * @returns {Promise<{ accessToken: string, expiresAt: number, fromCache: boolean }>}
 */
export async function connect({ clientId, silent = false, emit } = {}) {
    const cached = getCachedToken();
    if (cached) {
        _uploader        = new YouTubeUpload(cached.accessToken);
        state.connected  = true;
        state.expiresAt  = cached.expiresAt;
        emit?.(SGA_YT.CONNECTED, { expiresAt: cached.expiresAt, fromCache: true });
        return { ...cached, fromCache: true };
    }

    const cid = clientId || getClientId();
    if (!cid) throw new Error('No client-id set. Call setClientId() or pass clientId.');
    setClientId(cid);

    const token = silent
        ? await requestAccess(cid, { prompt: '' })
        : await requestAccess(cid);

    setCachedToken(token);
    _uploader        = new YouTubeUpload(token.accessToken);
    state.connected  = true;
    state.expiresAt  = token.expiresAt;
    emit?.(SGA_YT.CONNECTED, { expiresAt: token.expiresAt, fromCache: false });
    return { ...token, fromCache: false };
}

/** Clear cached token; does not revoke at Google. */
export function disconnect({ emit } = {}) {
    clearCachedToken();
    _uploader        = null;
    state.connected  = false;
    state.expiresAt  = null;
    emit?.(SGA_YT.DISCONNECTED, {});
}

/** @param {File|Blob} file @param {{ emit?: Function }} [opts] */
export function setFile(file, { emit } = {}) {
    state.file = file || null;
    resetUpload();
    if (state.file) {
        emit?.(SGA_YT.FILE_SET, {
            fileName: state.file.name || 'recording',
            fileSize: state.file.size,
            type:     state.file.type || '',
        });
    }
}

/**
 * Run the upload, streaming progress through SGA_YT events.
 * Requires connect() first and a file set.
 *
 * @param {object} metadata
 * @param {{ emit?: Function }} [opts]
 * @returns {Promise<{ id: string, url: string, snippet: object, status: object }>}
 */
export async function uploadVideo(metadata, { emit } = {}) {
    if (!state.file)   throw new Error('No file set. Call setFile() first.');
    if (!_uploader)    throw new Error('Not connected. Call connect() first.');
    if (!metadata?.title) throw new Error('metadata.title required');

    state.status   = 'uploading';
    state.progress = 0;
    state.lastError = null;
    emit?.(SGA_YT.UPLOAD_START, {
        fileName: state.file.name,
        fileSize: state.file.size,
        metadata,
    });

    try {
        const result = await _uploader.uploadVideo(state.file, metadata, {
            onProgress: p => {
                state.progress = p.percent;
                emit?.(SGA_YT.UPLOAD_PROGRESS, p);
            },
        });
        state.status       = 'done';
        state.progress     = 100;
        state.lastVideoId  = result.id;
        state.lastVideoUrl = result.url;
        emit?.(SGA_YT.UPLOAD_COMPLETE, result);
        return result;
    } catch (err) {
        state.status     = 'error';
        state.lastError  = err.message;
        // Drop bad token so next attempt re-auths
        if (/\b401\b/.test(err.message)) disconnect({ emit });
        emit?.(SGA_YT.ERROR, { step: 'upload', message: err.message });
        throw err;
    }
}

/**
 * Health snapshot for the JS API health() call and tests.
 * @returns {object}
 */
export function health() {
    return {
        ok:           state.connected || state.status !== 'error',
        connected:    state.connected,
        hasFile:      !!state.file,
        status:       state.status,
        progress:     state.progress,
        lastVideoUrl: state.lastVideoUrl,
        expiresInMs:  state.expiresAt ? state.expiresAt - Date.now() : null,
        clientIdSet:  !!getClientId(),
    };
}
