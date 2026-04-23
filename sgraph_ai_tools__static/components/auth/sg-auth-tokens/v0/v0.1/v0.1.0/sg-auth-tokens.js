/**
 * sg-auth-tokens — localStorage-based auth token store (MVP stand-in before vault storage).
 *
 * Headless Web Component + named function exports.
 * Stores one token per provider under 'sg-auth-token-{provider}'.
 *
 * @module sg-auth-tokens
 * @version 0.1.0
 */

const LS_PREFIX = 'sg-auth-token-';

/**
 * @typedef {Object} AuthToken
 * @property {string}  provider
 * @property {string}  idToken
 * @property {string}  [accessToken]
 * @property {Object}  claims       parsed JWT payload
 * @property {number}  expiresAt    ms since epoch (from claims.exp * 1000)
 * @property {number}  savedAt      ms since epoch
 */

/** @param {string} provider @returns {string} */
const _key = provider => `${LS_PREFIX}${provider}`;

/**
 * Save a token for a provider.
 * @param {string} provider
 * @param {Partial<AuthToken>} data
 */
function saveToken(provider, data) {
    const entry = { provider, savedAt: Date.now(), ...data };
    try {
        localStorage.setItem(_key(provider), JSON.stringify(entry));
        window.dispatchEvent(new CustomEvent('sg-auth:token-saved', { detail: { provider, entry } }));
    } catch (e) {
        console.warn('[sg-auth-tokens] saveToken failed', e);
    }
}

/**
 * Retrieve stored token for a provider (may be expired).
 * @param {string} provider
 * @returns {AuthToken|null}
 */
function getToken(provider) {
    try {
        const raw = localStorage.getItem(_key(provider));
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

/**
 * True if token exists and has not expired.
 * @param {string} provider
 * @returns {boolean}
 */
function hasValidToken(provider) {
    const t = getToken(provider);
    if (!t) return false;
    if (!t.expiresAt) return true;
    return Date.now() < t.expiresAt;
}

/**
 * Remove stored token for a provider.
 * @param {string} provider
 */
function removeToken(provider) {
    localStorage.removeItem(_key(provider));
    window.dispatchEvent(new CustomEvent('sg-auth:token-removed', { detail: { provider } }));
}

/**
 * List all stored tokens (valid ones first).
 * @returns {AuthToken[]}
 */
function listTokens() {
    const tokens = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(LS_PREFIX)) continue;
        try {
            const t = JSON.parse(localStorage.getItem(k));
            if (t) tokens.push(t);
        } catch { /* skip corrupt entries */ }
    }
    tokens.sort((a, b) => {
        const aValid = !a.expiresAt || Date.now() < a.expiresAt;
        const bValid = !b.expiresAt || Date.now() < b.expiresAt;
        if (aValid !== bValid) return aValid ? -1 : 1;
        return (b.savedAt || 0) - (a.savedAt || 0);
    });
    return tokens;
}

/** Remove all stored auth tokens. */
function clearAll() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(LS_PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    window.dispatchEvent(new CustomEvent('sg-auth:tokens-cleared'));
}

/**
 * SgAuthTokens — headless Web Component wrapping the token store.
 *
 * Usage:
 *   <sg-auth-tokens id="tok"></sg-auth-tokens>
 *   document.getElementById('tok').saveToken('google', { idToken, claims, expiresAt });
 */
export class SgAuthTokens extends HTMLElement {
    saveToken(provider, data) { saveToken(provider, data); }
    getToken(provider)        { return getToken(provider); }
    hasValidToken(provider)   { return hasValidToken(provider); }
    removeToken(provider)     { removeToken(provider); }
    listTokens()              { return listTokens(); }
    clearAll()                { clearAll(); }
}

customElements.define('sg-auth-tokens', SgAuthTokens);

export { saveToken, getToken, hasValidToken, removeToken, listTokens, clearAll };
