/**
 * sg-drive-appdata — UI component for Google Drive App Data Folder.
 *
 * Handles authorization, file listing, and read/write testing.
 * Exposes getStatus() for programmatic checks.
 *
 * @module sg-drive-appdata
 * @version 0.1.0
 *
 * @attr {string} client-id  Google OAuth client ID (falls back to localStorage)
 *
 * @fires sg-drive-appdata:connected  When Drive access is successfully granted
 *
 * @example
 * <sg-drive-appdata client-id="xxx.apps.googleusercontent.com"></sg-drive-appdata>
 */

import { requestAccess, DriveAppData }
    from '/core/drive-appdata/v0/v0.1/v0.1.0/sg-drive-appdata.js';

const CLIENT_ID_KEY = 'sg-auth-google-client-id';

const _CSS = `
:host { display: block; font-family: system-ui, sans-serif; }
.panel { background: #0d0d1a; border: 1px solid #1a1a3a; border-radius: 6px; padding: 12px; }

.status-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #a0aec0; margin-bottom: 10px; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot.on  { background: #4ecdc4; box-shadow: 0 0 6px #4ecdc4; }
.dot.off { background: #2d3748; }
.ok { color: #4ecdc4; font-weight: 600; }

.note { font-size: 10px; color: #4a5568; margin-bottom: 10px; line-height: 1.5; }
code { background: #111122; padding: 1px 4px; border-radius: 3px; font-size: 10px; }

.btn-primary { font-size: 12px; padding: 7px 16px; border-radius: 4px; border: 1px solid #4ecdc4; background: rgba(78,205,196,.08); color: #4ecdc4; cursor: pointer; font-family: inherit; }
.btn-primary:hover { background: rgba(78,205,196,.15); }
.btn-sm { font-size: 10px; padding: 3px 8px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #718096; cursor: pointer; font-family: inherit; }
.btn-sm:hover { border-color: #4ecdc4; color: #4ecdc4; }
.btn-danger { border-color: #2d3748; color: #4a5568; }
.btn-danger:hover { border-color: #fc8181; color: #fc8181; }

.files { margin: 8px 0; }
.file-row { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-bottom: 1px solid #0d0d1a; font-size: 11px; }
.file-row:last-child { border-bottom: none; }
.file-name { flex: 1; color: #e2e8f0; font-weight: 600; }
.file-meta { color: #4a5568; font-size: 10px; font-family: "SF Mono", Monaco, monospace; }
.empty { font-size: 11px; color: #2d3748; padding: 8px 0; }

.test-row { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }

.result { margin-top: 8px; background: #080812; border: 1px solid #1a1a3a; border-radius: 4px; padding: 8px; font-size: 11px; color: #a0aec0; font-family: "SF Mono", Monaco, monospace; white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow-y: auto; }

.msg { font-size: 11px; margin-top: 8px; padding: 4px 8px; border-radius: 4px; min-height: 20px; }
.msg-ok  { background: rgba(78,205,196,.1); color: #4ecdc4; }
.msg-err { background: rgba(252,129,129,.1); color: #fc8181; }

.prereq { font-size: 10px; color: #ed8936; margin-top: 8px; padding: 6px 8px; background: rgba(237,137,54,.08); border-radius: 4px; border-left: 2px solid #ed8936; line-height: 1.6; }
`;

