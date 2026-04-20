/**
 * sg-auth-google — Google Identity Services (GIS) OAuth wrapper.
 *
 * Handles sign-in via One Tap + button, token storage, sign-out/revoke.
 * Dispatches window events on auth state change.
 * Stores token in localStorage via sg-auth-tokens pattern.
 *
 * Requires a Google OAuth Client ID configured for the page's origin.
 * Get one at: https://console.cloud.google.com/apis/credentials
 *
 * @module sg-auth-google
 * @version 0.1.0
 */

import { saveToken, getToken, removeToken } from '../../../../sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';

const GIS_URL      = 'https://accounts.google.com/gsi/client';
const PROVIDER     = 'google';
let _gisLoaded     = false;
let _gisLoading    = null;

function _loadGis() {
    if (_gisLoaded) return Promise.resolve();
    if (_gisLoading) return _gisLoading;
    _gisLoading = new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${GIS_URL}"]`)) {
            // Already in DOM — wait for load or resolve if google already exists
            if (window.google?.accounts) { _gisLoaded = true; resolve(); return; }
            const existing = document.querySelector(`script[src="${GIS_URL}"]`);
            existing.addEventListener('load', () => { _gisLoaded = true; resolve(); });
            existing.addEventListener('error', reject);
            return;
        }
        const s = document.createElement('script');
        s.src   = GIS_URL;
        s.async = true;
        s.defer = true;
        s.onload  = () => { _gisLoaded = true; resolve(); };
        s.onerror = () => reject(new Error('Failed to load Google Identity Services script'));
        document.head.appendChild(s);
    });
    return _gisLoading;
}

/**
 * Decode a JWT payload without verifying the signature.
 * Safe client-side because we trust the GIS callback directly.
 * @param {string} token
 * @returns {Object}
 */
function parseJwt(token) {
    try {
        const [, payload] = token.split('.');
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(padded));
    } catch {
        return {};
    }
}

const _CSS = `
:host { display: block; font-family: system-ui, sans-serif; }
.wrap { padding: 10px 0; }
.signed-in  { display: flex; align-items: center; gap: 10px; }
.avatar     { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid #4ecdc4; }
.avatar-ph  { width: 36px; height: 36px; border-radius: 50%; background: #1a1a3a; border: 2px solid #2d3748; display: flex; align-items: center; justify-content: center; color: #4a5568; font-size: 16px; }
.info       { flex: 1; }
.name       { font-size: 13px; font-weight: 600; color: #e2e8f0; }
.email      { font-size: 11px; color: #718096; }
.badge      { font-size: 10px; padding: 1px 6px; border-radius: 10px; background: rgba(78,205,196,.15); color: #4ecdc4; font-weight: 700; text-transform: uppercase; }
.btn-out    { font-size: 11px; padding: 4px 10px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #718096; cursor: pointer; font-family: inherit; }
.btn-out:hover { border-color: #4ecdc4; color: #4ecdc4; }
.status-row { font-size: 11px; color: #718096; margin-top: 4px; }
.status-row .ok  { color: #4ecdc4; }
.status-row .exp { color: #ed8936; }
#g-btn-container { min-height: 44px; }
`;

/**
 * SgAuthGoogle — Web Component for Google OAuth sign-in/sign-out.
 *
 * @example
 * <sg-auth-google client-id="YOUR_CLIENT_ID.apps.googleusercontent.com" auto-prompt></sg-auth-google>
 */
