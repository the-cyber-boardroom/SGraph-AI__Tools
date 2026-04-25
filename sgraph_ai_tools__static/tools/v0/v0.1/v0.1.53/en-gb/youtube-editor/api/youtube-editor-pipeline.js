/**
 * youtube-editor-pipeline.js
 * Glue between the core modules (youtube-upload + youtube-api) and the tool
 * state. Holds the YouTubeApi + YouTubeUpload instances, manages the cached
 * token, and emits SGA_YT events.
 *
 * UI never imports core directly — it goes through the SgToolApi methods,
 * which call into here.
 *
 * @module youtube-editor-pipeline
 */

import { requestAccess, YouTubeUpload }
    from '/core/youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js';
import { YouTubeApi, YOUTUBE_FULL_SCOPE }
    from '/core/youtube-api/v0/v0.1/v0.1.0/sg-youtube-api.js';
import { saveToken, getToken, removeToken }
    from '/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';
import { state } from './youtube-editor-state.js';
import { SGA_YT } from './youtube-editor-events.js';

const PROVIDER     = 'youtube-editor';
const LS_CLIENT_ID = 'sg-youtube-client-id';
const SKEW_MS      = 60_000;

/**
 * Default Google OAuth client ID for tools.sgraph.ai.
 * Public — gated by Authorised JavaScript origins, not by secrecy.
 */
export const DEFAULT_CLIENT_ID =
    '595529627627-i1fjfhoh8dnscpg6u09uqt1o8qc5ffnf.apps.googleusercontent.com';

let _api    = null;   // YouTubeApi instance (read+edit)
let _upload = null;   // YouTubeUpload instance (resumable upload)

// ── Token cache (shared shape with sg-auth-tokens) ───────────────────────────

function _cached() {
    const t = getToken(PROVIDER);
    if (!t?.accessToken || !t.expiresAt) return null;
    if (Date.now() + SKEW_MS >= t.expiresAt) return null;
    return { accessToken: t.accessToken, expiresAt: t.expiresAt, scope: t.scope };
}

function _store(token) {
    saveToken(PROVIDER, {
        accessToken: token.accessToken,
        expiresAt:   token.expiresAt,
        scope:       token.scope || YOUTUBE_FULL_SCOPE,
    });
}

function _clear() { removeToken(PROVIDER); }

function _setClients(token) {
    _api    = new YouTubeApi(token);
    _upload = new YouTubeUpload(token);
}

// ── Public surface ───────────────────────────────────────────────────────────

export function getClientId() {
    return localStorage.getItem(LS_CLIENT_ID) || DEFAULT_CLIENT_ID;
}

export function setClientId(v) {
    const trimmed = (v || '').trim();
    if (trimmed) localStorage.setItem(LS_CLIENT_ID, trimmed);
    else         localStorage.removeItem(LS_CLIENT_ID);
}

/** Hydrate the in-memory clients from a cached token (call at boot). */
export function hydrate() {
    const c = _cached();
    if (c) {
        _setClients(c.accessToken);
        state.connected   = true;
        state.accessToken = c.accessToken;
        state.expiresAt   = c.expiresAt;
    }
}

/**
 * Acquire a youtube (full) scope token. Uses cache → silent → interactive.
 * @param {{ clientId?: string, silent?: boolean, emit?: Function }} opts
 */
export async function connect({ clientId, silent = false, emit } = {}) {
    const cached = _cached();
    if (cached) {
        _setClients(cached.accessToken);
        state.connected   = true;
        state.accessToken = cached.accessToken;
        state.expiresAt   = cached.expiresAt;
        emit?.(SGA_YT.CONNECTED, { expiresAt: cached.expiresAt, fromCache: true, scope: cached.scope });
        return { ...cached, fromCache: true };
    }

    const cid = clientId || getClientId();
    if (!cid) throw new Error('No client-id set.');
    setClientId(cid);

    const token = await requestAccess(cid, {
        scope:  YOUTUBE_FULL_SCOPE,
        prompt: silent ? '' : undefined,
    });
    _store(token);
    _setClients(token.accessToken);
    state.connected   = true;
    state.accessToken = token.accessToken;
    state.expiresAt   = token.expiresAt;
    emit?.(SGA_YT.CONNECTED, { expiresAt: token.expiresAt, fromCache: false, scope: token.scope });
    return { ...token, fromCache: false };
}

export function disconnect({ emit } = {}) {
    _clear();
    _api = null;
    _upload = null;
    state.connected   = false;
    state.accessToken = null;
    state.expiresAt   = null;
    state.channel     = null;
    state.videos      = [];
    state.selectedId  = null;
    state.editingVideo = null;
    emit?.(SGA_YT.DISCONNECTED, {});
}