export class SgDriveAppdata extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._drive = null;
        this._files = [];
        this._msgTimer = null;
    }

    connectedCallback() { this._render(); }

    get _clientId() {
        return this.getAttribute('client-id') || localStorage.getItem(CLIENT_ID_KEY) || '';
    }

    /**
     * @returns {{ connected: boolean, fileCount: number }}
     */
    getStatus() {
        return { connected: !!this._drive, fileCount: this._files.length };
    }

    async _connect() {
        const clientId = this._clientId;
        if (!clientId) { this._msg('No client ID — enter it in the Setup section first', false); return; }
        this._msg('Opening Google authorization…', true);
        try {
            const token = await requestAccess(clientId);
            this._drive = new DriveAppData(token);
            this._files = await this._drive.listFiles();
            this.dispatchEvent(new CustomEvent('sg-drive-appdata:connected', { bubbles: true, composed: true }));
            this._render();
            this._msg(`✓ Connected — ${this._files.length} file(s) in App Data`, true);
        } catch (e) {
            this._msg(`Failed: ${e.message}`, false);
        }
    }

    async _refresh() {
        if (!this._drive) return;
        this._files = await this._drive.listFiles();
        this._render();
    }

    async _writeTest() {
        try {
            const content = JSON.stringify({ written_by: 'sg-auth-mvp', ts: new Date().toISOString() }, null, 2);
            await this._drive.writeFile('sg-test.json', content);
            this._files = await this._drive.listFiles();
            this._render();
            this._msg('✓ Wrote sg-test.json to Drive App Data', true);
        } catch (e) { this._msg(`Write failed: ${e.message}`, false); }
    }

    async _readTest() {
        try {
            const content = await this._drive.readFile('sg-test.json');
            const el = this.shadowRoot.querySelector('.result');
            if (el) { el.textContent = content ?? '(not found)'; el.style.display = 'block'; }
        } catch (e) { this._msg(`Read failed: ${e.message}`, false); }
    }

    async _deleteFile(fileId) {
        try {
            await this._drive.deleteFile(fileId);
            this._files = await this._drive.listFiles();
            this._render();
        } catch (e) { this._msg(`Delete failed: ${e.message}`, false); }
    }

    _msg(text, ok) {
        clearTimeout(this._msgTimer);
        const el = this.shadowRoot.querySelector('.msg');
        if (!el) return;
        el.textContent = text;
        el.className = `msg ${ok ? 'msg-ok' : 'msg-err'}`;
        if (ok) this._msgTimer = setTimeout(() => { if (el) el.className = 'msg'; }, 4000);
    }

    _render() {
        const sr = this.shadowRoot;
        sr.innerHTML = `<style>${_CSS}</style>` + (this._drive ? this._htmlConnected() : this._htmlDisconnected());
        this._bindEvents();
    }

    _htmlDisconnected() {
        return `
            <div class="panel">
                <div class="status-row">
                    <span class="dot off"></span>
                    <span>Drive App Data — not connected</span>
                </div>
                <div class="note">
                    Scope: <code>drive.appdata</code> — hidden per-user, per-app folder.
                    Other apps and the user's Drive UI cannot see these files.
                </div>
                <div class="prereq">
                    ⚠ Prerequisite: Enable <strong>Google Drive API</strong> and add
                    <code>drive.appdata</code> scope in Google Cloud Console → OAuth consent screen → Scopes.
                </div>
                <button id="connect-btn" class="btn-primary" style="margin-top:10px;">Connect Drive</button>
                <div class="msg"></div>
            </div>
        `;
    }

    _htmlConnected() {
        const fileRows = this._files.length === 0
            ? `<div class="empty">No files yet</div>`
            : this._files.map(f => `
                <div class="file-row">
                    <span class="file-name">📄 ${f.name}</span>
                    <span class="file-meta">${f.size ?? 0}B · ${new Date(f.modifiedTime).toLocaleTimeString()}</span>
                    <button class="btn-sm btn-danger del-btn" data-id="${f.id}">✕</button>
                </div>`).join('');

        return `
            <div class="panel">
                <div class="status-row">
                    <span class="dot on"></span>
                    <span class="ok">Connected</span>
                    <span style="color:#4a5568;">· ${this._files.length} file${this._files.length !== 1 ? 's' : ''} in App Data</span>
                    <button id="refresh-btn" class="btn-sm" style="margin-left:auto">↺ Refresh</button>
                </div>
                <div class="files">${fileRows}</div>
                <div class="test-row">
                    <button id="write-btn" class="btn-sm">Write sg-test.json</button>
                    <button id="read-btn" class="btn-sm">Read sg-test.json</button>
                </div>
                <div class="result" style="display:none"></div>
                <div class="msg"></div>
            </div>
        `;
    }

    _bindEvents() {
        const sr = this.shadowRoot;
        sr.querySelector('#connect-btn')?.addEventListener('click', () => this._connect());
        sr.querySelector('#refresh-btn')?.addEventListener('click', () => this._refresh());
        sr.querySelector('#write-btn')?.addEventListener('click',   () => this._writeTest());
        sr.querySelector('#read-btn')?.addEventListener('click',    () => this._readTest());
        sr.querySelectorAll('.del-btn').forEach(btn =>
            btn.addEventListener('click', () => this._deleteFile(btn.dataset.id))
        );
    }
}

customElements.define('sg-drive-appdata', SgDriveAppdata);
