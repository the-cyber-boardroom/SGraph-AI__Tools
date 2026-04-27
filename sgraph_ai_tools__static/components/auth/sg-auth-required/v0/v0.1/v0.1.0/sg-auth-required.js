/**
 * sg-auth-required — auth gate component.
 *
 * Wraps content that requires authentication. Shows a sign-in prompt
 * when the user is not signed in; renders the slot when they are.
 * Reacts live to auth state changes — no page reload needed.
 *
 * @module sg-auth-required
 * @version 0.1.0
 *
 * @attr {string} client-id   Google OAuth client ID (falls back to localStorage)
 * @attr {string} message     Custom prompt message (default: "Sign in to continue")
 *
 * @example
 * <sg-auth-required client-id="xxx.apps.googleusercontent.com">
 *   <p>This only renders when signed in.</p>
 * </sg-auth-required>
 *
 * @fires sg-auth-required:signed-in  When the gate opens (user just signed in)
 * @fires sg-auth-required:signed-out When the gate closes (user signed out)
 */

import { isSignedIn, onAuthChange }
    from '/core/auth-context/v0/v0.1/v0.1.0/sg-auth-context.js';
import '/components/auth/sg-auth-google/v0/v0.1/v0.1.0/sg-auth-google.js';

const CLIENT_ID_KEY = 'sg-auth-google-client-id';

const _CSS = `
:host { display: block; }

.gate {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 40px 24px; text-align: center;
    font-family: system-ui, sans-serif; min-height: 200px;
    background: #080812;
}
.gate-icon  { font-size: 36px; margin-bottom: 14px; }
.gate-title { font-size: 16px; font-weight: 600; color: #e2e8f0; margin-bottom: 6px; }
.gate-msg   { font-size: 13px; color: #718096; margin-bottom: 24px; max-width: 340px; line-height: 1.5; }
sg-auth-google { max-width: 340px; width: 100%; }
`;

export class SgAuthRequired extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._off = null;
        this._wasSignedIn = null;
    }

    static get observedAttributes() { return ['client-id', 'message']; }

    connectedCallback() {
        this._off = onAuthChange(user => this._update(!!user));
    }

    disconnectedCallback() {
        this._off?.();
    }

    attributeChangedCallback() {
        this._update(isSignedIn());
    }

    _update(signedIn) {
        if (this._wasSignedIn !== null && signedIn !== this._wasSignedIn) {
            this.dispatchEvent(new CustomEvent(
                signedIn ? 'sg-auth-required:signed-in' : 'sg-auth-required:signed-out',
                { bubbles: true, composed: true }
            ));
        }
        this._wasSignedIn = signedIn;

        const sr = this.shadowRoot;
        if (signedIn) {
            sr.innerHTML = `<style>${_CSS}</style><slot></slot>`;
        } else {
            const clientId = this.getAttribute('client-id')
                || localStorage.getItem(CLIENT_ID_KEY) || '';
            const message = this.getAttribute('message') || 'Sign in to continue';
            sr.innerHTML = `
                <style>${_CSS}</style>
                <div class="gate">
                    <div class="gate-icon">🔐</div>
                    <div class="gate-title">Authentication required</div>
                    <div class="gate-msg">${message}</div>
                    <sg-auth-google id="gate-google"></sg-auth-google>
                </div>
            `;
            const googleEl = sr.querySelector('#gate-google');
            if (googleEl && clientId) googleEl.initialize(clientId);
        }
    }
}

customElements.define('sg-auth-required', SgAuthRequired);
