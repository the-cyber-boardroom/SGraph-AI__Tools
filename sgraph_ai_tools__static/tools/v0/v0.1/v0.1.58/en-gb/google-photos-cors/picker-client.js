/**
 * picker-client — Phase 0 de-risk scaffold for the Google Photos Picker API
 * (Architect plan v0.2.58 §9, §8.3).
 *
 * Pure logic, no DOM. This is the structural template for the future
 * `core/sg-google-photos/sg-google-photos.js` module. It wraps:
 *   1. OAuth access-token acquisition (GIS token-client implicit flow) —
 *      copied from core/youtube-upload `requestAccess()`.
 *   2. The Picker API session lifecycle: create session, poll session,
 *      list picked media items.
 *   3. A `baseUrl` byte-download test — the actual CORS unknown this probe
 *      exists to answer.
 *
 * THROWAWAY probe. Not a shipped module. Lives under team/explorer/dev/probes/.
 *
 * Picker API reference (as of 2026): https://developers.google.com/photos/picker/guides/get-started
 *   - Sessions:   POST/GET https://photospicker.googleapis.com/v1/sessions[/{id}]
 *   - MediaItems: GET      https://photospicker.googleapis.com/v1/mediaItems?sessionId={id}
 *   - Download:   GET      <mediaItem.mediaFile.baseUrl>=d   (with Bearer auth)
 *
 * @module picker-client
 */

/** @type {string} OAuth scope — the only scope the Picker flow needs. */
export const PHOTOS_PICKER_SCOPE =
    'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';

/** @type {string} Picker API base. */
const PICKER_API_BASE = 'https://photospicker.googleapis.com/v1';

/**
 * Request a Google access token via Google Identity Services token-client
 * (implicit flow). Mirrors core/youtube-upload `requestAccess()` exactly,
 * only the default scope differs.
 *
 * @param {string} clientId  Google OAuth client ID (Web application type).
 * @param {{ prompt?: '' | 'consent' | 'select_account', scope?: string }} [opts]
 * @returns {Promise<{ accessToken: string, expiresAt: number, scope: string }>}
 *          expiresAt is ms since epoch; tokens are valid ~1 hour.
 */
export function requestPhotosAccess(clientId, { prompt, scope } = {}) {
    const requestedScope = scope || PHOTOS_PICKER_SCOPE;
    return new Promise((resolve, reject) => {
        const attempt = (retriesLeft) => {
            if (!window.google?.accounts?.oauth2) {
                if (retriesLeft > 0) {
                    setTimeout(() => attempt(retriesLeft - 1), 200);
                } else {
                    reject(new Error('Google Identity Services not loaded — refresh the page'));
                }
                return;
            }
            const client = google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope:     requestedScope,
                callback:  (r) => {
                    if (r.error) return reject(new Error(r.error_description || r.error));
                    const expiresIn = Number(r.expires_in) || 3600;
                    resolve({
                        accessToken: r.access_token,
                        expiresAt:   Date.now() + (expiresIn * 1000),
                        scope:       r.scope || requestedScope,
                    });
                },
            });
            client.requestAccessToken(prompt !== undefined ? { prompt } : undefined);
        };
        attempt(15);
    });
}

/**
 * Build the Authorization header object for a Bearer token.
 * @param {string} accessToken
 * @returns {{ Authorization: string }}
 */
function authHeader(accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Create a Picker session. Returns the session resource, including
 * `pickerUri` (the Google-hosted picker URL the user must open) and
 * `pollingConfig` (how often / how long to poll).
 *
 * @param {string} accessToken
 * @returns {Promise<{ id: string, pickerUri: string, mediaItemsSet: boolean,
 *                     pollingConfig?: { pollInterval: string, timeoutIn: string },
 *                     expireTime?: string }>}
 */
export async function createPickerSession(accessToken) {
    const res = await fetch(`${PICKER_API_BASE}/sessions`, {
        method:  'POST',
        headers: { ...authHeader(accessToken), 'Content-Type': 'application/json' },
        body:    '{}',
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`createPickerSession ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
}

/**
 * Poll a Picker session once. Caller decides when to stop based on
 * `mediaItemsSet` and the session's `pollingConfig`.
 *
 * @param {string} accessToken
 * @param {string} sessionId
 * @returns {Promise<{ id: string, mediaItemsSet: boolean,
 *                     pollingConfig?: { pollInterval: string, timeoutIn: string } }>}
 */
export async function pollSession(accessToken, sessionId) {
    const res = await fetch(`${PICKER_API_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
        method:  'GET',
        headers: authHeader(accessToken),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`pollSession ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
}

/**
 * List the media items the user picked in a finished session.
 * Handles a single page; real module should follow `nextPageToken`.
 *
 * @param {string} accessToken
 * @param {string} sessionId
 * @returns {Promise<{ mediaItems?: Array<object>, nextPageToken?: string }>}
 */
export async function listPickedItems(accessToken, sessionId) {
    const url = `${PICKER_API_BASE}/mediaItems?sessionId=${encodeURIComponent(sessionId)}`;
    const res = await fetch(url, { method: 'GET', headers: authHeader(accessToken) });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`listPickedItems ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
}

/**
 * THE CORS PROBE. Attempt to download the actual bytes of a picked media
 * item from its `baseUrl`. The Picker docs say `baseUrl` downloads require
 * the `Authorization: Bearer` header — which forces a CORS preflight. This
 * function reveals whether the browser is allowed to read those bytes, or
 * whether a server-side proxy is required.
 *
 * @param {string} accessToken
 * @param {object} mediaItem  A media item from listPickedItems().
 * @returns {Promise<{ ok: boolean, status: number|null, bytes: number|null,
 *                     contentType: string|null, blob: Blob|null, detail: string }>}
 */
export async function downloadMediaBytes(accessToken, mediaItem) {
    const mediaFile = mediaItem?.mediaFile || mediaItem;
    const baseUrl = mediaFile?.baseUrl;
    if (!baseUrl) {
        return { ok: false, status: null, bytes: null, contentType: null, blob: null,
            detail: 'media item has no mediaFile.baseUrl' };
    }
    // `=d` requests the original bytes for download (vs `=w/-h` sized previews).
    const downloadUrl = `${baseUrl}=d`;
    try {
        const res = await fetch(downloadUrl, {
            method:  'GET',
            headers: authHeader(accessToken),
        });
        if (!res.ok) {
            return { ok: false, status: res.status, bytes: null,
                contentType: res.headers.get('content-type'), blob: null,
                detail: `baseUrl download returned HTTP ${res.status}` };
        }
        const blob = await res.blob();
        return {
            ok:          true,
            status:      res.status,
            bytes:       blob.size,
            contentType: res.headers.get('content-type') || blob.type || null,
            blob,
            detail:      `Downloaded ${blob.size} bytes — CORS PERMITS baseUrl downloads from browser JS.`,
        };
    } catch (err) {
        return {
            ok:     false,
            status: null,
            bytes:  null,
            contentType: null,
            blob:   null,
            detail: `fetch() rejected: ${err.message}. CORS likely BLOCKS baseUrl downloads — `
                  + 'the connector would need a server-side proxy for media bytes.',
        };
    }
}
