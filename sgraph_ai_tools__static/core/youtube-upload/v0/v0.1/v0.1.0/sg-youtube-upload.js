/**
 * sg-youtube-upload — YouTube Data API v3 client-side uploader.
 *
 * Pure JS, no UI, no localStorage. Mirrors the requestAccess() pattern
 * from sg-drive-appdata so the OAuth machinery is uniform across SGraph
 * Google integrations. Caching and UI live in the component layer.
 *
 * Resumable upload protocol (single-PUT variant):
 *   1. POST /upload/youtube/v3/videos?uploadType=resumable
 *      → response 200, Location header = upload session URL
 *   2. PUT <Location> with the video bytes (XHR for progress)
 *      → response 200/201, body = video resource { id, snippet, status, ... }
 *
 * Prerequisites (per the tool's Google Cloud project):
 *   - YouTube Data API v3 enabled
 *   - https://www.googleapis.com/auth/youtube.upload scope on the consent screen
 *   - The user's email added as a test user (until OAuth verification)
 *   - Authorised JS origin matches the page origin
 *
 * @module sg-youtube-upload
 * @version 0.1.0
 *
 * @example
 *   import { requestAccess, YouTubeUpload } from '/core/youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js';
 *
 *   const { accessToken } = await requestAccess(clientId);
 *   const yt = new YouTubeUpload(accessToken);
 *   const { id, url } = await yt.uploadVideo(file, {
 *       title: 'My recording',
 *       privacyStatus: 'unlisted',
 *   }, { onProgress: p => console.log(p.percent) });
 */

const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3/videos';

export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

/**
 * Request a youtube.upload access token via Google Identity Services.
 * Shows the consent screen on first call. Use prompt:'' for silent re-grant
 * once consent has been given (GIS session cookies still valid).
 *
 * Waits up to 3 s for GIS to load before failing.
 *
 * @param {string} clientId  Google OAuth client ID
 * @param {{ hint?: string, prompt?: '' | 'consent' | 'select_account' }} [opts]
 * @returns {Promise<{ accessToken: string, expiresAt: number, scope: string }>}
 *          expiresAt is ms since epoch; tokens are valid ~1 hour.
 */
export function requestAccess(clientId, { hint = '', prompt } = {}) {
    return new Promise((resolve, reject) => {
        const attempt = (retriesLeft) => {
            if (!window.google?.accounts?.oauth2) {
                if (retriesLeft > 0) {
                    setTimeout(() => attempt(retriesLeft - 1), 200);
                } else {
                    reject(new Error('Google Sign-In library not loaded — please refresh the page'));
                }
                return;
            }
            const config = {
                client_id: clientId,
                scope:     YOUTUBE_UPLOAD_SCOPE,
                callback:  r => {
                    if (r.error) return reject(new Error(r.error_description || r.error));
                    const expiresIn = Number(r.expires_in) || 3600;
                    resolve({
                        accessToken: r.access_token,
                        expiresAt:   Date.now() + (expiresIn * 1000),
                        scope:       r.scope || YOUTUBE_UPLOAD_SCOPE,
                    });
                },
            };
            if (hint) config.hint = hint;
            const client = google.accounts.oauth2.initTokenClient(config);
            client.requestAccessToken(prompt !== undefined ? { prompt } : undefined);
        };
        attempt(15);
    });
}

/**
 * @typedef {Object} VideoMetadata
 * @property {string}   title              Required. Max 100 chars, no `<` or `>`.
 * @property {string}   [description]      Max 5000 chars.
 * @property {string[]} [tags]             Max 500 chars total across all tags.
 * @property {number}   [categoryId]       YouTube category ID. Default 22 (People & Blogs).
 * @property {'private'|'unlisted'|'public'} [privacyStatus]  Default 'unlisted'.
 * @property {boolean}  [selfDeclaredMadeForKids]              Default false.
 */

/**
 * @typedef {Object} UploadProgress
 * @property {number} loaded   bytes uploaded so far
 * @property {number} total    total bytes
 * @property {number} percent  0..100
 */