export class SgAuthGoogle extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._initialized = false;
    }

    static get observedAttributes() { return ['client-id']; }

    connectedCallback() {
        this._render();
        if (this.hasAttribute('auto-prompt')) this.initialize();
    }

    attributeChangedCallback(name, old, val) {
        if (name === 'client-id' && val && val !== old) this.initialize();
    }

    /** @returns {string|null} */
    get clientId() { return this.getAttribute('client-id'); }

    /**
     * Load GIS and initialise with the given or attribute client ID.
     * @param {string} [clientId]
     * @returns {Promise<void>}
     */
    async initialize(clientId) {
        if (clientId) this.setAttribute('client-id', clientId);
        const id = this.getAttribute('client-id');
        if (!id) { this._setStatus('No client-id set'); return; }

        try {
            this._setStatus('Loading GIS…');
            await _loadGis();
            google.accounts.id.initialize({
                client_id: id,
                callback:  r => this._onCredential(r),
                auto_select: false,
                cancel_on_tap_outside: true,
            });
            this._initialized = true;
            this._renderButton();
            this._render();
        } catch (e) {
            this._setStatus(`GIS load failed: ${e.message}`);
            window.dispatchEvent(new CustomEvent('sg-auth:error', { detail: { provider: PROVIDER, message: e.message } }));
        }
    }

    /** Show the One Tap prompt. */
    signIn() {
        if (!this._initialized) { this.initialize(); return; }
        google.accounts.id.prompt(n => {
            if (n.isNotDisplayed() || n.isSkippedMoment()) {
                // Fall back to button flow — the button container is already rendered
                this._setStatus('Use the Sign In button below');
            }
        });
    }

    /** Revoke Google token, clear localStorage, dispatch signed-out event. */
    signOut() {
        const token = getToken(PROVIDER);
        const doSignOut = () => {
            removeToken(PROVIDER);
            if (window.google?.accounts?.id) {
                google.accounts.id.disableAutoSelect();
            }
            window.dispatchEvent(new CustomEvent('sg-auth:signed-out', { detail: { provider: PROVIDER } }));
            this._render();
        };
        if (token?.claims?.email && window.google?.accounts?.id) {
            google.accounts.id.revoke(token.claims.email, () => doSignOut());
        } else {
            doSignOut();
        }
    }

    /**
     * Current auth status.
     * @returns {{ signedIn: boolean, expired?: boolean, provider?: string, claims?: Object, expiresAt?: number }}
     */
    getStatus() {
        const token = getToken(PROVIDER);
        if (!token) return { signedIn: false };
        const expired = token.expiresAt && Date.now() > token.expiresAt;
        return {
            signedIn: !expired,
            expired:  !!expired,
            provider: PROVIDER,
            claims:   token.claims,
            expiresAt: token.expiresAt,
            idToken:  token.idToken,
        };
    }

    _onCredential(response) {
        const claims    = parseJwt(response.credential);
        const tokenData = {
            idToken:   response.credential,
            claims,
            expiresAt: claims.exp ? claims.exp * 1000 : null,
        };
        saveToken(PROVIDER, tokenData);
        window.dispatchEvent(new CustomEvent('sg-auth:signed-in', {
            detail: { provider: PROVIDER, claims, idToken: response.credential },
        }));
        this._render();
    }

    _renderButton() {
        if (!this._initialized) return;
        const container = this.shadowRoot.querySelector('#g-btn-container');
        if (!container) return;
        try {
            google.accounts.id.renderButton(container, {
                theme: 'outline', size: 'large', text: 'sign_in_with',
                shape: 'rectangular', logo_alignment: 'left',
            });
        } catch { /* GIS not ready yet */ }
    }

    _setStatus(msg) {
        const el = this.shadowRoot.querySelector('.status-row');
        if (el) el.textContent = msg;
    }

    _render() {
        const status = this.getStatus();
        const sr = this.shadowRoot;
        sr.innerHTML = `<style>${_CSS}</style><div class="wrap"></div>`;
        const wrap = sr.querySelector('.wrap');

        if (status.signedIn && status.claims) {
            const { claims } = status;
            const expiryMs  = status.expiresAt ? status.expiresAt - Date.now() : null;
            const expiryMin = expiryMs ? Math.round(expiryMs / 60000) : null;
            const expStr    = expiryMin != null
                ? (expiryMin > 0 ? `<span class="ok">expires in ${expiryMin} min</span>`
                                 : `<span class="exp">expired ${Math.abs(expiryMin)} min ago</span>`)
                : '';
            wrap.innerHTML = `
                <div class="signed-in">
                    ${claims.picture
                        ? `<img class="avatar" src="${claims.picture}" alt="">`
                        : `<div class="avatar-ph">👤</div>`}
                    <div class="info">
                        <div class="name">${claims.name || claims.email || 'Google user'}</div>
                        <div class="email">${claims.email || ''}</div>
                    </div>
                    <span class="badge">Google</span>
                    <button class="btn-out" id="signout-btn">Sign out</button>
                </div>
                <div class="status-row">${expStr}</div>
            `;
            sr.querySelector('#signout-btn')?.addEventListener('click', () => this.signOut());
        } else {
            wrap.innerHTML = `
                <div id="g-btn-container"></div>
                <div class="status-row">${status.expired ? '<span class="exp">Session expired</span>' : 'Not signed in'}</div>
            `;
            if (this._initialized) this._renderButton();
        }
    }
}

customElements.define('sg-auth-google', SgAuthGoogle);

export { parseJwt, PROVIDER as GOOGLE_PROVIDER };
