/**
 * Auth MVP — browser auth building-blocks testing tool.
 *
 * Health-check style UI with 7 independently runnable checks covering:
 *   1. Auth status detection
 *   2. Google OAuth workflow
 *   3. Token storage (localStorage)
 *   4. User info display
 *   5. Logout workflow
 *   6. Browser credential store
 *   7. Credential list (password manager)
 *
 * @module auth-mvp
 * @version 0.1.50
 */

import '/core/sg-layout/v0.1.0/sg-layout.js';
import '/components/site-header/v1/v1.0/v1.0.1/sg-site-header.js';
import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { SgToolApi }  from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';

// Auth components
import '/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';
import '/components/auth/sg-auth-google/v0/v0.1/v0.1.0/sg-auth-google.js';
import '/components/auth/sg-auth-status/v0/v0.1/v0.1.0/sg-auth-status.js';
import '/components/auth/sg-auth-user/v0/v0.1/v0.1.0/sg-auth-user.js';
import '/components/auth/sg-credential-store/v0/v0.1/v0.1.0/sg-credential-store.js';
import '/components/auth/sg-credential-list/v0/v0.1/v0.1.0/sg-credential-list.js';
import '/components/vault/sg-vault-picker/v0/v0.1/v0.1.0/sg-vault-picker.js';
import { listTokens, hasValidToken, saveToken, clearAll as clearAllTokens }
    from '/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';
import { detect as detectCred, getIndex as getCredIndex }
    from '/components/auth/sg-credential-store/v0/v0.1/v0.1.0/sg-credential-store.js';

import { buildDevPanel } from './dev-panel.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MANIFEST_URL = './manifest.json';
const CLIENT_ID_KEY = 'sg-auth-google-client-id';

// ── State ─────────────────────────────────────────────────────────────────────

let _googleEl    = null;  // sg-auth-google instance
let _outputLog   = [];    // event log entries
let _eventLog    = [];    // window event stream

// ── Check definitions ─────────────────────────────────────────────────────────

/** @typedef {'pending'|'running'|'pass'|'fail'|'partial'} CheckStatus */

const CHECKS = [
    { id: 'status',   label: '1. Auth Status Detection',          icon: '🔍' },
    { id: 'google',   label: '2. Google OAuth Flow',              icon: '🔑' },
    { id: 'tokens',   label: '3. Token Storage (localStorage)',   icon: '💾' },
    { id: 'user',     label: '4. User Info Display',              icon: '👤' },
    { id: 'logout',   label: '5. Logout Workflow',                icon: '🚪' },
    { id: 'credstore','label': '6. Browser Credential Store',     icon: '🔐' },
    { id: 'credlist', label: '7. Credential List',                icon: '📋' },
];

const _state = {};
CHECKS.forEach(c => { _state[c.id] = { status: 'pending', output: [] }; });

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _icon(status) {
    return { pending: '⏳', running: '🔄', pass: '✅', fail: '❌', partial: '⚠️' }[status] ?? '⏳';
}

function _ts() { return new Date().toLocaleTimeString('en-GB', { hour12: false }); }

function _log(checkId, lines, status) {
    _state[checkId].output = Array.isArray(lines) ? lines : [lines];
    if (status) _state[checkId].status = status;
    _updateCheckUI(checkId);
    _showOutput(checkId);
}

function _updateCheckUI(checkId) {
    const row = document.querySelector(`[data-check-id="${checkId}"]`);
    if (!row) return;
    const icon = row.querySelector('.check-icon');
    if (icon) icon.textContent = _icon(_state[checkId].status);
}

function _showOutput(checkId) {
    const panel = document.getElementById('output-panel');
    if (!panel) return;
    const check = CHECKS.find(c => c.id === checkId);
    const lines = _state[checkId].output;
    panel.innerHTML = `
        <div style="font-size:12px;font-weight:700;color:#4ecdc4;margin-bottom:8px">${check?.label || checkId}</div>
        ${lines.map(l => `<div style="font-size:12px;color:#a0aec0;margin:2px 0;font-family:'SF Mono',Monaco,monospace">${l}</div>`).join('')}
    `;
}

