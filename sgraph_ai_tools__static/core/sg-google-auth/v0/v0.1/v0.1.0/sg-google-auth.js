/**
 * sg-google-auth — Google Identity Services OAuth token-client wrapper.
 *
 * Unlike sg-auth-google (which uses google.accounts.id for ID-token
 * sign-in), this module uses google.accounts.oauth2.initTokenClient to
 * obtain an OAuth 2.0 access token for an arbitrary Google API scope —
 * the only browser-side path to People, Photos, Drive, Calendar, etc.
 *
 * Tokens are NOT persisted here. The consumer (a tool) decides whether
 * to keep them in memory only or hand them to sg-auth-tokens.
 *
 * @module sg-google-auth
 * @version 0.1.0
 */

const GIS_URL = 'https://accounts.google.com/gsi/client';
let _gisLoaded  = false;
let _gisLoading = null;

/** @returns {Promise<void>} */
function _loadGis() {
    if (_gisLoaded) return Promise.resolve();
    if (_gisLoading) return _gisLoading;
    _gisLoading = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${GIS_URL}"]`);
        if (existing) {
            if (window.google?.accounts?.oauth2) { _gisLoaded = true; resolve(); return; }
            existing.addEventListener('load',  () => { _gisLoaded = true; resolve(); });
            existing.addEventListener('error', reject);
            return;
        }
        const s = document.createElement('script');
        s.src = GIS_URL; s.async = true; s.defer = true;
        s.onload  = () => { _gisLoaded = true; resolve(); };
        s.onerror = () => reject(new Error('Failed to load Google Identity Services script'));
        document.head.appendChild(s);
    });
    return _gisLoading;
}

/** key → token client. Reusing the same client across requestAccessToken() calls is required by GIS. */
const _clients = new Map();
let _pendingResolve = null;
let _pendingReject  = null;

function _key(clientId, scope) { return `${clientId}|${scope}`; }

function _getOrCreateClient(clientId, scope) {
    const k = _key(clientId, scope);
    if (_clients.has(k)) return _clients.get(k);
    const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope,
        callback: (resp) => {
            const resolve = _pendingResolve, reject = _pendingReject;
            _pendingResolve = _pendingReject = null;
            if (!resolve) return;
            if (resp.error) {
                reject(Object.assign(new Error(resp.error_description || resp.error), {
                    code: 'oauth-error', oauthError: resp.error,
                }));
                return;
            }
            resolve({
                accessToken: resp.access_token,
                expiresAt:   Date.now() + (Number(resp.expires_in) || 3600) * 1000,
                scope:       resp.scope || scope,
                tokenType:   resp.token_type || 'Bearer',
            });
        },
        error_callback: (err) => {
            const reject = _pendingReject;
            _pendingResolve = _pendingReject = null;
            reject?.(Object.assign(new Error(err.message || err.type || 'oauth-error'), {
                code: 'oauth-error', oauthError: err.type,
            }));
        },
    });
    _clients.set(k, client);
    return client;
}

/**
 * Request an OAuth 2.0 access token for a Google API scope.
 *
 * Opens the GIS consent popup on first call (or when prompt='consent').
 * Resolves with the token; rejects if the user dismisses or denies.
 * Throws synchronously with code 'busy' if another request is in flight.
 *
 * @param {object} opts
 * @param {string} opts.clientId           Google OAuth Client ID (Web type).
 * @param {string} opts.scope              Space-separated OAuth scope(s).
 * @param {string} [opts.prompt='']        '', 'none', 'consent', or 'select_account'.
 * @returns {Promise<{accessToken:string, expiresAt:number, scope:string, tokenType:string}>}
 */
export async function requestAccessToken({ clientId, scope, prompt = '' } = {}) {
    if (!clientId) throw Object.assign(new Error('clientId required'), { code: 'invalid-arg' });
    if (!scope)    throw Object.assign(new Error('scope required'),    { code: 'invalid-arg' });
    if (_pendingResolve) throw Object.assign(new Error('Another token request is in flight'), { code: 'busy' });
    await _loadGis();
    const client = _getOrCreateClient(clientId, scope);
    return new Promise((resolve, reject) => {
        _pendingResolve = resolve;
        _pendingReject  = reject;
        try { client.requestAccessToken({ prompt }); }
        catch (e) { _pendingResolve = _pendingReject = null; reject(e); }
    });
}

/**
 * Revoke a previously-issued access token. Best-effort — resolves with
 * `{ ok:true }` whether or not Google confirms (the revoke endpoint
 * returns 200 even for already-invalid tokens).
 *
 * @param {{accessToken:string}} opts
 * @returns {Promise<{ok:true}>}
 */
export async function revokeAccessToken({ accessToken } = {}) {
    if (!accessToken) return { ok: true };
    await _loadGis();
    return new Promise((resolve) => {
        try { google.accounts.oauth2.revoke(accessToken, () => resolve({ ok: true })); }
        catch { resolve({ ok: true }); }
    });
}

/** Convenience: true once the GIS library has loaded. */
export function isGisLoaded() { return _gisLoaded; }
