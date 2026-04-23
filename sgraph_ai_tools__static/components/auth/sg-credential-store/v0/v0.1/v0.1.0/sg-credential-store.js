/**
 * sg-credential-store — browser password manager wrapper.
 *
 * Credential Management API (Chromium) with form-based fallback (Safari/Firefox).
 * Maintains a localStorage metadata INDEX of credential names + timestamps.
 * Secrets are NEVER stored in localStorage — only in the password manager.
 *
 * @module sg-credential-store
 * @version 0.1.0
 */

const INDEX_KEY = 'sg-cred-index';

/** @typedef {'native'|'form'|'none'} CredMethod */

/**
 * @typedef {Object} CredIndexEntry
 * @property {string}     name       user-visible credential name
 * @property {number}     storedAt   ms since epoch
 * @property {CredMethod} method     how it was stored
 */

/** @returns {CredIndexEntry[]} */
function _readIndex() {
    try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || []; } catch { return []; }
}

function _writeIndex(entries) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
}

function _addToIndex(name, method) {
    const entries = _readIndex().filter(e => e.name !== name);
    entries.unshift({ name, storedAt: Date.now(), method });
    _writeIndex(entries);
}

function _removeFromIndex(name) {
    _writeIndex(_readIndex().filter(e => e.name !== name));
}

/**
 * Detect which credential storage method is available.
 * @returns {{ supported: boolean, method: CredMethod, browser: string }}
 */
function detect() {
    const ua = navigator.userAgent;
    const browser = /Chrome/.test(ua) && !/Edg/.test(ua) ? 'chrome'
                  : /Edg/.test(ua) ? 'edge'
                  : /Firefox/.test(ua) ? 'firefox'
                  : /Safari/.test(ua) ? 'safari'
                  : 'unknown';

    const nativeSupported = 'credentials' in navigator && 'PasswordCredential' in window;
    return {
        supported: true, // form fallback always works
        method:    nativeSupported ? 'native' : 'form',
        browser,
        nativeSupported,
    };
}

/**
 * Store a credential in the browser's password manager.
 * @param {string} name    user-visible label (stored as "username")
 * @param {string} secret  the secret value (stored as "password")
 * @returns {Promise<{ method: CredMethod }>}
 */
async function store(name, secret) {
    const d = detect();

    if (d.nativeSupported) {
        try {
            const cred = new PasswordCredential({ id: name, password: secret });
            await navigator.credentials.store(cred);
            _addToIndex(name, 'native');
            window.dispatchEvent(new CustomEvent('sg-cred:stored', { detail: { name, method: 'native' } }));
            return { method: 'native' };
        } catch (e) {
            // Fall through to form fallback if native fails
            console.warn('[sg-credential-store] native store failed, trying form fallback', e);
        }
    }

    // Form-based fallback (Safari, Firefox, and extensions like 1Password/Bitwarden)
    await _formStore(name, secret);
    _addToIndex(name, 'form');
    window.dispatchEvent(new CustomEvent('sg-cred:stored', { detail: { name, method: 'form' } }));
    return { method: 'form' };
}

/**
 * Programmatic form submit to trigger browser save-password heuristic.
 * @param {string} name
 * @param {string} secret
 */
async function _formStore(name, secret) {
    // Build a hidden form that the browser's password-save heuristic will detect
    const formId = `sg-cred-save-${Date.now()}`;
    const form = document.createElement('form');
    form.id = formId;
    form.method = 'post';
    form.action = '#';
    form.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;z-index:-1;';

    const userInput = document.createElement('input');
    userInput.type  = 'text';
    userInput.name  = 'username';
    userInput.autocomplete = 'username';
    userInput.value = name;

    const passInput = document.createElement('input');
    passInput.type  = 'password';
    passInput.name  = 'password';
    passInput.autocomplete = 'new-password';
    passInput.value = secret;

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Save';

    form.appendChild(userInput);
    form.appendChild(passInput);
    form.appendChild(submit);
    document.body.appendChild(form);

    // Briefly show the form (some browsers require visibility)
    await new Promise(r => setTimeout(r, 50));
    form.style.opacity = '0.01';
    form.style.top = '0';

    await new Promise((resolve) => {
        form.addEventListener('submit', e => { e.preventDefault(); resolve(); });
        submit.click();
        setTimeout(resolve, 200); // resolve anyway after 200ms
    });

    await new Promise(r => setTimeout(r, 300)); // give browser time to show prompt
    document.body.removeChild(form);
}

/**
 * Retrieve a stored credential. On Chromium shows the browser's account chooser.
 * On Safari/Firefox renders a visible form for autofill.
 *
 * @param {Object} [opts]
 * @param {'silent'|'optional'|'required'} [opts.mediation='optional']
 * @returns {Promise<{name: string, secret: string, method: CredMethod}|null>}
 */
async function get(opts = {}) {
    const { mediation = 'optional' } = opts;
    const d = detect();

    if (d.nativeSupported) {
        try {
            const cred = await navigator.credentials.get({ password: true, mediation });
            if (cred instanceof PasswordCredential) {
                const result = { name: cred.id, secret: cred.password, method: 'native' };
                window.dispatchEvent(new CustomEvent('sg-cred:retrieved', { detail: result }));
                return result;
            }
            return null;
        } catch (e) {
            if (e.name !== 'NotAllowedError') {
                window.dispatchEvent(new CustomEvent('sg-cred:error', { detail: { message: e.message } }));
            }
            return null;
        }
    }

    // Form fallback — return null; caller should render <sg-credential-store> component for UI
    window.dispatchEvent(new CustomEvent('sg-cred:unsupported', { detail: detect() }));
    return null;
}

