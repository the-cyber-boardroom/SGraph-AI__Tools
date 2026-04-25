/* =================================================================================
   SGraph — YouTube Video Editor Component
   v0.1.0 — Edit form for a single video. Wraps core/youtube-api.

   Usage:
     <script type="module" src="/components/video/manage/sg-youtube-video-editor/v0/v0.1/v0.1.0/sg-youtube-video-editor.js"></script>

     <sg-youtube-video-editor allow-delete></sg-youtube-video-editor>

     const el = document.querySelector('sg-youtube-video-editor');
     el.setToken(accessToken);
     await el.loadVideo('VIDEO_ID');
     // — or — populate from a known summary then full-load on demand:
     el.setVideoSummary({ id, title, description, thumbnailUrl, ... });

   Attributes:
     allow-delete   — show the danger-zone delete UI (boolean)

   Events (composed, bubble):
     video-loaded         { video }
     video-saved          { video, patch }
     video-deleted        { id }
     video-thumbnail-set  { id, thumbnails }
     video-error          { step, message }
   ================================================================================= */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';
import { YouTubeApi }  from '/core/youtube-api/v0/v0.1/v0.1.0/sg-youtube-api.js';

class SgYouTubeVideoEditor extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-youtube-video-editor' }

    get sharedCssPaths() {
        return ['/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css']
    }

    onReady() {
        this._api      = null;
        this._video    = null;        // raw video resource from getVideos()
        this._original = null;        // pristine snapshot for Reset
        this._thumbBlob = null;
        this._previewLoaded = false;

        // Playlist picker state
        this._playlists      = [];     // [{id, title, itemCount}]
        this._membership     = new Map();   // playlistId → playlistItemId (for videos in)
        this._playlistsLoaded = false;

        const showDelete = this.hasAttribute('allow-delete');
        this._dangerEl.hidden = !showDelete;
        if (this._dangerSep) this._dangerSep.hidden = !showDelete;

        // Replay any setVideoSummary / loadVideo calls that arrived before
        // bindElements() ran (the lifecycle is async — callers may set state
        // immediately after appendChild).
        if (this._pendingSummary) {
            const v = this._pendingSummary;
            this._pendingSummary = null;
            this.setVideoSummary(v);
        }
        if (this._pendingLoadId) {
            const id = this._pendingLoadId;
            this._pendingLoadId = null;
            this.loadVideo(id);
        }
    }

    bindElements() {
        this._statusEl     = this.$('#status');
        this._formEl       = this.$('#form');
        this._headTitleEl  = this.$('#head-title');
        this._headIdEl     = this.$('#head-id');
        this._watchLinkEl  = this.$('#watch-link');
        this._thumbEl      = this.$('#thumb');
        this._privacyBadge = this.$('#privacy-badge');
        this._titleInput   = this.$('#title-input');
        this._descInput    = this.$('#desc-input');
        this._tagsInput    = this.$('#tags-input');
        this._privacySelect = this.$('#privacy-select');
        this._saveBtn      = this.$('#save-btn');
        this._resetBtn     = this.$('#reset-btn');
        this._thumbInput   = this.$('#thumb-input');
        this._thumbBtn     = this.$('#thumb-btn');
        this._thumbNameEl  = this.$('#thumb-name');
        this._thumbUploadBtn = this.$('#thumb-upload-btn');
        this._dangerEl     = this.$('#danger-zone');
        this._dangerSep    = this.$('#danger-sep');
        this._confirmInput = this.$('#confirm-input');
        this._deleteBtn    = this.$('#delete-btn');
        this._errorEl      = this.$('#error');
        this._previewToggle = this.$('#preview-toggle');
        this._previewWrap   = this.$('#preview-wrap');
        this._previewIframe = this.$('#preview-iframe');
        this._plStatus      = this.$('#pl-status');
        this._plList        = this.$('#pl-list');
        this._plRefreshBtn  = this.$('#pl-refresh');
    }

    setupEventListeners() {
        this.addTrackedListener(this._formEl,    'submit', this._onSubmit);
        this.addTrackedListener(this._resetBtn,  'click',  this._onReset);
        this.addTrackedListener(this._thumbBtn,  'click',  () => this._thumbInput.click());
        this.addTrackedListener(this._thumbInput,'change', this._onThumbPick);
        this.addTrackedListener(this._thumbUploadBtn, 'click', () => this.uploadThumbnail());
        this.addTrackedListener(this._confirmInput,   'input', this._onConfirmInput);
        this.addTrackedListener(this._deleteBtn,      'click', () => this.deleteVideo());
        this.addTrackedListener(this._previewToggle, 'click', this._onPreviewToggle);
        this.addTrackedListener(this._plRefreshBtn,  'click', () => this._loadPlaylists(true));
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    /** @param {string|null} token */
    setToken(token) {
        this._api = token ? new YouTubeApi(token) : null;
    }

    /**
     * Pre-populate from a list-row summary so the header is responsive while
     * the full details fetch.
     * @param {{ id, title, description, thumbnailUrl, publishedAt }} v
     */
    setVideoSummary(v) {
        if (!v?.id) return;
        if (!this._headTitleEl) {
            // bindElements() hasn't run yet — queue for replay in onReady()
            this._pendingSummary = v;
            return;
        }
        this._headTitleEl.textContent = v.title || '';
        this._headIdEl.textContent    = v.id;
        if (v.thumbnailUrl) this._thumbEl.src = v.thumbnailUrl;
        this._titleInput.value = v.title || '';
        this._descInput.value  = v.description || '';
        this._tagsInput.value  = '';
        this._setStatus('Loading full details…');
    }

    /** Fetch and populate the form. */
    async loadVideo(videoId) {
        if (!videoId) { this._setError('load', 'No video id.'); return; }
        if (!this._statusEl) {
            // bindElements() hasn't run yet — queue for replay in onReady()
            this._pendingLoadId = videoId;
            return;
        }
        if (!this._api)  { this._setError('load', 'Not signed in.'); return; }
        this._clearError();
        this._setStatus('Loading…');
        try {
            const [video] = await this._api.getVideos([videoId], 'snippet,status,statistics');
            if (!video) throw new Error('Video not found');
            this._video    = video;
            this._original = JSON.parse(JSON.stringify(video));
            this._populate(video);
            this._setStatus('');
            this.emit('video-loaded', { video });
            // Kick off playlists load — non-blocking; failures are surfaced inline.
            this._loadPlaylists().catch(() => {});
        } catch (err) {
            this._setError('load', err.message);
        }
    }

    /**
     * Persist edits back to YouTube.
     * @returns {Promise<object|undefined>} updated video resource
     */
    async save() {
        if (!this._api || !this._video) return;
        this._clearError();
        const patch = this._buildPatch();
        if (!patch) { this._setStatus('No changes to save.'); return; }

        this._saveBtn.disabled = true;
        this._saveBtn.textContent = 'Saving…';
        try {
            const updated = await this._api.updateVideo(this._video.id, patch);
            this._video = updated;
            this._original = JSON.parse(JSON.stringify(updated));
            this._populate(updated);
            this._setStatus('Saved.');
            this.emit('video-saved', { video: updated, patch });
            return updated;
        } catch (err) {
            this._setError('save', err.message);
        } finally {
            this._saveBtn.disabled = false;
            this._saveBtn.textContent = 'Save changes';
        }
    }

    /** Upload the picked thumbnail file. */
    async uploadThumbnail() {
        if (!this._api || !this._video || !this._thumbBlob) return;
        this._thumbUploadBtn.disabled = true;
        this._thumbUploadBtn.textContent = 'Uploading…';
        try {
            const thumbnails = await this._api.setThumbnail(this._video.id, this._thumbBlob);
            this._setStatus('Thumbnail updated.');
            // Refresh local thumbnail preview from the API response if available
            const url = thumbnails?.medium?.url || thumbnails?.default?.url || URL.createObjectURL(this._thumbBlob);
            this._thumbEl.src = url;
            this.emit('video-thumbnail-set', { id: this._video.id, thumbnails });
            this._thumbBlob = null;
            this._thumbInput.value = '';
            this._thumbNameEl.textContent = '';
        } catch (err) {
            this._setError('thumbnail', err.message);
        } finally {
            this._thumbUploadBtn.disabled = !this._thumbBlob;
            this._thumbUploadBtn.textContent = 'Upload thumbnail';
        }
    }

    /** Delete the video — only works when the title-confirm matches. */
    async deleteVideo() {
        if (!this._api || !this._video) return;
        if (this._confirmInput.value.trim() !== (this._video.snippet?.title || '').trim()) {
            this._setError('delete', 'Confirmation text does not match the video title.');
            return;
        }
        this._deleteBtn.disabled = true;
        this._deleteBtn.textContent = 'Deleting…';
        try {
            await this._api.deleteVideo(this._video.id);
            const id = this._video.id;
            this._video = null;
            this._original = null;
            this._formEl.hidden = true;
            this._headTitleEl.textContent = '(deleted)';
            this._setStatus('Video deleted.');
            this.emit('video-deleted', { id });
        } catch (err) {
            this._setError('delete', err.message);
        } finally {
            this._deleteBtn.disabled = false;
            this._deleteBtn.textContent = 'Delete video';
        }
    }

    // ── Internals ───────────────────────────────────────────────────────────────

    _populate(v) {
        const s = v.snippet || {};
        const st = v.status || {};

        this._headTitleEl.textContent = s.title || '';
        this._headIdEl.textContent    = v.id;
        this._watchLinkEl.hidden = false;
        this._watchLinkEl.href   = `https://www.youtube.com/watch?v=${v.id}`;
        this._watchLinkEl.textContent = `Open on YouTube ↗`;
        if (this._previewToggle) this._previewToggle.hidden = false;

        const thumbUrl = (s.thumbnails?.medium || s.thumbnails?.default || {}).url;
        if (thumbUrl) this._thumbEl.src = thumbUrl;

        this._titleInput.value   = s.title || '';
        this._descInput.value    = s.description || '';
        this._tagsInput.value    = (s.tags || []).join(', ');
        this._privacySelect.value = st.privacyStatus || 'unlisted';

        this._privacyBadge.textContent = st.privacyStatus || '—';
        this._privacyBadge.className = 'yte__badge yte__badge--' + (st.privacyStatus || 'private');

        this._formEl.hidden = false;
    }

    _buildPatch() {
        if (!this._original) return null;
        const original = this._original.snippet || {};
        const origStatus = this._original.status || {};

        const formTags = (this._tagsInput.value || '')
            .split(',').map(t => t.trim()).filter(Boolean);

        const titleChanged   = (this._titleInput.value || '') !== (original.title || '');
        const descChanged    = (this._descInput.value  || '') !== (original.description || '');
        const tagsChanged    = JSON.stringify(formTags) !== JSON.stringify(original.tags || []);
        const privacyChanged = this._privacySelect.value !== (origStatus.privacyStatus || '');

        const patch = {};
        if (titleChanged || descChanged || tagsChanged) {
            patch.snippet = {
                title:       this._titleInput.value || '',
                description: this._descInput.value  || '',
                tags:        formTags,
                categoryId:  original.categoryId || '22',
            };
        }
        if (privacyChanged) {
            patch.status = { privacyStatus: this._privacySelect.value };
        }
        return Object.keys(patch).length ? patch : null;
    }

    _onSubmit(e) { e.preventDefault(); this.save(); }

    _onReset() {
        if (!this._original) return;
        this._populate(this._original);
        this._setStatus('Reverted local changes.');
    }

    _onThumbPick() {
        const file = this._thumbInput.files?.[0];
        this._thumbBlob = file || null;
        this._thumbNameEl.textContent = file ? `${file.name} (${_formatBytes(file.size)})` : '';
        this._thumbUploadBtn.disabled = !file;
    }

    _onConfirmInput() {
        const ok = this._video
            && this._confirmInput.value.trim() === (this._video.snippet?.title || '').trim();
        this._deleteBtn.disabled = !ok;
    }

    _setStatus(msg) {
        this._statusEl.textContent = msg;
        this._statusEl.style.display = msg ? '' : 'none';
    }

    // ── Preview iframe toggle ───────────────────────────────────────────────

    _onPreviewToggle() {
        if (!this._video) return;
        const opening = this._previewWrap.hidden;
        if (opening && !this._previewLoaded) {
            this._previewIframe.src = `https://www.youtube.com/embed/${this._video.id}`;
            this._previewLoaded = true;
        }
        this._previewWrap.hidden = !opening;
        this._previewToggle.textContent = opening ? '✕ Hide preview' : '▶ Preview';
    }

    // ── Playlist picker ─────────────────────────────────────────────────────

    /** @param {boolean} force  reload playlists list even if already cached */
    async _loadPlaylists(force = false) {
        if (!this._api || !this._video) return;
        this._plStatus.textContent = 'Loading playlists…';
        this._plStatus.style.display = '';
        try {
            if (force || !this._playlistsLoaded) {
                const { items } = await this._api.listMyPlaylists({ pageSize: 50 });
                this._playlists = items;
                this._playlistsLoaded = true;
            }
            const ids = this._playlists.map(p => p.id);
            const memberships = await this._api.findVideoPlaylists(this._video.id, ids);
            this._membership = new Map(memberships.map(m => [m.playlistId, m.playlistItemId]));
            this._renderPlaylists();
            this._plStatus.style.display = 'none';
        } catch (err) {
            this._plStatus.textContent = `Could not load playlists: ${err.message}`;
        }
    }

    _renderPlaylists() {
        if (!this._plList) return;
        this._plList.innerHTML = '';
        if (this._playlists.length === 0) {
            this._plStatus.textContent = 'You have no playlists yet.';
            this._plStatus.style.display = '';
            return;
        }
        for (const pl of this._playlists) {
            const inIt = this._membership.has(pl.id);
            const row = document.createElement('label');
            row.className = 'yte__pl-row';
            row.innerHTML = `
                <input type="checkbox" class="yte__pl-check" ${inIt ? 'checked' : ''}>
                <div class="yte__pl-meta">
                    <div class="yte__pl-title"></div>
                    <div class="yte__pl-count">${pl.itemCount} videos</div>
                </div>
            `;
            row.querySelector('.yte__pl-title').textContent = pl.title || '(untitled)';
            const checkbox = row.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', () => this._togglePlaylist(pl, row, checkbox));
            this._plList.appendChild(row);
        }
    }

    async _togglePlaylist(pl, row, checkbox) {
        if (!this._api || !this._video) return;
        const wantIn = checkbox.checked;
        const existingItemId = this._membership.get(pl.id);
        row.classList.add('is-busy');
        try {
            if (wantIn && !existingItemId) {
                const { playlistItemId } = await this._api.addToPlaylist(pl.id, this._video.id);
                this._membership.set(pl.id, playlistItemId);
            } else if (!wantIn && existingItemId) {
                await this._api.removeFromPlaylist(existingItemId);
                this._membership.delete(pl.id);
            }
            this.emit('video-playlists-changed', {
                videoId:     this._video.id,
                playlistIds: [...this._membership.keys()],
            });
        } catch (err) {
            // Roll the checkbox back on failure
            checkbox.checked = !wantIn;
            this._plStatus.style.display = '';
            this._plStatus.textContent = `Playlist update failed: ${err.message}`;
        } finally {
            row.classList.remove('is-busy');
        }
    }

    _setError(step, message) {
        this._errorEl.hidden = false;
        this._errorEl.textContent = message;
        this.emit('video-error', { step, message });
    }

    _clearError() {
        this._errorEl.hidden = true;
        this._errorEl.textContent = '';
    }
}

function _formatBytes(n) {
    if (!n && n !== 0) return '';
    const u = ['B','KB','MB','GB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

customElements.define('sg-youtube-video-editor', SgYouTubeVideoEditor);

export { SgYouTubeVideoEditor };
