/**
 * youtube-token-cache.js
 * Thin localStorage adapter for the youtube.upload access token.
 * Lives in the component layer because core modules don't touch storage.
 *
 * Designed so the entire body can be swapped to a vault-backed adapter
 * with the same shape later — keep the function signatures stable.
 *
 * @module youtube-token-cache
 */

import { saveToken, getToken, removeToken }
    from '/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';

const PROVIDER = 'youtube-upload';

/** Treat tokens as expired this many ms early — covers clock skew + flight time. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * @returns {{ accessToken: string, expiresAt: number }|null}
 *          null if missing or expired (with skew).
 */
export function getCachedToken() {
    const t = getToken(PROVIDER);
    if (!t?.accessToken || !t.expiresAt) return null;
    if (Date.now() + EXPIRY_SKEW_MS >= t.expiresAt) return null;
    return { accessToken: t.accessToken, expiresAt: t.expiresAt };
}

/**
 * @param {{ accessToken: string, expiresAt: number, scope?: string }} data
 */
export function setCachedToken(data) {
    saveToken(PROVIDER, {
        accessToken: data.accessToken,
        expiresAt:   data.expiresAt,
        scope:       data.scope || 'https://www.googleapis.com/auth/youtube.upload',
    });
}

export function clearCachedToken() {
    removeToken(PROVIDER);
}

export const YOUTUBE_TOKEN_PROVIDER = PROVIDER;