/**
 * Remove a credential from the local index.
 * Note: browsers do not expose an API to delete from the password manager programmatically.
 * The user must remove it manually from their browser's password settings.
 * @param {string} name
 */
function markRemoved(name) {
    _removeFromIndex(name);
    window.dispatchEvent(new CustomEvent('sg-cred:removed', { detail: { name } }));
}

/** @returns {CredIndexEntry[]} */
function getIndex() { return _readIndex(); }

const _CSS = `
:host { display: block; font-family: system-ui, sans-serif; }
.panel  { background: #0d0d1a; border: 1px solid #1a1a3a; border-radius: 6px; padding: 12px; }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.title  { font-size: 13px; font-weight: 600; color: #a0aec0; }
.detect-row { font-size: 11px; color: #718096; margin-bottom: 10px; padding: 6px 8px; background: #111122; border-radius: 4px; }
.method-badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.native { background: rgba(78,205,196,.15); color: #4ecdc4; }
.form   { background: rgba(237,137,54,.15); color: #ed8936; }
.fields { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
input   { background: #111122; border: 1px solid #1a1a3a; border-radius: 4px; padding: 6px 8px; color: #e2e8f0; font-size: 12px; font-family: inherit; width: 100%; box-sizing: border-box; }
input:focus { outline: none; border-color: #4ecdc4; }
.btn-row { display: flex; gap: 8px; }
.btn    { font-size: 12px; padding: 6px 14px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #a0aec0; cursor: pointer; font-family: inherit; transition: all 120ms; }
.btn:hover { border-color: #4ecdc4; color: #4ecdc4; }
.btn-primary { border-color: #4ecdc4; color: #4ecdc4; }
.msg    { font-size: 11px; margin-top: 8px; padding: 5px 8px; border-radius: 4px; }
.msg-ok  { background: rgba(78,205,196,.1); color: #4ecdc4; }
.msg-err { background: rgba(252,129,129,.1); color: #fc8181; }
`;

/**
 * SgCredentialStore — UI component for storing/retrieving credentials.
 *
 * @example
 * <sg-credential-store></sg-credential-store>
 */
export class SgCredentialStore extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() { this._render(); }

    detect()         { return detect(); }
    store(name, s)   { return store(name, s); }
    get(opts)        { return get(opts); }
    markRemoved(n)   { return markRemoved(n); }
    getIndex()       { return getIndex(); }

    _showMsg(text, ok) {
        const msg = this.shadowRoot.querySelector('.msg');
        if (!msg) return;
        msg.textContent = text;
        msg.className = `msg ${ok ? 'msg-ok' : 'msg-err'}`;
        msg.style.display = 'block';
        setTimeout(() => { msg.style.display = 'none'; }, 3000);
    }

    _render() {
        const d = detect();
        const sr = this.shadowRoot;
        sr.innerHTML = `
            <style>${_CSS}</style>
            <div class="panel">
                <div class="header">
                    <span class="title">Browser Credential Store</span>
                    <span class="method-badge ${d.method}">${d.method}</span>
                </div>
                <div class="detect-row">
                    Browser: <strong>${d.browser}</strong> ·
                    API: <span class="${d.nativeSupported ? 'native method-badge' : 'form method-badge'}">${d.nativeSupported ? 'PasswordCredential' : 'form fallback'}</span>
                </div>
                <div class="fields">
                    <input id="cred-name"   type="text"     placeholder="Credential name (e.g. My Vault)" autocomplete="off">
                    <input id="cred-secret" type="password" placeholder="Secret (vault key, API key…)" autocomplete="new-password">
                </div>
                <div class="btn-row">
                    <button class="btn btn-primary" id="store-btn">Store</button>
                    <button class="btn" id="get-btn">Retrieve</button>
                </div>
                <div class="msg" style="display:none"></div>
            </div>
        `;

        sr.querySelector('#store-btn').addEventListener('click', async () => {
            const name   = sr.querySelector('#cred-name').value.trim();
            const secret = sr.querySelector('#cred-secret').value;
            if (!name || !secret) { this._showMsg('Enter a name and secret', false); return; }
            try {
                const { method } = await store(name, secret);
                this._showMsg(`Stored via ${method} — check your browser's save-password prompt`, true);
                sr.querySelector('#cred-name').value   = '';
                sr.querySelector('#cred-secret').value = '';
                this.dispatchEvent(new CustomEvent('sg-credential-store:stored', { detail: { name, method }, bubbles: true }));
            } catch (e) {
                this._showMsg(`Store failed: ${e.message}`, false);
            }
        });

        sr.querySelector('#get-btn').addEventListener('click', async () => {
            const cred = await get({ mediation: 'required' });
            if (cred) {
                this._showMsg(`Retrieved: "${cred.name}" via ${cred.method}`, true);
                this.dispatchEvent(new CustomEvent('sg-credential-store:retrieved', { detail: cred, bubbles: true }));
            } else {
                this._showMsg('No credential retrieved (cancelled or unavailable)', false);
            }
        });
    }
}

customElements.define('sg-credential-store', SgCredentialStore);

export { detect, store, get, markRemoved, getIndex };
