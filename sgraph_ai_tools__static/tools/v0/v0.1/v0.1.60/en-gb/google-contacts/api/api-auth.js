/**
 * api-auth — sign-in / sign-out methods for google-contacts.
 *
 * Wraps sg-google-auth (which wraps GIS initTokenClient) and stores the
 * resulting access token in tool state. The token lives in memory only
 * — it is NOT persisted to localStorage.
 *
 * @module google-contacts/api-auth
 */

import { requestAccessToken, revokeAccessToken }
    from '/core/sg-google-auth/v0/v0.1/v0.1.0/sg-google-auth.js';
import { GC_EVENTS } from './google-contacts-events.js';

/** Scope required to read the user's saved contacts. */
export const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';

/**
 * @param {{state: object, emit: function}} deps
 */
export function buildAuthMethods({ state, emit }) {
    /**
     * Persist a Google OAuth Client ID so signIn() knows which app to use.
     * The client ID is public — embedding it is fine, the OAuth server
     * still requires the consent screen and the registered origin.
     */
    async function connect({ clientId } = {}) {
        const id = (clientId || '').trim();
        if (!id) throw Object.assign(new Error('clientId required'), { code: 'invalid-arg' });
        if (!/\.apps\.googleusercontent\.com$/.test(id)) {
            throw Object.assign(
                new Error('clientId must end with .apps.googleusercontent.com'),
                { code: 'invalid-arg' },
            );
        }
        state.mutate({ clientId: id, error: null });
        emit(GC_EVENTS.AUTH_CONNECTED, { clientId: id });
        return { ok: true, clientId: id };
    }

    /**
     * Trigger the GIS consent popup and store the resulting access token.
     */
    async function signIn({ prompt = '' } = {}) {
        const { clientId } = state.snapshot();
        if (!clientId) throw Object.assign(new Error('Call connect({ clientId }) first'), { code: 'not-connected' });
        try {
            const tok = await requestAccessToken({ clientId, scope: CONTACTS_SCOPE, prompt });
            state.mutate({
                accessToken:    tok.accessToken,
                tokenExpiresAt: tok.expiresAt,
                signedIn:       true,
                error:          null,
            });
            emit(GC_EVENTS.AUTH_SIGNED_IN, { expiresAt: tok.expiresAt, scope: tok.scope });
            return { ok: true, expiresAt: tok.expiresAt, scope: tok.scope };
        } catch (e) {
            state.mutate({ error: e.message });
            emit(GC_EVENTS.AUTH_ERROR, { message: e.message, code: e.code || null });
            throw e;
        }
    }

    /**
     * Revoke the current access token and clear it from state.
     * Contacts already loaded into memory are also cleared.
     */
    async function signOut() {
        const { accessToken } = state.snapshot();
        if (accessToken) {
            try { await revokeAccessToken({ accessToken }); } catch { /* ignore */ }
        }
        state.mutate({
            accessToken:    null,
            tokenExpiresAt: null,
            signedIn:       false,
            contacts:       [],
            selectedId:     null,
            loadProgress:   null,
        });
        emit(GC_EVENTS.AUTH_SIGNED_OUT, {});
        return { ok: true };
    }

    function getAuthStatus() {
        const s = state.snapshot();
        return {
            connected:      !!s.clientId,
            clientId:       s.clientId || null,
            signedIn:       s.signedIn,
            expiresAt:      s.tokenExpiresAt,
            expiresInMin:   s.tokenExpiresAt ? Math.round((s.tokenExpiresAt - Date.now()) / 60000) : null,
            scope:          CONTACTS_SCOPE,
        };
    }

    return { connect, signIn, signOut, getAuthStatus };
}
