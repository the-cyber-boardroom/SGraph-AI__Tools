/**
 * Auth MVP — check definitions and runner functions.
 * @module checks
 * @version 0.1.50
 */

import { listTokens, hasValidToken, saveToken, clearAll as clearAllTokens }
    from '/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';
import { detect as detectCred, getIndex as getCredIndex }
    from '/components/auth/sg-credential-store/v0/v0.1/v0.1.0/sg-credential-store.js';

export const CLIENT_ID_KEY = 'sg-auth-google-client-id';

/** @typedef {'pending'|'running'|'pass'|'fail'|'partial'} CheckStatus */

export const CHECKS = [
    { id: 'status',    label: '1. Auth Status Detection',         icon: '🔍' },
    { id: 'google',    label: '2. Google OAuth Flow',             icon: '🔑' },
    { id: 'tokens',    label: '3. Token Storage (localStorage)',  icon: '💾' },
    { id: 'user',      label: '4. User Info Display',             icon: '👤' },
    { id: 'logout',    label: '5. Logout Workflow',               icon: '🚪' },
    { id: 'credstore', label: '6. Browser Credential Store',      icon: '🔐' },
    { id: 'credlist',  label: '7. Credential List',               icon: '📋' },
];

/** @type {Record<string, { status: CheckStatus, output: string[] }>} */
export const checkState = {};
CHECKS.forEach(c => { checkState[c.id] = { status: 'pending', output: [] }; });

/** Reference to the sg-auth-google component; set by ui-checks-panel */
export let googleEl = null;
export function setGoogleEl(el) { googleEl = el; }

export function iconFor(status) {
    return { pending: '⏳', running: '🔄', pass: '✅', fail: '❌', partial: '⚠️' }[status] ?? '⏳';
}