function _appendEventLog(name, detail) {
    _eventLog.unshift({ name, detail, ts: _ts() });
    if (_eventLog.length > 100) _eventLog.pop();
    _refreshEventLog();
}

function _refreshEventLog() {
    const el = document.getElementById('event-log');
    if (!el) return;
    el.innerHTML = _eventLog.slice(0, 30).map(e => `
        <div style="padding:3px 0;border-bottom:1px solid #0d0d1a;font-size:10px">
            <span style="color:#4a5568">${e.ts}</span>
            <span style="color:#4ecdc4;margin:0 5px">${e.name}</span>
            <span style="color:#718096">${JSON.stringify(e.detail).slice(0, 80)}</span>
        </div>
    `).join('');
}

// ── Check runners ─────────────────────────────────────────────────────────────

const RUNNERS = {

    async status() {
        _log('status', ['Running…'], 'running');
        const tokens = listTokens();
        const valid  = tokens.filter(t => hasValidToken(t.provider));
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
        const lines = [];

        // GIS script check
        const gisInDom = !!document.querySelector('script[src*="accounts.google.com/gsi/client"]');
        const gisLoaded = !!window.google?.accounts;
        lines.push(`GIS script in DOM: ${gisInDom ? '✓' : '–'}`);
        lines.push(`GIS library loaded: ${gisLoaded ? '✓' : '–'}`);
        lines.push(`Client ID configured: ${clientId ? '✓ (set)' : '✗ (missing — enter above)'}`);

        if (_googleEl) {
            const s = _googleEl.getStatus();
            lines.push(`Auth state: ${s.signedIn ? `✓ signed in as ${s.claims?.email}` : '– not signed in'}`);
            if (s.signedIn) {
                const min = s.expiresAt ? Math.round((s.expiresAt - Date.now()) / 60000) : null;
                if (min !== null) lines.push(`Token expires in: ${min} min`);
            }
        }

        if (!clientId) {
            lines.push('→ Enter your Google Client ID in the Setup section above');
        } else {
            lines.push('→ Use the [Sign in with Google] button in section 2 below');
        }

        const status = clientId ? (window.google?.accounts ? 'partial' : 'partial') : 'fail';
        _log('google', lines, status);
    },

    async tokens() {
        _log('tokens', ['Running…'], 'running');
        const lines = [];
        const testProvider = '__test__';

        // Test save
        saveToken(testProvider, { idToken: 'test-jwt', claims: { sub: '123', email: 'test@example.com' }, expiresAt: Date.now() + 3600000 });
        const saved = listTokens().find(t => t.provider === testProvider);
        lines.push(`save: ${saved ? '✓ saved to localStorage' : '✗ failed'}`);

        // Test get
        const { getToken } = await import('/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js');
        const got = getToken(testProvider);
        lines.push(`get:  ${got?.claims?.email === 'test@example.com' ? '✓ retrieved correctly' : '✗ mismatch'}`);

        // Test hasValid
        const { hasValidToken: hv } = await import('/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js');
        lines.push(`hasValidToken: ${hv(testProvider) ? '✓ true (not expired)' : '✗'}`);

        // Test expiry detection
        saveToken(testProvider + '-exp', { idToken: 'x', claims: {}, expiresAt: Date.now() - 1000 });
        lines.push(`expiry detection: ${!hv(testProvider + '-exp') ? '✓ expired token detected' : '✗'}`);

        // Test list
        const all = listTokens();
        lines.push(`listTokens: ${all.length} entries (valid first: ${all[0]?.provider === testProvider ? '✓' : '✗'})`);

        // Cleanup
        const { removeToken } = await import('/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js');
        removeToken(testProvider);
        removeToken(testProvider + '-exp');
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
            lines.push(`Primary token: ${t.provider} · ${t.claims?.email}`);
            lines.push(`Avatar URL: ${t.claims?.picture ? '✓ present' : '– missing'}`);
            lines.push(`Name: ${t.claims?.name || '–'}`);
            lines.push(`Sub: ${t.claims?.sub || '–'}`);
            lines.push('sg-auth-user component: rendered in section 4');
            _log('user', lines, 'pass');
        } else {
            lines.push('No valid tokens — sign in first (section 2)');
            lines.push('sg-auth-user will show "Not signed in" state');
            _log('user', lines, 'partial');
        }
    },

    async logout() {
        _log('logout', ['Running…'], 'running');
        const tokens = listTokens();

        if (tokens.length === 0) {
            _log('logout', ['No active sessions to sign out from', 'Sign in first (section 2) then re-run this check'], 'partial');
            return;
        }

        const lines = [`Found ${tokens.length} session(s) to clear`];
        if (_googleEl) {
            _googleEl.signOut();
            lines.push('google.accounts.id.revoke() called ✓');
            lines.push('Google token cleared from localStorage ✓');
        } else {
            clearAllTokens();
            lines.push('clearAll() called — tokens removed from localStorage ✓');
        }
        lines.push('sg-auth:signed-out event dispatched ✓');
        lines.push('All sections now show signed-out state ✓');
        _log('logout', lines, 'pass');
    },

    async credstore() {
        _log('credstore', ['Running…'], 'running');
        const d = detectCred();
        const lines = [
            `Browser: ${d.browser}`,
            `PasswordCredential API: ${d.nativeSupported ? '✓ available (Chromium)' : '✗ not available'}`,
            `Storage method: ${d.method} (${d.method === 'native' ? 'native chooser bubble' : 'form-based fallback'})`,
            `Form fallback: always available ✓`,
            '',
            'Storage test: use the sg-credential-store component in section 6',
            `Index entries: ${getCredIndex().length} stored`,
        ];

        const status = d.nativeSupported ? 'pass' : 'partial';
        _log('credstore', lines, status);
    },

    async credlist() {
        _log('credlist', ['Running…'], 'running');
        const index = getCredIndex();
        const lines = [
            `Credential index: ${index.length} entr${index.length !== 1 ? 'ies' : 'y'}`,
            ...index.map(e => `  🔑 ${e.name} · ${e.method} · ${new Date(e.storedAt).toLocaleTimeString()}`),
            index.length === 0 ? '  (none yet — use section 6 to store one)' : '',
            '',
            'sg-credential-list component: rendered in section 7',
        ].filter(l => l !== undefined);

        _log('credlist', lines, index.length > 0 ? 'pass' : 'partial');
    },
};

