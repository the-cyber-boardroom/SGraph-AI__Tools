/* =================================================================================
   SGraph — YouTube Upload Component
   v0.1.0 — Web Component wrapper around core/youtube-upload + token cache.

   Usage:
     <script type="module"
             src="/components/video/upload/sg-youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js"></script>

     <sg-youtube-upload
         client-id="123-abc.apps.googleusercontent.com"
         default-privacy="unlisted">
     </sg-youtube-upload>

     const el = document.querySelector('sg-youtube-upload');
     el.setFile(myFileBlob);
     el.connect();                     // silent if cached, popup if not
     el.upload({ title: 'demo' });     // resolves with { id, url, ... }

   Attributes:
     client-id        — Google OAuth client ID (else uses cached or user-supplied)
     default-privacy  — 'private' | 'unlisted' | 'public' (default: 'unlisted')
     default-title    — Pre-fills the title input
     auto-connect     — On connect, auto-attempt silent grant if a token is cached

   Events (composed, bubble):
     youtube-connected         { expiresAt }
     youtube-disconnected      {}
     youtube-upload-start      { fileName, fileSize, metadata }
     youtube-upload-progress   { loaded, total, percent }
     youtube-upload-complete   { id, url, snippet, status }
     youtube-upload-error      { message, step }
   ================================================================================= */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';
import { requestAccess, YouTubeUpload }
    from '/core/youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js';
import { getCachedToken, setCachedToken, clearCachedToken } from './youtube-token-cache.js';

const LS_CLIENT_ID = 'sg-youtube-client-id';