/** Wraps a call so 401 → auto-disconnect (forces re-auth on next try). */
async function _withAuth(fn, emit) {
    try { return await fn(); }
    catch (err) {
        if (/\b401\b/.test(err.message)) disconnect({ emit });
        throw err;
    }
}

// ── Channel + listing ────────────────────────────────────────────────────────

export async function getMyChannel({ emit } = {}) {
    if (!_api) throw new Error('Not connected.');
    const channel = await _withAuth(() => _api.getMyChannel(), emit);
    state.channel = channel;
    emit?.(SGA_YT.CHANNEL_LOADED, { channel });
    return channel;
}

export async function listMyUploads({ pageToken, pageSize, emit } = {}) {
    if (!_api) throw new Error('Not connected.');
    const result = await _withAuth(
        () => _api.listMyUploads({ pageToken, pageSize, uploadsPlaylistId: state.channel?.uploadsPlaylistId }),
        emit
    );
    if (!pageToken) state.videos = [...result.items];
    else            state.videos.push(...result.items);
    emit?.(SGA_YT.VIDEOS_LOADED, {
        items:        result.items,
        totalResults: result.totalResults,
        page:         pageToken ? null : 1,
    });
    return result;
}

// ── Edit ─────────────────────────────────────────────────────────────────────

export async function loadVideo(videoId, { emit } = {}) {
    if (!_api) throw new Error('Not connected.');
    const [video] = await _withAuth(
        () => _api.getVideos([videoId], 'snippet,status,statistics'),
        emit
    );
    if (!video) throw new Error('Video not found');
    state.selectedId   = videoId;
    state.editingVideo = video;
    emit?.(SGA_YT.VIDEO_LOADED, { video });
    return video;
}

export async function updateVideo(videoId, patch, { emit } = {}) {
    if (!_api) throw new Error('Not connected.');
    const updated = await _withAuth(() => _api.updateVideo(videoId, patch), emit);
    state.editingVideo = updated;
    emit?.(SGA_YT.VIDEO_SAVED, { video: updated, patch });
    return updated;
}

export async function setThumbnail(videoId, blob, { emit } = {}) {
    if (!_api) throw new Error('Not connected.');
    const thumbnails = await _withAuth(() => _api.setThumbnail(videoId, blob), emit);
    emit?.(SGA_YT.THUMBNAIL_SET, { id: videoId, thumbnails });
    return thumbnails;
}

export async function deleteVideo(videoId, { emit } = {}) {
    if (!_api) throw new Error('Not connected.');
    await _withAuth(() => _api.deleteVideo(videoId), emit);
    state.videos = state.videos.filter(v => v.id !== videoId);
    if (state.selectedId === videoId) {
        state.selectedId   = null;
        state.editingVideo = null;
    }
    emit?.(SGA_YT.VIDEO_DELETED, { id: videoId });
}

// ── Upload ───────────────────────────────────────────────────────────────────

export async function uploadVideo(file, metadata, { emit } = {}) {
    if (!_upload) throw new Error('Not connected.');
    if (!file)               throw new Error('uploadVideo: file required');
    if (!metadata?.title)    throw new Error('uploadVideo: metadata.title required');

    state.uploadStatus   = 'uploading';
    state.uploadProgress = 0;
    state.lastError      = null;
    emit?.(SGA_YT.UPLOAD_START, {
        fileName: file.name, fileSize: file.size, metadata,
    });

    try {
        const result = await _withAuth(
            () => _upload.uploadVideo(file, metadata, {
                onProgress: p => {
                    state.uploadProgress = p.percent;
                    emit?.(SGA_YT.UPLOAD_PROGRESS, p);
                },
            }),
            emit
        );
        state.uploadStatus = 'done';
        state.uploadProgress = 100;
        state.lastUploadId   = result.id;
        emit?.(SGA_YT.UPLOAD_COMPLETE, result);
        return result;
    } catch (err) {
        state.uploadStatus = 'error';
        state.lastError    = err.message;
        emit?.(SGA_YT.ERROR, { step: 'upload', message: err.message });
        throw err;
    }
}

// ── Health ───────────────────────────────────────────────────────────────────

export function health() {
    return {
        ok:             state.connected || state.uploadStatus !== 'error',
        connected:      state.connected,
        expiresInMs:    state.expiresAt ? state.expiresAt - Date.now() : null,
        videosLoaded:   state.videos.length,
        editingVideoId: state.editingVideo?.id || null,
        uploadStatus:   state.uploadStatus,
        uploadProgress: state.uploadProgress,
        clientIdSet:    !!getClientId(),
    };
}