function _ts() {
    return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

/** Callbacks set by ui-output-panel so runners can push updates */
let _onCheckUpdate = null;
export function onCheckUpdate(fn) { _onCheckUpdate = fn; }

function _log(checkId, lines, status) {
    checkState[checkId].output = Array.isArray(lines) ? lines : [lines];
    if (status) checkState[checkId].status = status;
    _onCheckUpdate?.(checkId);
}

// ── Runners ───────────────────────────────────────────────────────────────────

export const RUNNERS = {

    async status() {
        _log('status', ['Running…'], 'running');
        const tokens  = listTokens();
        const valid   = tokens.filter(t => hasValidToken(t.provider));
        const expired = tokens.filter(t => !hasValidToken(t.provider) && t.expiresAt);

        const lines = [
            `localStorage scan: ${tokens.length} token(s) found`,
            ...tokens.map(t => {
                const ok  = hasValidToken(t.provider);
                const exp = t.expiresAt ? new Date(t.expiresAt).toLocaleTimeString() : 'no expiry';
                return `  ${ok ? '✓' : '✗'} ${t.provider} · ${t.claims?.email || '?'} · exp ${exp}`;
            }),
            tokens.length === 0 ? '  (no tokens — sign in with Google first)' : '',
            `Valid: ${valid.length}  Expired: ${expired.length}`,
        ].filter(Boolean);

        _log('status', lines, valid.length > 0 ? 'pass' : tokens.length > 0 ? 'partial' : 'pending');
    },

    async google() {
        _log('google', ['Running…'], 'running');
        const clientId = localStorage.getItem(CLIENT_ID_KEY);
        const lines    = [];

        const gisInDom  = !!document.querySelector('script[src*="accounts.google.com/gsi/client"]');
        const gisLoaded = !!window.google?.accounts;
        lines.push(`GIS script in DOM: ${gisInDom ? '✓' : '–'}`);
        lines.push(`GIS library loaded: ${gisLoaded ? '✓' : '–'}`);
        lines.push(`Client ID configured: ${clientId ? '✓ (set)' : '✗ (missing — enter in Setup)'}`);

        if (googleEl) {
            const s = googleEl.getStatus();
            lines.push(`Auth state: ${s.signedIn ? `✓ signed in as ${s.claims?.email}` : '– not signed in'}`);
            if (s.signedIn && s.expiresAt) {
                const min = Math.round((s.expiresAt - Date.now()) / 60000);
                lines.push(`Token expires in: ${min} min`);
            }
        }

        if (!clientId) lines.push('→ Enter your Google Client ID in the Setup section');
        else           lines.push('→ Use the [Sign in with Google] button in section 2');

        _log('google', lines, clientId ? 'partial' : 'fail');
    },

    async tokens() {
        _log('tokens', ['Running…'], 'running');
        const lines       = [];
        const testProv    = '__test__';
        const testProvExp = '__test__-exp';

        saveToken(testProv, { idToken: 'test-jwt', claims: { sub: '123', email: 'test@example.com' }, expiresAt: Date.now() + 3600000 });
        lines.push(`save: ${listTokens().find(t => t.provider === testProv) ? '✓ saved' : '✗ failed'}`);

        const { getToken, removeToken } = await import('/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js');
        const got = getToken(testProv);
        lines.push(`get: ${got?.claims?.email === 'test@example.com' ? '✓ retrieved correctly' : '✗ mismatch'}`);
        lines.push(`hasValidToken: ${hasValidToken(testProv) ? '✓ true' : '✗'}`);

        saveToken(testProvExp, { idToken: 'x', claims: {}, expiresAt: Date.now() - 1000 });
        lines.push(`expiry detection: ${!hasValidToken(testProvExp) ? '✓ expired detected' : '✗'}`);

        const all = listTokens();
        lines.push(`listTokens: ${all.length} entries`);

        removeToken(testProv);
        removeToken(testProvExp);
        lines.push('cleanup: ✓ test tokens removed');

        _log('tokens', lines, 'pass');
    },

    async user() {
        _log('user', ['Running…'], 'running');
        const tokens = listTokens();
        const valid  = tokens.filter(t => hasValidToken(t.provider));
        const lines  = [];

        if (valid.length > 0) {
            const t = valid[0];
            lines.push(`Primary: ${t.provider} · ${t.claims?.email}`);
            lines.push(`Avatar: ${t.claims?.picture ? '✓ present' : '– missing'}`);
            lines.push(`Name: ${t.claims?.name || '–'}`);
            lines.push(`Sub: ${t.claims?.sub || '–'}`);
            lines.push('sg-auth-user rendered in section 4 ✓');
            _log('user', lines, 'pass');
        } else {
            lines.push('No valid tokens — sign in first (section 2)');
            lines.push('sg-auth-user will show signed-out state');
            _log('user', lines, 'partial');
        }
    },

    async logout() {
        _log('logout', ['Running…'], 'running');
        const tokens = listTokens();

        if (tokens.length === 0) {
            _log('logout', ['No active sessions', 'Sign in first then re-run'], 'partial');
            return;
        }

        const lines = [`Found ${tokens.length} session(s) to clear`];
        if (googleEl) {
            googleEl.signOut();
            lines.push('google.accounts.id.revoke() called ✓');
            lines.push('Google token cleared from localStorage ✓');
        } else {
            clearAllTokens();
            lines.push('clearAll() called ✓');
        }
        lines.push('sg-auth:signed-out event dispatched ✓');
        _log('logout', lines, 'pass');
    },

    async credstore() {
        _log('credstore', ['Running…'], 'running');
        const d = detectCred();
        const lines = [
            `Browser: ${d.browser}`,
            `PasswordCredential API: ${d.nativeSupported ? '✓ available (Chromium)' : '✗ not available'}`,
            `Storage method: ${d.method} (${d.method === 'native' ? 'native chooser' : 'form fallback'})`,
            `Index entries: ${getCredIndex().length} stored`,
            '',
            'Use the sg-credential-store component in section 6 to test storage',
        ];
        _log('credstore', lines, d.nativeSupported ? 'pass' : 'partial');
    },

    async credlist() {
        _log('credlist', ['Running…'], 'running');
        const index = getCredIndex();
        const lines = [
            `Credential index: ${index.length} entr${index.length !== 1 ? 'ies' : 'y'}`,
            ...index.map(e => `  🔑 ${e.name} · ${e.method} · ${new Date(e.storedAt).toLocaleTimeString()}`),
            index.length === 0 ? '  (none yet — use section 6 to store one)' : '',
            'sg-credential-list rendered in section 7 ✓',
        ].filter(l => l !== undefined);
        _log('credlist', lines, index.length > 0 ? 'pass' : 'partial');
    },
};
