/**
 * sg-auth-context — singleton auth state for the module graph.
 *
 * Reads from sg-auth-tokens and reacts to sg-auth:* window events.
 * No DOM, no UI — import anywhere.
 *
 * @module sg-auth-context
 * @version 0.1.0
 *
 * @example
 * import { isSignedIn, getUser, getToken, onAuthChange } from '/core/auth-context/v0/v0.1/v0.1.0/sg-auth-context.js';
 *
 * if (isSignedIn()) console.log(getUser().email);
 * const off = onAuthChange(user => console.log('auth changed', user));
 */

import { listTokens, hasValidToken, getToken as _rawToken }
    from '/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';

const _listeners = new Set();

function _notify() {
    const user = getUser();
    _listeners.forEach(fn => fn(user));
}

['sg-auth:signed-in', 'sg-auth:signed-out', 'sg-auth:tokens-cleared',
 'sg-auth:token-saved', 'sg-auth:token-removed'].forEach(evt =>
    window.addEventListener(evt, _notify)
);

/**
 * Returns the primary signed-in user, or null if not authenticated.
 * @returns {{ provider: string, email: string, name: string, picture: string, sub: string, expiresAt: number }|null}
 */
export function getUser() {
    const valid = listTokens().find(t => hasValidToken(t.provider));
    if (!valid) return null;
    return { provider: valid.provider, expiresAt: valid.expiresAt, ...valid.claims };
}

/**
 * Returns a valid token for the given provider, or null if absent/expired.
 * @param {string} [provider='google']
 * @returns {{ idToken: string, claims: Object, expiresAt: number }|null}
 */
export function getToken(provider = 'google') {
    const t = _rawToken(provider);
    if (!t || (t.expiresAt && Date.now() > t.expiresAt)) return null;
    return t;
}

/** @returns {boolean} */
export function isSignedIn() {
    return getUser() !== null;
}

/**
 * Subscribe to auth state changes. Called immediately with current state on subscribe.
 * @param {function} fn  Receives the current user object (or null) on each change.
 * @returns {function}   Unsubscribe — call to stop listening.
 */
export function onAuthChange(fn) {
    _listeners.add(fn);
    fn(getUser()); // immediate call with current state
    return () => _listeners.delete(fn);
}
