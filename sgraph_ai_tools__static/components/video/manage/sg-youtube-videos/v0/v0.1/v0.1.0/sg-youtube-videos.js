/* =================================================================================
   SGraph — YouTube Videos List Component
   v0.1.0 — Grid of the signed-in user's uploads.

   Usage:
     <script type="module"
             src="/components/video/manage/sg-youtube-videos/v0/v0.1/v0.1.0/sg-youtube-videos.js"></script>

     <sg-youtube-videos page-size="50"></sg-youtube-videos>

     const el = document.querySelector('sg-youtube-videos');
     el.setToken(accessToken);          // call after OAuth grant
     await el.refresh();                // load first page
     el.addEventListener('video-selected', e => console.log(e.detail.video));

   Attributes:
     page-size   — videos per page (max 50, default 50)
     auto-load   — call refresh() on first setToken (boolean)

   Events:
     videos-loaded   { items, totalResults, page }   each successful page load
     videos-error    { message }                     fetch failed
     video-selected  { video, id }                   user clicked a row
   ================================================================================= */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';
import { YouTubeApi }  from '/core/youtube-api/v0/v0.1/v0.1.0/sg-youtube-api.js';

class SgYouTubeVideos extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-youtube-videos' }

    get sharedCssPaths() {
        return ['/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css']
    }

    onReady() {
        this._api          = null;
        this._items        = [];          // accumulated across pages
        this._nextPage     = null;
        this._totalResults = 0;
        this._page         = 0;
        this._loading      = false;
        this._uploadsPlaylistId = null;

        this._pageSize = Math.max(1, Math.min(50, parseInt(this.getAttribute('page-size') || '50', 10) || 50));
        this._refreshUI();
    }

    bindElements() {
        this._statusEl  = this.$('#status');
        this._gridEl    = this.$('#grid');
        this._countEl   = this.$('#count');
        this._refreshBtn = this.$('#refresh-btn');
        this._moreBtn    = this.$('#more-btn');
    }

    setupEventListeners() {
        this.addTrackedListener(this._refreshBtn, 'click', () => this.refresh());
        this.addTrackedListener(this._moreBtn,    'click', () => this.loadMore());
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    /**
     * Provide the access token (after the host completes OAuth).
     * @param {string|null} token
     */
    setToken(token) {
        this._api = token ? new YouTubeApi(token) : null;
        if (token && this.hasAttribute('auto-load')) this.refresh();
    }

    /** @returns {object[]} The currently-loaded videos (across all loaded pages). */
    getItems() { return [...this._items]; }

    /** Reset and load the first page. */
    async refresh() {
        if (!this._api) { this._setStatus('Not signed in.'); return; }
        this._items        = [];
        this._nextPage     = null;
        this._page         = 0;
        this._gridEl.innerHTML = '';
        await this._fetchPage();
    }

    /** Load the next page after a refresh(). */
    async loadMore() {
        if (!this._api || !this._nextPage || this._loading) return;
        await this._fetchPage();
    }

    // ── Internals ───────────────────────────────────────────────────────────────

    async _fetchPage() {
        this._loading = true;
        this._refreshUI();
        this._setStatus('Loading…');
        try {
            const { items, nextPageToken, totalResults, uploadsPlaylistId }
                = await this._api.listMyUploads({
                    uploadsPlaylistId: this._uploadsPlaylistId,
                    pageSize:          this._pageSize,
                    pageToken:         this._nextPage || undefined,
                });

            this._uploadsPlaylistId = uploadsPlaylistId;
            this._nextPage          = nextPageToken;
            this._totalResults      = totalResults;
            this._items.push(...items);
            this._page++;

            this._renderRows(items);
            this._setStatus(this._items.length === 0 ? 'No uploads yet.' : '');
            this.emit('videos-loaded', { items, totalResults, page: this._page });
        } catch (err) {
            this._setStatus(err.message, true);
            this.emit('videos-error', { message: err.message });
        } finally {
            this._loading = false;
            this._refreshUI();
        }
    }

    _renderRows(rows) {
        for (const v of rows) {
            const row = document.createElement('div');
            row.className = 'ytv__row';
            row.role = 'listitem';
            row.dataset.videoId = v.id;
            row.innerHTML = `
                <img class="ytv__thumb" src="${_escape(v.thumbnailUrl)}" alt="" loading="lazy">
                <div class="ytv__meta">
                    <div class="ytv__row-title">${_escape(v.title)}</div>
                    <div class="ytv__sub">
                        <span>${_formatDate(v.publishedAt)}</span>
                    </div>
                </div>
            `;
            row.addEventListener('click', () => {
                this.emit('video-selected', { video: v, id: v.id });
            });
            this._gridEl.appendChild(row);
        }
    }

    _refreshUI() {
        if (!this._countEl) return;
        const loaded = this._items.length;
        const total  = this._totalResults;
        this._countEl.textContent = total
            ? `${loaded} of ${total}`
            : (loaded ? `${loaded}` : '');
        this._refreshBtn.disabled = this._loading || !this._api;
        this._moreBtn.hidden      = !this._nextPage || !this._api;
        this._moreBtn.disabled    = this._loading;
        this._moreBtn.textContent = this._loading ? 'Loading…' : 'Load more';
    }

    _setStatus(msg, isError = false) {
        this._statusEl.textContent = msg;
        this._statusEl.classList.toggle('ytv__status--err', !!isError);
        this._statusEl.style.display = msg ? '' : 'none';
    }
}

function _escape(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
}

function _formatDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
}

customElements.define('sg-youtube-videos', SgYouTubeVideos);

export { SgYouTubeVideos };
