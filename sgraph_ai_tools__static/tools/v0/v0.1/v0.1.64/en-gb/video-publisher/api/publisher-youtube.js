/**
 * publisher-youtube.js
 * YouTube session for the publisher — the youtube-editor pipeline pattern
 * (cache → silent re-grant → popup, 60 s skew, 401 auto-disconnect) plus
 * Decision 7's PROACTIVE refresh: silent re-grant at ~T-5 min while the tool
 * is open, and always immediately before an upload, so the single-PUT starts
 * with a full hour on the clock.
 * @module publisher-youtube
 */

import { requestAccess, YouTubeUpload }
    from '/core/youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js';
import { YouTubeApi, YOUTUBE_FULL_SCOPE }
    from '/core/youtube-api/v0/v0.1/v0.1.0/sg-youtube-api.js';
import { saveToken, getToken, removeToken }
    from '/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';
import { state } from './publisher-state.js';
import { VP_EVENTS } from './publisher-events.js';

const PROVIDER     = 'video-publisher';
const LS_CLIENT_ID = 'sg-youtube-client-id';   // shared with youtube-editor (Decision 5)
const SKEW_MS      = 60_000;
const REFRESH_LEAD_MS = 5 * 60_000;            // proactive silent refresh at T-5 min

/** Same public tools.sgraph.ai client ID youtube-editor bundles. */
export const DEFAULT_CLIENT_ID =
    '595529627627-i1fjfhoh8dnscpg6u09uqt1o8qc5ffnf.apps.googleusercontent.com';

let _api = null, _upload = null, _refreshTimer = null, _uploadAbort = null;

/** Abort the in-flight upload, if any (no-op otherwise). */
export function abortUpload() { _uploadAbort?.abort(); }

function _cached() {
    const t = getToken(PROVIDER);
    if (!t?.accessToken || !t.expiresAt) return null;
    if (Date.now() + SKEW_MS >= t.expiresAt) return null;
    return t;
}

function _adopt(token, { emit, fromCache }) {
    saveToken(PROVIDER, { accessToken: token.accessToken, expiresAt: token.expiresAt, scope: token.scope || YOUTUBE_FULL_SCOPE });
    _api    = new YouTubeApi(token.accessToken);
    _upload = new YouTubeUpload(token.accessToken);
    state.youtube.connected   = true;
    state.youtube.accessToken = token.accessToken;
    state.youtube.expiresAt   = token.expiresAt;
    _armRefresh(token.expiresAt, emit);
    emit?.(VP_EVENTS.YT_CONNECTED, { expiresAt: token.expiresAt, fromCache: !!fromCache });
}

/** Decision 7: schedule a silent re-grant shortly before expiry. */
function _armRefresh(expiresAt, emit) {
    clearTimeout(_refreshTimer);
    const delay = Math.max(30_000, expiresAt - Date.now() - REFRESH_LEAD_MS);
    _refreshTimer = setTimeout(() => {
        connect({ silent: true, emit }).catch(() => { /* popup path on next user action */ });
    }, delay);
}

export function getClientId()  { return localStorage.getItem(LS_CLIENT_ID) || DEFAULT_CLIENT_ID; }
export function setClientId(v) {
    const trimmed = (v || '').trim();
    if (trimmed) localStorage.setItem(LS_CLIENT_ID, trimmed);
    else         localStorage.removeItem(LS_CLIENT_ID);
}

/** Hydrate from a cached token at boot (no popup ever). */
export function hydrate({ emit } = {}) {
    const c = _cached();
    if (c) _adopt(c, { emit, fromCache: true });
}

/**
 * Connect: cache → silent (`prompt:''`) → interactive popup.
 * @param {{ clientId?: string, silent?: boolean, emit?: Function }} opts
 */
export async function connect({ clientId, silent = false, emit } = {}) {
    const cached = _cached();
    if (cached && !silent) { _adopt(cached, { emit, fromCache: true }); return { fromCache: true }; }

    const cid = clientId || getClientId();
    if (clientId) setClientId(clientId);

    try {
        const token = await requestAccess(cid, { scope: YOUTUBE_FULL_SCOPE, prompt: '' });
        _adopt(token, { emit, fromCache: false });
        return { fromCache: false, silent: true };
    } catch (err) {
        if (silent) throw err;   // caller asked for silent-only — no popup
        const token = await requestAccess(cid, { scope: YOUTUBE_FULL_SCOPE });
        _adopt(token, { emit, fromCache: false });
        return { fromCache: false, silent: false };
    }
}

export function disconnect({ emit } = {}) {
    clearTimeout(_refreshTimer);
    removeToken(PROVIDER);
    _api = null; _upload = null;
    Object.assign(state.youtube, { connected: false, accessToken: null, expiresAt: null, channel: null });
    emit?.(VP_EVENTS.YT_DISCONNECTED, {});
}

/** Fresh-token guard: silent re-grant if inside the refresh window. */
export async function ensureFresh({ emit } = {}) {
    if (!state.youtube.connected) throw new Error('Not connected to YouTube.');
    if (state.youtube.expiresAt - Date.now() < REFRESH_LEAD_MS) {
        await connect({ silent: true, emit }).catch(() => { /* keep current token; upload may still fit */ });
    }
}

async function _withAuth(fn, emit) {
    try { return await fn(); }
    catch (err) {
        if (/\b401\b/.test(err.message)) disconnect({ emit });
        throw err;
    }
}

export async function getMyChannel({ emit } = {}) {
    if (!_api) throw new Error('Not connected.');
    const channel = await _withAuth(() => _api.getMyChannel(), emit);
    state.youtube.channel = channel;
    return channel;
}

/**
 * Upload the job's video. Refreshes the token first (Decision 7).
 * @param {File} file
 * @param {{ title: string, description?: string, tags?: string[], privacyStatus?: string }} metadata
 */
export async function uploadVideo(file, metadata, { emit } = {}) {
    if (!_upload) throw new Error('Not connected.');
    await ensureFresh({ emit });

    state.youtube.uploadStatus   = 'uploading';
    state.youtube.uploadProgress = 0;
    emit?.(VP_EVENTS.UPLOAD_START, { fileName: file.name, fileSize: file.size, metadata });

    _uploadAbort = new AbortController();
    try {
        const result = await _withAuth(
            () => _upload.uploadVideo(file, metadata, {
                signal: _uploadAbort.signal,
                onProgress: p => {
                    state.youtube.uploadProgress = p.percent;
                    emit?.(VP_EVENTS.UPLOAD_PROGRESS, p);
                },
            }),
            emit,
        );
        state.youtube.uploadStatus   = 'done';
        state.youtube.uploadProgress = 100;
        state.youtube.lastUploadId   = result.id;
        state.youtube.lastUrl        = result.url;
        emit?.(VP_EVENTS.UPLOAD_COMPLETE, { id: result.id, url: result.url });
        return result;
    } catch (err) {
        state.youtube.uploadStatus = 'error';
        throw err;
    } finally {
        _uploadAbort = null;
    }
}