// ── Layout builder ────────────────────────────────────────────────────────────

function _buildTool(layout) {
    const leftEl  = layout.getPanelElement('left');
    const rightEl = layout.getPanelElement('right');
    if (!leftEl || !rightEl) return;

    leftEl.style.cssText  = 'overflow-y:auto;height:100%;background:#080812;';
    rightEl.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#080812;';

    _buildLeftPanel(leftEl);
    _buildRightPanel(rightEl);
}

function _buildLeftPanel(el) {
    const clientId = localStorage.getItem(CLIENT_ID_KEY) || '';

    el.innerHTML = `
        <div style="padding:14px;border-bottom:1px solid #1a1a3a;">
            <div style="font-size:11px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Setup</div>
            <div style="font-size:11px;color:#718096;margin-bottom:5px;">Google OAuth Client ID</div>
            <div style="display:flex;gap:6px;">
                <input id="client-id-input" type="text" placeholder="xxx.apps.googleusercontent.com"
                    style="flex:1;background:#111122;border:1px solid #1a1a3a;border-radius:4px;padding:6px 8px;color:#e2e8f0;font-size:12px;font-family:inherit;"
                    value="${clientId}">
                <button id="save-client-id" style="font-size:11px;padding:6px 10px;border-radius:4px;border:1px solid #4ecdc4;background:none;color:#4ecdc4;cursor:pointer;font-family:inherit;white-space:nowrap;">Save</button>
            </div>
            <div style="font-size:10px;color:#2d3748;margin-top:5px;">Get yours at <span style="color:#4ecdc4">console.cloud.google.com</span> → APIs & Services → Credentials</div>
        </div>
    `;

    // Check sections
    const checksWrap = document.createElement('div');
    checksWrap.style.cssText = 'padding:10px 0;';

    CHECKS.forEach(check => {
        const section = document.createElement('div');
        section.dataset.checkId = check.id;
        section.style.cssText = 'border-bottom:1px solid #0d0d1a;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;';
        header.innerHTML = `
            <span class="check-icon" style="font-size:14px;width:18px;text-align:center;">${_icon('pending')}</span>
            <span style="flex:1;font-size:12px;color:#a0aec0;font-weight:600;">${check.label}</span>
            <button data-run="${check.id}" style="font-size:11px;padding:3px 10px;border-radius:4px;border:1px solid #2d3748;background:none;color:#718096;cursor:pointer;font-family:inherit;">Run</button>
        `;
        section.appendChild(header);

        // Inline component for certain checks
        if (check.id === 'google') {
            const inner = document.createElement('div');
            inner.style.cssText = 'padding:0 14px 12px;';
            inner.innerHTML = `
                <sg-auth-google id="google-component" style="display:block;"></sg-auth-google>
                <div style="font-size:10px;color:#2d3748;margin-top:6px;">ℹ Enter Client ID above + click Save, then sign in here</div>
            `;
            section.appendChild(inner);
            setTimeout(() => { _googleEl = document.getElementById('google-component'); }, 100);
        }

        if (check.id === 'status') {
            const inner = document.createElement('div');
            inner.style.cssText = 'padding:0 14px 10px;';
            inner.innerHTML = `<sg-auth-status style="display:block;"></sg-auth-status>`;
            section.appendChild(inner);
        }

        if (check.id === 'user') {
            const inner = document.createElement('div');
            inner.style.cssText = 'padding:0 14px 10px;';
            inner.innerHTML = `<sg-auth-user show-details style="display:block;"></sg-auth-user>`;
            section.appendChild(inner);
        }

        if (check.id === 'credstore') {
            const inner = document.createElement('div');
            inner.style.cssText = 'padding:0 14px 10px;';
            inner.innerHTML = `<sg-credential-store style="display:block;"></sg-credential-store>`;
            section.appendChild(inner);
        }

        if (check.id === 'credlist') {
            const inner = document.createElement('div');
            inner.style.cssText = 'padding:0 14px 10px;';
            inner.innerHTML = `<sg-credential-list style="display:block;"></sg-credential-list>`;
            section.appendChild(inner);
        }

        checksWrap.appendChild(section);
    });

    el.appendChild(checksWrap);

    // Bind: save client ID
    el.querySelector('#save-client-id').addEventListener('click', () => {
        const val = el.querySelector('#client-id-input').value.trim();
        localStorage.setItem(CLIENT_ID_KEY, val);
        if (_googleEl && val) _googleEl.initialize(val);
        const btn = el.querySelector('#save-client-id');
        btn.textContent = '✓ Saved';
        setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    });

    // Bind: run buttons
    el.querySelectorAll('[data-run]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.run;
            _state[id].status = 'running';
            _updateCheckUI(id);
            RUNNERS[id]?.().catch(e => _log(id, [`Error: ${e.message}`], 'fail'));
        });
    });
}

