/**
 * sg-auth-status — visual auth state indicator.
 *
 * Reads localStorage via sg-auth-tokens pattern.
 * Re-renders on sg-auth:signed-in / sg-auth:signed-out events.
 *
 * @module sg-auth-status
 * @version 0.1.0
 */

import { listTokens, hasValidToken } from '../../../sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';

const _CSS = `
:host { display: inline-block; font-family: system-ui, sans-serif; }
.badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em;
}
.dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.state-out  { background: rgba(74,85,104,.2); color: #718096; }
.state-out .dot  { background: #4a5568; }
.state-in   { background: rgba(78,205,196,.15); color: #4ecdc4; }
.state-in .dot   { background: #4ecdc4; }
.state-exp  { background: rgba(237,137,54,.15); color: #ed8936; }
.state-exp .dot  { background: #ed8936; }

/* compact: just a dot */
:host([compact]) .label { display: none; }
:host([compact]) .badge { padding: 0; background: none; }
:host([compact]) .dot   { width: 8px; height: 8px; }
`;

/**
 * SgAuthStatus — small badge showing signed-in / signed-out / expired state.
 *
 * @example
 * <sg-auth-status></sg-auth-status>
 * <sg-auth-status compact></sg-auth-status>
 */
export class SgAuthStatus extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._onAuthChange = () => this._render();
    }

    connectedCallback() {
        this._render();
        window.addEventListener('sg-auth:signed-in',    this._onAuthChange);
        window.addEventListener('sg-auth:signed-out',   this._onAuthChange);
        window.addEventListener('sg-auth:token-saved',  this._onAuthChange);
        window.addEventListener('sg-auth:token-removed',this._onAuthChange);
        window.addEventListener('sg-auth:tokens-cleared',this._onAuthChange);
    }

    disconnectedCallback() {
        window.removeEventListener('sg-auth:signed-in',    this._onAuthChange);
        window.removeEventListener('sg-auth:signed-out',   this._onAuthChange);
        window.removeEventListener('sg-auth:token-saved',  this._onAuthChange);
        window.removeEventListener('sg-auth:token-removed',this._onAuthChange);
        window.removeEventListener('sg-auth:tokens-cleared',this._onAuthChange);
    }

    /**
     * Current aggregate auth status across all providers.
     * @returns {{ signedIn: boolean, expired: boolean, providers: string[], expiresAt: number|null }}
     */
    getStatus() {
        const tokens   = listTokens();
        const valid    = tokens.filter(t => hasValidToken(t.provider));
        const expired  = tokens.filter(t => !hasValidToken(t.provider) && t.expiresAt);
        return {
            signedIn:  valid.length > 0,
            expired:   valid.length === 0 && expired.length > 0,
            providers: valid.map(t => t.provider),
            expiresAt: valid.length > 0 ? Math.min(...valid.map(t => t.expiresAt || Infinity)) : null,
            tokenCount: tokens.length,
        };
    }

    /** Re-read localStorage and re-render. */
    refresh() { this._render(); }

    _render() {
        const s = this.getStatus();
        const sr = this.shadowRoot;

        let cls, dot, label;
        if (s.signedIn) {
            cls   = 'state-in';
            label = `Signed in · ${s.providers.join(', ')}`;
        } else if (s.expired) {
            cls   = 'state-exp';
            label = `Expired · ${s.providers.join(', ')}`;
        } else {
            cls   = 'state-out';
            label = 'Not signed in';
        }

        sr.innerHTML = `
            <style>${_CSS}</style>
            <span class="badge ${cls}" title="${label}">
                <span class="dot"></span>
                <span class="label">${label}</span>
            </span>
        `;
    }
}

customElements.define('sg-auth-status', SgAuthStatus);