/**
 * YouTubeUpload — minimal wrapper around YouTube Data API v3 uploads.
 * Instantiate with a valid access token from requestAccess().
 */
export class YouTubeUpload {
    /** @param {string} accessToken */
    constructor(accessToken) {
        if (!accessToken) throw new Error('YouTubeUpload: accessToken required');
        this._token = accessToken;
    }

    get _auth() { return { Authorization: `Bearer ${this._token}` }; }

    /**
     * Upload a video file. Resumable single-PUT; for very large files
     * a future v0.2 should chunk via Content-Range.
     *
     * @param {Blob|File}      file
     * @param {VideoMetadata}  metadata
     * @param {{ onProgress?: (p: UploadProgress) => void, signal?: AbortSignal }} [opts]
     * @returns {Promise<{ id: string, url: string, snippet: object, status: object }>}
     */
    async uploadVideo(file, metadata, { onProgress, signal } = {}) {
        if (!file)               throw new Error('uploadVideo: file required');
        if (!metadata?.title)    throw new Error('uploadVideo: metadata.title required');

        const body = {
            snippet: {
                title:       String(metadata.title).slice(0, 100),
                description: metadata.description || '',
                tags:        Array.isArray(metadata.tags) ? metadata.tags : [],
                categoryId:  String(metadata.categoryId ?? 22),
            },
            status: {
                privacyStatus:           metadata.privacyStatus || 'unlisted',
                selfDeclaredMadeForKids: !!metadata.selfDeclaredMadeForKids,
                embeddable:              true,
            },
        };

        // Step 1 — initiate resumable session
        const initRes = await fetch(`${UPLOAD_BASE}?uploadType=resumable&part=snippet,status`, {
            method:  'POST',
            headers: {
                ...this._auth,
                'Content-Type':           'application/json; charset=UTF-8',
                'X-Upload-Content-Type':   file.type || 'video/*',
                'X-Upload-Content-Length': String(file.size),
            },
            body:   JSON.stringify(body),
            signal,
        });
        if (!initRes.ok) {
            const text = await initRes.text().catch(() => '');
            throw new Error(`YouTube init ${initRes.status}: ${text.slice(0, 300)}`);
        }
        const sessionUrl = initRes.headers.get('Location');
        if (!sessionUrl) throw new Error('YouTube init: no Location header in response');

        // Step 2 — PUT bytes (XHR so we can stream progress)
        return await this._putWithProgress(sessionUrl, file, { onProgress, signal });
    }

    /**
     * @private
     */
    _putWithProgress(url, file, { onProgress, signal }) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url, true);
            xhr.setRequestHeader('Content-Type', file.type || 'video/*');

            xhr.upload.addEventListener('progress', e => {
                if (!onProgress || !e.lengthComputable) return;
                onProgress({
                    loaded:  e.loaded,
                    total:   e.total,
                    percent: e.total ? Math.round((e.loaded / e.total) * 100) : 0,
                });
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    let resource = {};
                    try { resource = JSON.parse(xhr.responseText); } catch { /* ignore */ }
                    const id = resource.id;
                    resolve({
                        id,
                        url:     id ? `https://www.youtube.com/watch?v=${id}` : null,
                        snippet: resource.snippet || {},
                        status:  resource.status  || {},
                    });
                } else {
                    reject(new Error(`YouTube upload ${xhr.status}: ${xhr.responseText.slice(0, 300)}`));
                }
            });
            xhr.addEventListener('error',   () => reject(new Error('YouTube upload network error')));
            xhr.addEventListener('abort',   () => reject(new Error('YouTube upload aborted')));
            xhr.addEventListener('timeout', () => reject(new Error('YouTube upload timed out')));

            if (signal) {
                if (signal.aborted) { xhr.abort(); return; }
                signal.addEventListener('abort', () => xhr.abort(), { once: true });
            }

            xhr.send(file);
        });
    }
}