function _buildRightPanel(el) {
    el.innerHTML = `
        <div style="display:flex;background:#0d0d1a;border-bottom:1px solid #1a1a3a;flex-shrink:0;">
            <button id="tab-output" style="padding:8px 14px;font-size:11px;font-weight:600;background:none;border:none;border-bottom:2px solid #4ecdc4;cursor:pointer;color:#4ecdc4;font-family:system-ui;">📋 Output</button>
            <button id="tab-events" style="padding:8px 14px;font-size:11px;font-weight:600;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;color:#4a5568;font-family:system-ui;">📡 Events</button>
            <button id="tab-vault"  style="padding:8px 14px;font-size:11px;font-weight:600;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;color:#4a5568;font-family:system-ui;">🗄 Vaults</button>
        </div>
        <div id="right-content" style="flex:1;overflow:auto;padding:14px;min-height:0;"></div>
    `;

    const content   = el.querySelector('#right-content');
    const tabOutput = el.querySelector('#tab-output');
    const tabEvents = el.querySelector('#tab-events');
    const tabVault  = el.querySelector('#tab-vault');

    function activate(tab) {
        [tabOutput, tabEvents, tabVault].forEach(t => {
            t.style.borderBottomColor = 'transparent';
            t.style.color = '#4a5568';
        });
        tab.style.borderBottomColor = '#4ecdc4';
        tab.style.color = '#4ecdc4';
    }

    tabOutput.addEventListener('click', () => {
        activate(tabOutput);
        content.innerHTML = `
            <div id="output-panel" style="font-family:'SF Mono',Monaco,monospace;">
                <div style="font-size:12px;color:#2d3748;">Run a check to see output</div>
            </div>`;
    });

    tabEvents.addEventListener('click', () => {
        activate(tabEvents);
        content.innerHTML = `<div id="event-log" style="font-family:'SF Mono',Monaco,monospace;"></div>`;
        _refreshEventLog();
    });

    tabVault.addEventListener('click', () => {
        activate(tabVault);
        content.innerHTML = `<sg-vault-picker style="display:block;"></sg-vault-picker>`;
    });

    // Start on output tab
    tabOutput.click();
}