class SgYouTubeUpload extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-youtube-upload' }

    get sharedCssPaths() {
        return ['/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css']
    }

    onReady() {
        this._file = null;
        this._uploader = null;

        // Hydrate from attributes / localStorage
        const cidAttr = this.getAttribute('client-id');
        const cid     = cidAttr || localStorage.getItem(LS_CLIENT_ID) || '';
        if (cid) this._clientIdInput.value = cid;

        const defTitle   = this.getAttribute('default-title');
        const defPrivacy = this.getAttribute('default-privacy') || 'unlisted';
        if (defTitle) this._titleInput.value = defTitle;
        this._privacyInput.value = defPrivacy;

        // Reflect cached token state
        if (getCachedToken()) {
            this._setConnected(true);
            this._uploader = new YouTubeUpload(getCachedToken().accessToken);
        }

        if (this.hasAttribute('auto-connect') && cid && !getCachedToken()) {
            // Best-effort silent grant; safe to ignore failures
            this.connect({ silent: true }).catch(() => {});
        }
    }

    bindElements() {
        this._clientIdInput = this.$('#client-id-input');
        this._connectBtn    = this.$('#connect-btn');
        this._disconnectBtn = this.$('#disconnect-btn');
        this._connStatus    = this.$('#conn-status');
        this._titleInput    = this.$('#title-input');
        this._descInput     = this.$('#desc-input');
        this._tagsInput     = this.$('#tags-input');
        this._privacyInput  = this.$('#privacy-select');
        this._fileNameEl    = this.$('#file-name');
        this._fileSizeEl    = this.$('#file-size');
        this._uploadBtn     = this.$('#upload-btn');
        this._progWrap      = this.$('#progress-wrap');
        this._progBar       = this.$('#progress-bar');
        this._progText      = this.$('#progress-text');
        this._resultWrap    = this.$('#result-wrap');
        this._resultLink    = this.$('#result-link');
        this._errorWrap     = this.$('#error-wrap');
    }

    setupEventListeners() {
        this.addTrackedListener(this._clientIdInput, 'change',     this._onClientIdChange);
        this.addTrackedListener(this._connectBtn,    'click', () => this.connect());
        this.addTrackedListener(this._disconnectBtn, 'click', () => this.signOut());
        this.addTrackedListener(this._uploadBtn,     'click', () => this.upload());
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    /**
     * Set the file to upload.
     * @param {File|Blob} file
     */
    setFile(file) {
        this._file = file || null;
        if (this._file) {
            this._fileNameEl.textContent = this._file.name || 'recording.webm';
            this._fileSizeEl.textContent = `(${_formatBytes(this._file.size)})`;
        } else {
            this._fileNameEl.textContent = '— none —';
            this._fileSizeEl.textContent = '';
        }
        this._refreshUploadBtn();
    }

    /** @returns {File|Blob|null} */
    getFile() { return this._file; }

    /**
     * Acquire a youtube.upload access token. Uses cached token if valid.
     * Tries silent grant first (no popup) when consent already given;
     * falls back to interactive popup.
     * @param {{ silent?: boolean }} [opts]  silent: never show popup
     * @returns {Promise<{ accessToken: string, expiresAt: number }>}
     */
    async connect({ silent = false } = {}) {
        const cached = getCachedToken();
        if (cached) {
            this._uploader = new YouTubeUpload(cached.accessToken);
            this._setConnected(true);
            this.emit('youtube-connected', { expiresAt: cached.expiresAt });
            return cached;
        }

        const clientId = this._currentClientId();
        if (!clientId) {
            this._showError('No client-id set. Paste your Google OAuth client ID first.');
            throw new Error('No client-id');
        }
        localStorage.setItem(LS_CLIENT_ID, clientId);

        try {
            const token = silent
                ? await requestAccess(clientId, { prompt: '' })
                : await requestAccess(clientId);
            setCachedToken(token);
            this._uploader = new YouTubeUpload(token.accessToken);
            this._setConnected(true);
            this._clearError();
            this.emit('youtube-connected', { expiresAt: token.expiresAt });
            return token;
        } catch (err) {
            this._setConnected(false);
            this._showError(err.message);
            this.emit('youtube-upload-error', { message: err.message, step: 'connect' });
            throw err;
        }
    }

    /**
     * Clear cached token + dispatch youtube-disconnected. Does not revoke at Google.
     */
    signOut() {
        clearCachedToken();
        this._uploader = null;
        this._setConnected(false);
        this.emit('youtube-disconnected', {});
    }

    /**
     * Upload the currently-set file. Reads metadata from the form unless overridden.
     * @param {Partial<import('/core/youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js').VideoMetadata>} [override]
     * @returns {Promise<{ id: string, url: string, snippet: object, status: object }>}
     */
    async upload(override = {}) {
        if (!this._file)     { this._showError('No file selected.');       return; }
        if (!this._uploader) { this._showError('Not connected to YouTube.'); return; }

        const metadata = { ...this._readMetadata(), ...override };
        if (!metadata.title) { this._showError('Title is required.'); return; }

        this._clearError();
        this._resultWrap.hidden = true;
        this._progWrap.hidden = false;
        this._setProgress(0);
        this._uploadBtn.disabled = true;
        this._uploadBtn.textContent = 'Uploading…';

        this.emit('youtube-upload-start', {
            fileName: this._file.name,
            fileSize: this._file.size,
            metadata,
        });

        try {
            const result = await this._uploader.uploadVideo(this._file, metadata, {
                onProgress: p => {
                    this._setProgress(p.percent);
                    this.emit('youtube-upload-progress', p);
                },
            });
            this._setProgress(100);
            this._showResult(result);
            this.emit('youtube-upload-complete', result);
            return result;
        } catch (err) {
            this._showError(err.message);
            this.emit('youtube-upload-error', { message: err.message, step: 'upload' });
            // If unauthorised, drop the cached token so next attempt re-auths.
            if (/\b401\b/.test(err.message)) this.signOut();
            throw err;
        } finally {
            this._uploadBtn.disabled = !this._canUpload();
            this._uploadBtn.textContent = 'Upload to YouTube';
        }
    }

    /** @returns {boolean} */
    isConnected() { return !!getCachedToken(); }

    // ── Internals ───────────────────────────────────────────────────────────────

    _onClientIdChange() {
        const v = this._clientIdInput.value.trim();
        if (v) localStorage.setItem(LS_CLIENT_ID, v);
        else   localStorage.removeItem(LS_CLIENT_ID);
    }

    _currentClientId() {
        return (this._clientIdInput.value || '').trim()
            || this.getAttribute('client-id')
            || localStorage.getItem(LS_CLIENT_ID)
            || '';
    }

    _readMetadata() {
        const tags = (this._tagsInput.value || '')
            .split(',').map(t => t.trim()).filter(Boolean);
        return {
            title:         (this._titleInput.value || '').trim(),
            description:    this._descInput.value || '',
            tags,
            privacyStatus:  this._privacyInput.value || 'unlisted',
        };
    }

    _setConnected(on) {
        this._connStatus.textContent = on ? 'connected' : 'disconnected';
        this._connStatus.classList.toggle('ytup__status--on',  on);
        this._connStatus.classList.toggle('ytup__status--off', !on);
        this._connectBtn.hidden    = !!on;
        this._disconnectBtn.hidden = !on;
        this._refreshUploadBtn();
    }

    _refreshUploadBtn() {
        if (this._uploadBtn) this._uploadBtn.disabled = !this._canUpload();
    }

    _canUpload() {
        return !!this._file && !!this._uploader;
    }

    _setProgress(percent) {
        const pct = Math.max(0, Math.min(100, percent || 0));
        this._progBar.style.setProperty('--progress', `${pct}%`);
        this._progText.textContent = `${pct}%`;
    }

    _showResult({ id, url }) {
        this._resultWrap.hidden = false;
        this._resultLink.href = url || '#';
        this._resultLink.textContent = url || `(video id: ${id})`;
    }

    _showError(msg) {
        this._errorWrap.hidden = false;
        this._errorWrap.textContent = msg;
        this._connStatus.classList.add('ytup__status--err');
    }

    _clearError() {
        this._errorWrap.hidden = true;
        this._errorWrap.textContent = '';
        this._connStatus.classList.remove('ytup__status--err');
    }
}

function _formatBytes(n) {
    if (!n && n !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

customElements.define('sg-youtube-upload', SgYouTubeUpload);

export { SgYouTubeUpload };
