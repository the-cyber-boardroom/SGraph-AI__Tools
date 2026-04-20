/**
 * sg-credential-list — display credentials stored by this app.
 *
 * Renders the metadata index from sg-credential-store (names + timestamps).
 * Does NOT show secrets — only metadata. Secrets live in the password manager.
 *
 * @module sg-credential-list
 * @version 0.1.0
 */

import { getIndex, get, store, markRemoved } from '../../../sg-credential-store/v0/v0.1/v0.1.0/sg-credential-store.js';

function _relTime(ms) {
    const diff = Date.now() - ms;
    if (diff < 60000)   return 'just now';
    if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)} hr ago`;
    return new Date(ms).toLocaleDateString();
}

const _CSS = `
:host { display: block; font-family: system-ui, sans-serif; }
.panel  { background: #0d0d1a; border: 1px solid #1a1a3a; border-radius: 6px; overflow: hidden; }
.header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #1a1a3a; }
.title  { font-size: 13px; font-weight: 600; color: #a0aec0; }
.count  { font-size: 11px; color: #4a5568; }
.btn-sm { font-size: 11px; padding: 3px 8px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #718096; cursor: pointer; font-family: inherit; }
.btn-sm:hover { border-color: #4ecdc4; color: #4ecdc4; }

.empty  { padding: 24px 12px; text-align: center; font-size: 12px; color: #2d3748; }
.list   { }
.entry  { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #0d0d1a; }
.entry:last-child { border-bottom: none; }
.entry:hover { background: #111122; }
.entry-icon { font-size: 16px; flex-shrink: 0; }
.entry-info { flex: 1; min-width: 0; }
.entry-name { font-size: 12px; color: #e2e8f0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.entry-meta { font-size: 10px; color: #4a5568; }
.method-badge { display: inline-block; padding: 0px 5px; border-radius: 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
.native { background: rgba(78,205,196,.15); color: #4ecdc4; }
.form   { background: rgba(237,137,54,.15); color: #ed8936; }

.actions { display: flex; gap: 4px; }
.retrieve-btn { font-size: 10px; padding: 2px 7px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #718096; cursor: pointer; font-family: inherit; }
.retrieve-btn:hover { border-color: #4ecdc4; color: #4ecdc4; }
.remove-btn { font-size: 10px; padding: 2px 7px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #4a5568; cursor: pointer; font-family: inherit; }
.remove-btn:hover { border-color: #fc8181; color: #fc8181; }

.add-section { padding: 10px 12px; border-top: 1px solid #1a1a3a; }
.add-row { display: flex; gap: 6px; }
input { background: #111122; border: 1px solid #1a1a3a; border-radius: 4px; padding: 5px 8px; color: #e2e8f0; font-size: 11px; font-family: inherit; flex: 1; }
input:focus { outline: none; border-color: #4ecdc4; }
.add-btn { font-size: 11px; padding: 5px 10px; border-radius: 4px; border: 1px solid #4ecdc4; background: none; color: #4ecdc4; cursor: pointer; font-family: inherit; white-space: nowrap; }
.add-btn:hover { background: rgba(78,205,196,.08); }
.msg { font-size: 11px; margin-top: 6px; padding: 4px 8px; border-radius: 4px; display: none; }
.msg-ok  { background: rgba(78,205,196,.1); color: #4ecdc4; display: block; }
.msg-err { background: rgba(252,129,129,.1); color: #fc8181; display: block; }

.note { padding: 8px 12px; font-size: 10px; color: #2d3748; background: #080812; border-top: 1px solid #0d0d1a; }
`;

/**
 * SgCredentialList — list of credentials stored by this app.
 *
 * @example
 * <sg-credential-list></sg-credential-list>
 */
export class SgCredentialList extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._onStored = () => this._render();
    }

    connectedCallback() {
        this._render();
        window.addEventListener('sg-cred:stored',  this._onStored);
        window.addEventListener('sg-cred:removed', this._onStored);
    }

    disconnectedCallback() {
        window.removeEventListener('sg-cred:stored',  this._onStored);
        window.removeEventListener('sg-cred:removed', this._onStored);
    }

    refresh()    { this._render(); }
    getCount()   { return getIndex().length; }

    async _retrieve(name) {
        const cred = await get({ mediation: 'required' });
        if (cred) {
            this.dispatchEvent(new CustomEvent('sg-credential-list:retrieved', {
                detail: cred, bubbles: true, composed: true,
            }));
            this._msg(`Retrieved: "${cred.name}"`, true);
        } else {
            this._msg('No credential retrieved', false);
        }
    }

    _remove(name) {
        markRemoved(name);
        this._render();
    }

    _msg(text, ok) {
        const el = this.shadowRoot.querySelector('.msg');
        if (!el) return;
        el.textContent = text;
        el.className = `msg ${ok ? 'msg-ok' : 'msg-err'}`;
        setTimeout(() => { el.className = 'msg'; el.textContent = ''; }, 3000);
    }

    _render() {
        const entries = getIndex();
        const sr = this.shadowRoot;

        let listHtml;
        if (entries.length === 0) {
            listHtml = `<div class="empty">No credentials stored yet<br>Use the Store form above to add one</div>`;
        } else {
            listHtml = `<div class="list">` + entries.map(e => `
                <div class="entry">
                    <span class="entry-icon">🔑</span>
                    <div class="entry-info">
                        <div class="entry-name">${e.name}</div>
                        <div class="entry-meta">
                            Stored ${_relTime(e.storedAt)} ·
                            <span class="method-badge ${e.method}">${e.method}</span>
                        </div>
                    </div>
                    <div class="actions">
                        <button class="retrieve-btn" data-name="${e.name}">Retrieve ↗</button>
                        <button class="remove-btn"   data-name="${e.name}">✕ Index</button>
                    </div>
                </div>
            `).join('') + `</div>`;
        }

        sr.innerHTML = `
            <style>${_CSS}</style>
            <div class="panel">
                <div class="header">
                    <span class="title">Stored Credentials</span>
                    <span class="count">${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'}</span>
                </div>
                ${listHtml}
                <div class="add-section">
                    <div class="add-row">
                        <input id="new-name"   type="text"     placeholder="Credential name…" autocomplete="off">
                        <input id="new-secret" type="password" placeholder="Secret…" autocomplete="new-password">
                        <button class="add-btn" id="add-btn">+ Store</button>
                    </div>
                    <div class="msg"></div>
                </div>
                <div class="note">
                    ⚠ Secrets are stored in your browser's password manager, not here.
                    "✕ Index" removes from this list only — delete the actual password in your browser settings.
                </div>
            </div>
        `;

        sr.querySelectorAll('.retrieve-btn').forEach(btn => {
            btn.addEventListener('click', () => this._retrieve(btn.dataset.name));
        });
        sr.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', () => this._remove(btn.dataset.name));
        });
        sr.querySelector('#add-btn').addEventListener('click', async () => {
            const name   = sr.querySelector('#new-name').value.trim();
            const secret = sr.querySelector('#new-secret').value;
            if (!name || !secret) { this._msg('Enter a name and secret', false); return; }
            try {
                await store(name, secret);
                sr.querySelector('#new-name').value   = '';
                sr.querySelector('#new-secret').value = '';
                this._msg(`Stored "${name}" — check browser save prompt`, true);
                this._render();
            } catch (e) {
                this._msg(`Failed: ${e.message}`, false);
            }
        });
    }
}

customElements.define('sg-credential-list', SgCredentialList);
