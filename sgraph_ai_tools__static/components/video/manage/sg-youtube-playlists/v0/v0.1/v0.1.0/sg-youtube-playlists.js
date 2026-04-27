/* =================================================================================
   SGraph — YouTube Playlists Component
   v0.1.0 — List the signed-in user's playlists. Click a row to expand and
            lazy-load the videos in that playlist.

   Methods:
     setToken(token)   provide GIS access token; null clears
     refresh()         reload playlists list
     getItems()        currently-loaded playlists

   Events (composed, bubble):
     playlists-loaded         { items, totalResults }
     playlists-error          { message }
     playlist-expanded        { playlistId, items }
     playlist-item-selected   { playlistId, videoId, item }
   ================================================================================= */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';
import { YouTubeApi }  from '/core/youtube-api/v0/v0.1/v0.1.0/sg-youtube-api.js';

class SgYouTubePlaylists extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-youtube-playlists' }

    get sharedCssPaths() {
        return ['/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css']
    }

    onReady() {
        this._api      = null;
        this._items    = [];
        this._loading  = false;
        this._expanded = new Map();   // playlistId → items[] cache
        this._refreshUI();

        if (this._pendingRefresh) {
            this._pendingRefresh = false;
            this.refresh();
        }
    }

    bindElements() {
        this._statusEl   = this.$('#status');
        this._listEl     = this.$('#list');
        this._countEl    = this.$('#count');
        this._refreshBtn = this.$('#refresh-btn');
    }

    setupEventListeners() {
        this.addTrackedListener(this._refreshBtn, 'click', () => this.refresh());
    }

    setToken(token) { this._api = token ? new YouTubeApi(token) : null; }
    getItems()      { return [...this._items]; }

    async refresh() {
        if (!this._listEl) { this._pendingRefresh = true; return; }
        if (!this._api) { this._setStatus('Not signed in.'); return; }

        this._loading = true;
        this._refreshUI();
        this._setStatus('Loading…');
        this._listEl.innerHTML = '';
        this._expanded.clear();

        try {
            const { items, totalResults } = await this._api.listMyPlaylists({ pageSize: 50 });
            this._items = items;
            this._renderAll();
            this._setStatus(items.length === 0 ? 'You have no playlists yet.' : '');
            this.emit('playlists-loaded', { items, totalResults });
        } catch (err) {
            this._setStatus(err.message, true);
            this.emit('playlists-error', { message: err.message });
        } finally {
            this._loading = false;
            this._refreshUI();
        }
    }

    _renderAll() {
        this._listEl.innerHTML = '';
        for (const pl of this._items) this._listEl.appendChild(this._renderRow(pl));
    }

    _renderRow(pl) {
        const row = document.createElement('div');
        row.className = 'ytpl__row';
        row.dataset.playlistId = pl.id;
        row.innerHTML = `
            <div class="ytpl__row-head">
                <img class="ytpl__pl-thumb" src="${_escape(pl.thumbnailUrl)}" alt="" loading="lazy">
                <div class="ytpl__pl-meta">
                    <div class="ytpl__pl-title"></div>
                    <div class="ytpl__pl-sub">${pl.itemCount} videos</div>
                </div>
                <span class="ytpl__chev">▸</span>
            </div>
            <div class="ytpl__items" hidden>
                <div class="ytpl__items-status">Loading…</div>
            </div>
        `;
        row.querySelector('.ytpl__pl-title').textContent = pl.title || '(untitled)';
        row.querySelector('.ytpl__row-head').addEventListener('click', () => this._toggleRow(pl, row));
        return row;
    }

    async _toggleRow(pl, row) {
        const itemsEl = row.querySelector('.ytpl__items');
        const open = !itemsEl.hidden;
        if (open) {
            itemsEl.hidden = true;
            row.classList.remove('is-open');
            return;
        }
        itemsEl.hidden = false;
        row.classList.add('is-open');

        // Cache hit?
        if (this._expanded.has(pl.id)) {
            this._renderItems(itemsEl, pl, this._expanded.get(pl.id));
            return;
        }

        itemsEl.innerHTML = `<div class="ytpl__items-status">Loading…</div>`;
        try {
            const { items } = await this._api.listPlaylistItems(pl.id, { pageSize: 50 });
            this._expanded.set(pl.id, items);
            this._renderItems(itemsEl, pl, items);
            this.emit('playlist-expanded', { playlistId: pl.id, items });
        } catch (err) {
            itemsEl.innerHTML = `<div class="ytpl__items-status" style="color:#E94560">${_escape(err.message)}</div>`;
        }
    }

    _renderItems(itemsEl, pl, items) {
        itemsEl.innerHTML = '';
        if (items.length === 0) {
            itemsEl.innerHTML = `<div class="ytpl__items-status">No videos in this playlist.</div>`;
            return;
        }
        for (const it of items) {
            const row = document.createElement('div');
            row.className = 'ytpl__item';
            row.innerHTML = `
                <img class="ytpl__item-thumb" src="${_escape(it.thumbnailUrl)}" alt="" loading="lazy">
                <span class="ytpl__item-title"></span>
            `;
            row.querySelector('.ytpl__item-title').textContent = it.title || it.videoId;
            row.addEventListener('click', () => {
                this.emit('playlist-item-selected', {
                    playlistId: pl.id,
                    videoId:    it.videoId,
                    item:       it,
                });
            });
            itemsEl.appendChild(row);
        }
    }

    _refreshUI() {
        if (!this._countEl) return;
        this._countEl.textContent  = this._items.length ? `${this._items.length} playlists` : '';
        this._refreshBtn.disabled  = this._loading || !this._api;
    }

    _setStatus(msg, isError = false) {
        if (!this._statusEl) return;
        this._statusEl.textContent = msg;
        this._statusEl.classList.toggle('ytpl__status--err', !!isError);
        this._statusEl.style.display = msg ? '' : 'none';
    }
}

function _escape(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
}

customElements.define('sg-youtube-playlists', SgYouTubePlaylists);

export { SgYouTubePlaylists };
