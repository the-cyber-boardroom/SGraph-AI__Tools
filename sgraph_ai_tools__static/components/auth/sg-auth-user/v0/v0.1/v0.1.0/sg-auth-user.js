/**
 * sg-auth-user — full user info panel.
 *
 * Shows everything available client-side: avatar, name, email, provider,
 * token expiry, storage details, logout action.
 * Re-renders on all sg-auth:* events.
 *
 * @module sg-auth-user
 * @version 0.1.0
 */

import { listTokens, hasValidToken, clearAll } from '../../../../sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';

const _CSS = `
:host { display: block; font-family: system-ui, sans-serif; }
.panel { background: #0d0d1a; border: 1px solid #1a1a3a; border-radius: 6px; padding: 14px; }

/* signed-in */
.user-row   { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.avatar     { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #4ecdc4; flex-shrink: 0; }
.avatar-ph  { width: 44px; height: 44px; border-radius: 50%; background: #1a1a3a; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
.user-info  { flex: 1; min-width: 0; }
.user-name  { font-size: 14px; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-email { font-size: 12px; color: #718096; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.provider-badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; background: rgba(78,205,196,.15); color: #4ecdc4; margin-top: 3px; }

/* details table */
.details    { margin-top: 10px; border-top: 1px solid #1a1a3a; padding-top: 10px; }
.detail-row { display: flex; justify-content: space-between; align-items: baseline; margin: 3px 0; font-size: 11px; }
.detail-key { color: #4a5568; }
.detail-val { color: #a0aec0; font-family: 'SF Mono', Monaco, monospace; font-size: 10px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ok  { color: #4ecdc4; }
.exp { color: #ed8936; }
.na  { color: #4a5568; }

/* actions */
.actions  { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
.btn      { font-size: 11px; padding: 5px 12px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #a0aec0; cursor: pointer; font-family: inherit; transition: all 120ms; }
.btn:hover { border-color: #4ecdc4; color: #4ecdc4; }
.btn-danger:hover { border-color: #fc8181; color: #fc8181; }

/* signed-out */
.signed-out { text-align: center; padding: 10px 0; }
.signed-out-icon { font-size: 32px; display: block; margin-bottom: 8px; }
.signed-out-text { font-size: 13px; color: #4a5568; }

/* toggle */
.toggle-link { font-size: 11px; color: #4ecdc4; cursor: pointer; text-decoration: underline; background: none; border: none; padding: 0; font-family: inherit; margin-top: 6px; }
`;

function _fmtExpiry(ms) {
    if (!ms) return null;
    const diff = ms - Date.now();
    if (diff <= 0) return { text: `expired ${Math.abs(Math.round(diff / 60000))} min ago`, ok: false };
    const min = Math.round(diff / 60000);
    if (min < 60)  return { text: `expires in ${min} min`, ok: true };
    const hr = Math.round(diff / 3600000);
    return { text: `expires in ${hr} hr`, ok: true };
}

/**
 * SgAuthUser — full user info + token detail panel.
 *
 * @example
 * <sg-auth-user></sg-auth-user>
 * <sg-auth-user show-details></sg-auth-user>
 */
export class SgAuthUser extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._showDetails = false;
        this._onAuthChange = () => this._render();
    }

    static get observedAttributes() { return ['show-details']; }
    attributeChangedCallback(name) {
        if (name === 'show-details') { this._showDetails = this.hasAttribute('show-details'); this._render(); }
    }

    connectedCallback() {
        this._showDetails = this.hasAttribute('show-details');
        this._render();
        ['sg-auth:signed-in','sg-auth:signed-out','sg-auth:token-saved',
         'sg-auth:token-removed','sg-auth:tokens-cleared'].forEach(
            e => window.addEventListener(e, this._onAuthChange)
        );
    }

    disconnectedCallback() {
        ['sg-auth:signed-in','sg-auth:signed-out','sg-auth:token-saved',
         'sg-auth:token-removed','sg-auth:tokens-cleared'].forEach(
            e => window.removeEventListener(e, this._onAuthChange)
        );
    }

    _render() {
        const tokens = listTokens();
        const valid  = tokens.filter(t => hasValidToken(t.provider));
        const sr = this.shadowRoot;
        sr.innerHTML = `<style>${_CSS}</style>`;

        const panel = document.createElement('div');
        panel.className = 'panel';

        if (valid.length === 0 && tokens.length === 0) {
            panel.innerHTML = `
                <div class="signed-out">
                    <span class="signed-out-icon">👤</span>
                    <div class="signed-out-text">Not signed in</div>
                    <div class="signed-out-text" style="margin-top:6px;font-size:11px;color:#2d3748">
                        Use &lt;sg-auth-google&gt; to sign in
                    </div>
                </div>
            `;
        } else {
            // Show primary token
            const primary = valid[0] || tokens[0];
            const claims  = primary?.claims || {};
            const isValid = hasValidToken(primary.provider);
            const expiry  = _fmtExpiry(primary.expiresAt);

            panel.innerHTML = `
                <div class="user-row">
                    ${claims.picture
                        ? `<img class="avatar" src="${claims.picture}" alt="" referrerpolicy="no-referrer">`
                        : `<div class="avatar-ph">👤</div>`}
                    <div class="user-info">
                        <div class="user-name">${claims.name || claims.email || 'Unknown user'}</div>
                        <div class="user-email">${claims.email || '—'}</div>
                        <span class="provider-badge">${primary.provider}</span>
                    </div>
                </div>
            `;

            if (this._showDetails || tokens.length > 0) {
                const detailsHtml = `
                    <div class="details">
                        <div class="detail-row">
                            <span class="detail-key">Status</span>
                            <span class="detail-val ${isValid ? 'ok' : 'exp'}">${isValid ? '✓ valid' : '✗ expired'}</span>
                        </div>
                        ${expiry ? `
                        <div class="detail-row">
                            <span class="detail-key">Expiry</span>
                            <span class="detail-val ${expiry.ok ? 'ok' : 'exp'}">${expiry.text}</span>
                        </div>` : ''}
                        <div class="detail-row">
                            <span class="detail-key">Sub (user ID)</span>
                            <span class="detail-val">${claims.sub || '—'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-key">localStorage keys</span>
                            <span class="detail-val ok">${tokens.length} token${tokens.length !== 1 ? 's' : ''} stored</span>
                        </div>
                        ${tokens.length > 1 ? `
                        <div class="detail-row">
                            <span class="detail-key">Providers</span>
                            <span class="detail-val">${tokens.map(t => t.provider).join(', ')}</span>
                        </div>` : ''}
                    </div>
                `;
                panel.innerHTML += detailsHtml;
            }

            const toggleLabel = this._showDetails ? 'Hide details' : 'Show details';
            const actionsHtml = `
                <div class="actions">
                    <button class="btn" id="toggle-details">${toggleLabel}</button>
                    <button class="btn btn-danger" id="clear-btn">Clear all tokens</button>
                </div>
            `;
            panel.innerHTML += actionsHtml;
        }

        sr.appendChild(panel);

        sr.querySelector('#toggle-details')?.addEventListener('click', () => {
            this._showDetails = !this._showDetails;
            this._render();
        });

        sr.querySelector('#clear-btn')?.addEventListener('click', () => {
            clearAll();
            this._render();
        });
    }
}

customElements.define('sg-auth-user', SgAuthUser);
