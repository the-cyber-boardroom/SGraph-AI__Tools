/**
 * Auth MVP — SgToolApi registration.
 * @module auth-api
 * @version 0.1.50
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { listTokens, hasValidToken, clearAll as clearAllTokens }
    from '/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';
import { detect as detectCred, getIndex as getCredIndex }
    from '/components/auth/sg-credential-store/v0/v0.1/v0.1.0/sg-credential-store.js';
import { checkState, RUNNERS } from './checks.js';

export const api = new SgToolApi({
    name:     'sg-auth-mvp',
    version:  { api: '0.1.0', ui: '0.1.50' },
    manifest: '../manifest.json',
    skills:   { human: '../SKILL-human.md' },
});

api.register('getAuthStatus', () => {
    const tokens = listTokens();
    return {
        tokens,
        valid:    tokens.filter(t => hasValidToken(t.provider)),
        signedIn: tokens.some(t => hasValidToken(t.provider)),
    };
}, { async: false });

api.register('getCredIndex',    () => getCredIndex(),   { async: false });
api.register('detectCredStore', () => detectCred(),     { async: false });
api.register('clearAllTokens',  () => clearAllTokens(), { async: false });

api.register('runCheck', async (id) => {
    if (!RUNNERS[id]) throw new Error(`Unknown check id: ${id}`);
    await RUNNERS[id]();
    return checkState[id];
}, { async: true });
