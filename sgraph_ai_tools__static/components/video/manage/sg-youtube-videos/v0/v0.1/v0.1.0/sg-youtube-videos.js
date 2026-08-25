/* =================================================================================
   SGraph — YouTube Videos List Component
   v0.1.0 — Grid of the signed-in user's uploads, with stats enrichment,
            local search/sort, and click-to-select rows.

   Usage:
     <script type="module" src="/components/video/manage/sg-youtube-videos/v0/v0.1/v0.1.0/sg-youtube-videos.js"></script>
     <sg-youtube-videos page-size="50"></sg-youtube-videos>

   Attributes:
     page-size   — videos per page (max 50, default 50)
     auto-load   — call refresh() on first setToken() (boolean)

   Events (composed, bubble):
     videos-loaded   { items, totalResults, page }   each successful page load
     videos-error    { message }                     fetch failed
     video-selected  { video, id }                   user clicked a row

   Methods:
     setToken(token)   provide GIS access token; null clears
     refresh()         reload from page 1
     loadMore()        fetch the next page
     getItems()        currently-loaded videos (full enriched objects)
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
        this._items        = [];
        this._nextPage     = null;
        this._totalResults = 0;
        this._page         = 0;
        this._loading      = false;
        this._uploadsPlaylistId = null;

        this._filter = '';
        this._sort   = 'newest';

        this._pageSize = Math.max(1, Math.min(50, parseInt(this.getAttribute('page-size') || '50', 10) || 50));
        this._refreshUI();

        // Replay any refresh() calls made before bindElements() ran.
        if (this._pendingRefresh) {
            this._pendingRefresh = false;
            this.refresh();
        }
    }

    bindElements() {
        this._statusEl   = this.$('#status');
        this._gridEl     = this.$('#grid');
        this._countEl    = this.$('#count');
        this._refreshBtn = this.$('#refresh-btn');
        this._moreBtn    = this.$('#more-btn');
        this._filterInput = this.$('#filter-input');
        this._sortSelect  = this.$('#sort-select');
    }

    setupEventListeners() {
        this.addTrackedListener(this._refreshBtn,  'click', () => this.refresh());
        this.addTrackedListener(this._moreBtn,     'click', () => this.loadMore());
        this.addTrackedListener(this._filterInput, 'input', this._onFilterChange);
        this.addTrackedListener(this._sortSelect,  'change', this._onSortChange);
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    setToken(token) {
        this._api = token ? new YouTubeApi(token) : null;
        if (token && this.hasAttribute('auto-load')) this.refresh();
    }

    getItems() { return [...this._items]; }

    async refresh() {
        if (!this._gridEl) {
            // bindElements() hasn't run yet — defer until onReady
            this._pendingRefresh = true;
            return;
        }
        if (!this._api) { this._setStatus('Not signed in.'); return; }
        this._items        = [];
        this._nextPage     = null;
        this._page         = 0;
        this._gridEl.innerHTML = '';
        await this._fetchPage();
    }

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

            // Enrich with stats / privacy / duration in a follow-up call.
            // 1 unit regardless of how many ids (up to 50). Best effort:
            // if it fails (e.g. 403 with readonly scope), fall back to plain rows.
            const ids = items.map(v => v.id).filter(Boolean);
            let detailById = {};
            if (ids.length) {
                try {
                    const details = await this._api.getVideos(ids, 'snippet,status,statistics,contentDetails');
                    for (const d of details) detailById[d.id] = d;
                } catch { /* enrichment is non-critical */ }
            }

            const enriched = items.map(v => {
                const d = detailById[v.id];
                return {
                    ...v,
                    privacyStatus: d?.status?.privacyStatus || null,
                    viewCount:     d?.statistics?.viewCount  || null,
                    likeCount:     d?.statistics?.likeCount  || null,
                    duration:      d?.contentDetails?.duration || null,  // ISO-8601 e.g. PT4M13S
                    uploadStatus:  d?.status?.uploadStatus || null,
                };
            });

            this._items.push(...enriched);
            this._page++;
            this._renderAll();
            this._setStatus(this._items.length === 0 ? 'No uploads yet.' : '');
            this.emit('videos-loaded', { items: enriched, totalResults, page: this._page });
        } catch (err) {
            this._setStatus(err.message, true);
            this.emit('videos-error', { message: err.message });
        } finally {
            this._loading = false;
            this._refreshUI();
        }
    }

    _onFilterChange() {
        this._filter = (this._filterInput.value || '').toLowerCase().trim();
        this._renderAll();
    }

    _onSortChange() {
        this._sort = this._sortSelect.value || 'newest';
        this._renderAll();
    }

    _filteredSorted() {
        let rows = this._items;
        if (this._filter) {
            rows = rows.filter(v =>
                (v.title || '').toLowerCase().includes(this._filter)
                || (v.description || '').toLowerCase().includes(this._filter));
        }
        rows = [...rows];
        switch (this._sort) {
            case 'oldest':
                rows.sort((a, b) => _dateMs(a.publishedAt) - _dateMs(b.publishedAt)); break;
            case 'most-viewed':
                rows.sort((a, b) => (Number(b.viewCount) || 0) - (Number(a.viewCount) || 0)); break;
            case 'longest':
                rows.sort((a, b) => _isoToSecs(b.duration) - _isoToSecs(a.duration)); break;
            case 'shortest':
                rows.sort((a, b) => _isoToSecs(a.duration) - _isoToSecs(b.duration)); break;
            case 'title-az':
                rows.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
            case 'newest':
            default:
                rows.sort((a, b) => _dateMs(b.publishedAt) - _dateMs(a.publishedAt));
        }
        return rows;
    }

    _renderAll() {
        const rows = this._filteredSorted();
        this._gridEl.innerHTML = '';
        for (const v of rows) this._gridEl.appendChild(this._renderRow(v));
        this._refreshUI();
    }

    _renderRow(v) {
        const row = document.createElement('div');
        row.className = 'ytv__row';
        row.role = 'listitem';
        row.dataset.videoId = v.id;

        const dur     = _isoToHms(v.duration);
        const views   = _formatNumber(v.viewCount);
        const privacy = v.privacyStatus
            ? `<span class="ytv__badge ytv__badge--${v.privacyStatus} ytv__row-privacy">${v.privacyStatus}</span>`
            : '';

        row.innerHTML = `
            <img class="ytv__thumb" src="${_escape(v.thumbnailUrl)}" alt="" loading="lazy">
            <div class="ytv__meta">
                <div class="ytv__row-title">${_escape(v.title)}</div>
                <div class="ytv__sub ytv__row-stats">
                    <span>${_formatDate(v.publishedAt)}</span>
                    ${dur     ? `<span class="ytv__duration">${dur}</span>` : ''}
                    ${views   ? `<span>${views} views</span>` : ''}
                </div>
            </div>
            ${privacy}
        `;
        row.addEventListener('click', () => {
            this.emit('video-selected', { video: v, id: v.id });
        });
        return row;
    }

    _refreshUI() {
        if (!this._countEl) return;
        const visible = this._filter || this._sort !== 'newest'
            ? this._filteredSorted().length
            : this._items.length;
        const loaded  = this._items.length;
        const total   = this._totalResults;

        let countText = '';
        if (this._filter && visible !== loaded) countText = `${visible} of ${loaded} loaded`;
        else if (total) countText = `${loaded} of ${total}`;
        else if (loaded) countText = `${loaded}`;
        this._countEl.textContent = countText;

        this._refreshBtn.disabled = this._loading || !this._api;
        this._moreBtn.hidden      = !this._nextPage || !this._api;
        this._moreBtn.disabled    = this._loading;
        this._moreBtn.textContent = this._loading ? 'Loading…' : 'Load more';
    }

    _setStatus(msg, isError = false) {
        if (!this._statusEl) return;
        this._statusEl.textContent = msg;
        this._statusEl.classList.toggle('ytv__status--err', !!isError);
        this._statusEl.style.display = msg ? '' : 'none';
    }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function _escape(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
}

function _formatDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return iso; }
}

function _dateMs(iso) {
    if (!iso) return 0;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
}

/** ISO 8601 duration → seconds. PT1H2M3S → 3723. */
function _isoToSecs(iso) {
    if (!iso) return 0;
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
    if (!m) return 0;
    const [, d, h, mn, s] = m.map(x => x ? parseInt(x, 10) : 0);
    return d * 86400 + h * 3600 + mn * 60 + s;
}

/** ISO 8601 duration → "1:02:03" or "2:03". */
function _isoToHms(iso) {
    const total = _isoToSecs(iso);
    if (!total) return '';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
}

/** 12345 → "12.3K", 1234567 → "1.2M". */
function _formatNumber(n) {
    if (n === null || n === undefined || n === '') return '';
    const num = Number(n);
    if (!Number.isFinite(num)) return '';
    if (num < 1000)        return String(num);
    if (num < 1_000_000)   return (num / 1000).toFixed(num < 10_000 ? 1 : 0) + 'K';
    if (num < 1e9)         return (num / 1_000_000).toFixed(1) + 'M';
    return (num / 1e9).toFixed(1) + 'B';
}

customElements.define('sg-youtube-videos', SgYouTubeVideos);

export { SgYouTubeVideos };