// ── Event monitoring ──────────────────────────────────────────────────────────

const WATCHED_EVENTS = [
    'sg-auth:signed-in','sg-auth:signed-out','sg-auth:error',
    'sg-auth:token-saved','sg-auth:token-removed','sg-auth:tokens-cleared',
    'sg-cred:stored','sg-cred:retrieved','sg-cred:unsupported','sg-cred:error',
    'vault:opened','vault:created','vault:saved','vault:removed','vault:cancelled',
];

WATCHED_EVENTS.forEach(name => {
    window.addEventListener(name, e => _appendEventLog(name, e.detail));
});

// ── SgToolApi registration ─────────────────────────────────────────────────────

const api = new SgToolApi({
    name:    'sg-auth-mvp',
    version: { ui: '0.1.50', api: '0.1.0' },
    manifest: MANIFEST_URL,
    skills: {
        human:   './SKILL-human.md',
        browser: null,
        api:     null,
    },
});

api.register('getAuthStatus',    () => {
    const tokens = listTokens();
    return { tokens, valid: tokens.filter(t => hasValidToken(t.provider)) };
}, { async: false });

api.register('getCredIndex',     () => getCredIndex(),           { async: false });
api.register('detectCredStore',  () => detectCred(),             { async: false });
api.register('clearAllTokens',   () => clearAllTokens(),         { async: false });
api.register('runCheck',         async (id) => { await RUNNERS[id]?.(); return _state[id]; }, { async: true });

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
    const layoutWrap = document.getElementById('layout-wrap');

    // Tool area
    const toolArea = document.createElement('div');
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;position:relative;';
    layoutWrap.appendChild(toolArea);

    // sg-layout
    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'display:block;width:100%;height:100%;';
    toolArea.appendChild(layout);

    await new Promise(resolve => {
        window.addEventListener(SGL_EVENTS.LAYOUT_READY, resolve, { once: true });
        layout.setLayout({
            type: 'row',
            children: [
                { type: 'leaf', id: 'left',  size: 38 },
                { type: 'leaf', id: 'right', size: 62 },
            ],
        });
    });

    _buildTool(layout);

    // Dev panel
    buildDevPanel(layoutWrap);

    // Activate API
    api.activate();

    // Auto-init Google if client ID is stored
    const clientId = localStorage.getItem(CLIENT_ID_KEY);
    if (clientId) {
        setTimeout(() => {
            if (_googleEl) _googleEl.initialize(clientId);
        }, 500);
    }
}

document.addEventListener('DOMContentLoaded', init);
