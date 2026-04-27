/**
 * sg-youtube-api — YouTube Data API v3 read+edit client.
 *
 * Pairs with sg-youtube-upload (which handles the resumable insert path).
 * Pure JS, no UI, no localStorage. Caching + UI lives in the component layer.
 *
 * Quota notes (default project quota = 10,000 units / day):
 *   channels.list, playlistItems.list, videos.list   1 unit
 *   videos.update, videos.delete, thumbnails.set    50 units each
 *   search.list                                    100 units (avoid)
 *   videos.insert (upload)                       1,600 units
 *
 * Scope choice:
 *   YOUTUBE_READONLY_SCOPE — list + read only
 *   YOUTUBE_FULL_SCOPE     — read + edit + delete + thumbnails
 *
 * @module sg-youtube-api
 * @version 0.1.0
 *
 * @example
 *   import { requestAccess } from '/core/youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js';
 *   import { YouTubeApi, YOUTUBE_FULL_SCOPE }
 *       from '/core/youtube-api/v0/v0.1/v0.1.0/sg-youtube-api.js';
 *
 *   const { accessToken } = await requestAccess(clientId, { scope: YOUTUBE_FULL_SCOPE });
 *   const yt = new YouTubeApi(accessToken);
 *   const channel = await yt.getMyChannel();
 *   const { items, nextPageToken } = await yt.listMyUploads({ pageSize: 50 });
 *   await yt.updateVideo(items[0].id, { snippet: { title: 'New title' } });
 */

const BASE   = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';

export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_FULL_SCOPE     = 'https://www.googleapis.com/auth/youtube';

/**
 * @typedef {Object} YouTubeChannel
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} customUrl
 * @property {string} thumbnailUrl
 * @property {string} uploadsPlaylistId
 * @property {Object} statistics  { subscriberCount, viewCount, videoCount }
 */

/**
 * @typedef {Object} YouTubeVideoSummary
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} publishedAt
 * @property {string} thumbnailUrl       medium (320x180) where available
 * @property {string} [privacyStatus]    requires getVideos() call to populate
 * @property {string} [viewCount]        requires getVideos() call to populate
 * @property {string[]} [tags]
 */

export class YouTubeApi {
    /** @param {string} accessToken */
    constructor(accessToken) {
        if (!accessToken) throw new Error('YouTubeApi: accessToken required');
        this._token = accessToken;
    }

    get _auth() { return { Authorization: `Bearer ${this._token}` }; }

    async _check(r) {
        if (!r.ok) {
            const body = await r.text().catch(() => '');
            throw new Error(`YouTube ${r.status}: ${body.slice(0, 300)}`);
        }
        return r;
    }

    async _json(r) { return (await this._check(r)).json(); }

    // ── Channel ────────────────────────────────────────────────────────────────

    /**
     * Get the authenticated user's channel.
     * @returns {Promise<YouTubeChannel>}
     */
    async getMyChannel() {
        const url = `${BASE}/channels?mine=true&part=snippet,statistics,contentDetails,brandingSettings,topicDetails,status`;
        const j = await this._json(await fetch(url, { headers: this._auth }));
        const c = j.items?.[0];
        if (!c) throw new Error('No channel found for the signed-in account');

        const thumbs = c.snippet?.thumbnails || {};
        const branding = c.brandingSettings || {};
        const topicCats = c.topicDetails?.topicCategories || [];

        return {
            id:                c.id,
            title:             c.snippet?.title || '',
            description:       c.snippet?.description || '',
            customUrl:         c.snippet?.customUrl || '',
            thumbnailUrl:      (thumbs.medium || thumbs.high || thumbs.default || {}).url || '',
            bannerUrl:         branding.image?.bannerExternalUrl || '',
            country:           c.snippet?.country || '',
            defaultLanguage:   c.snippet?.defaultLanguage || '',
            publishedAt:       c.snippet?.publishedAt || '',
            keywords:          branding.channel?.keywords || '',
            topicCategories:   topicCats,                  // Wikipedia URLs
            topicLabels:       topicCats.map(_topicLabel), // human-readable last segment
            uploadsPlaylistId: c.contentDetails?.relatedPlaylists?.uploads || '',
            statistics:        c.statistics || {},
            hiddenSubscribers: !!c.statistics?.hiddenSubscriberCount,
            madeForKids:       !!c.status?.madeForKids,
            channelUrl:        c.snippet?.customUrl
                                   ? `https://www.youtube.com/${c.snippet.customUrl}`
                                   : `https://www.youtube.com/channel/${c.id}`,
            studioUrl:         `https://studio.youtube.com/channel/${c.id}`,
        };
    }

    // ── List uploads ───────────────────────────────────────────────────────────

    /**
     * List the authenticated user's uploaded videos via the uploads playlist.
     * Cheap (1 unit per page). Returns 50 per page by default.
     *
     * If you want privacy/statistics fields, follow this with getVideos(ids).
     *
     * @param {{ uploadsPlaylistId?: string, pageSize?: number, pageToken?: string }} [opts]
     * @returns {Promise<{ items: YouTubeVideoSummary[], nextPageToken: string|null,
     *                    totalResults: number, uploadsPlaylistId: string }>}
     */
    async listMyUploads({ uploadsPlaylistId, pageSize = 50, pageToken } = {}) {
        const playlistId = uploadsPlaylistId || (await this.getMyChannel()).uploadsPlaylistId;
        if (!playlistId) throw new Error('No uploads playlist found');

        const params = new URLSearchParams({
            playlistId,
            part:       'snippet,contentDetails',
            maxResults: String(Math.min(50, Math.max(1, pageSize))),
        });
        if (pageToken) params.set('pageToken', pageToken);

        const j = await this._json(await fetch(`${BASE}/playlistItems?${params}`, { headers: this._auth }));

        const items = (j.items || []).map(it => {
            const s = it.snippet || {};
            const t = s.thumbnails || {};
            return {
                id:           it.contentDetails?.videoId || s.resourceId?.videoId,
                title:        s.title || '',
                description:  s.description || '',
                publishedAt:  it.contentDetails?.videoPublishedAt || s.publishedAt || '',
                thumbnailUrl: (t.medium || t.default || {}).url || '',
            };
        }).filter(v => v.id);

        return {
            items,
            nextPageToken:     j.nextPageToken || null,
            totalResults:      j.pageInfo?.totalResults ?? items.length,
            uploadsPlaylistId: playlistId,
        };
    }

    // ── Get full video details ────────────────────────────────────────────────

    /**
     * Get rich details for one or more videos. Requires the same scope used for
     * listing. Use this to populate privacyStatus / viewCount / tags after listing.
     *
     * @param {string[]} ids   Up to 50 video IDs per call.
     * @param {string} [parts] Comma-separated parts. Default: snippet,status,statistics.
     * @returns {Promise<object[]>} The raw `items` array from the API, one per id.
     */
    async getVideos(ids, parts = 'snippet,status,statistics') {
        if (!Array.isArray(ids) || ids.length === 0) return [];
        if (ids.length > 50) throw new Error('getVideos: max 50 ids per call');
        const params = new URLSearchParams({ id: ids.join(','), part: parts });
        const j = await this._json(await fetch(`${BASE}/videos?${params}`, { headers: this._auth }));
        return j.items || [];
    }

    // ── Update video ──────────────────────────────────────────────────────────

    /**
     * Update video metadata. The YouTube API requires the `snippet` block to
     * include `categoryId` even on partial updates — pass it explicitly or
     * we'll fetch the current value.
     *
     * @param {string} videoId
     * @param {{ snippet?: object, status?: object }} patch
     *        snippet: { title, description, tags, categoryId }
     *        status:  { privacyStatus, embeddable, selfDeclaredMadeForKids }
     * @returns {Promise<object>} updated video resource
     */
    async updateVideo(videoId, patch) {
        if (!videoId) throw new Error('updateVideo: videoId required');
        const parts   = [];
        const body    = { id: videoId };

        if (patch.snippet) {
            const snippet = { ...patch.snippet };
            if (!snippet.categoryId) {
                // YouTube rejects snippet updates that omit categoryId
                const [current] = await this.getVideos([videoId], 'snippet');
                snippet.categoryId = current?.snippet?.categoryId || '22';
                if (!snippet.title)        snippet.title        = current?.snippet?.title || '';
            }
            body.snippet = snippet;
            parts.push('snippet');
        }
        if (patch.status) { body.status = patch.status; parts.push('status'); }

        if (parts.length === 0) throw new Error('updateVideo: nothing to patch');

        const url = `${BASE}/videos?part=${parts.join(',')}`;
        return await this._json(await fetch(url, {
            method:  'PUT',
            headers: { ...this._auth, 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        }));
    }

    // ── Set thumbnail ─────────────────────────────────────────────────────────

    /**
     * Replace a video's thumbnail. Image must be ≤ 2 MB, JPG/PNG/GIF/BMP.
     * @param {string} videoId
     * @param {Blob|File} imageBlob
     * @returns {Promise<{ default: object, medium: object, high: object }>}
     */
    async setThumbnail(videoId, imageBlob) {
        if (!videoId)   throw new Error('setThumbnail: videoId required');
        if (!imageBlob) throw new Error('setThumbnail: imageBlob required');
        const url = `${UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`;
        const j = await this._json(await fetch(url, {
            method:  'POST',
            headers: { ...this._auth, 'Content-Type': imageBlob.type || 'image/jpeg' },
            body:    imageBlob,
        }));
        return j.items?.[0] || j;
    }

    // ── Playlists ─────────────────────────────────────────────────────────────

    /**
     * List the authenticated user's playlists. 1 unit per page (max 50).
     * @param {{ pageSize?: number, pageToken?: string }} [opts]
     * @returns {Promise<{ items: Array, nextPageToken: string|null, totalResults: number }>}
     */
    async listMyPlaylists({ pageSize = 50, pageToken } = {}) {
        const params = new URLSearchParams({
            mine:       'true',
            part:       'snippet,contentDetails',
            maxResults: String(Math.min(50, Math.max(1, pageSize))),
        });
        if (pageToken) params.set('pageToken', pageToken);
        const j = await this._json(await fetch(`${BASE}/playlists?${params}`, { headers: this._auth }));
        const items = (j.items || []).map(p => ({
            id:           p.id,
            title:        p.snippet?.title || '',
            description:  p.snippet?.description || '',
            publishedAt:  p.snippet?.publishedAt || '',
            thumbnailUrl: (p.snippet?.thumbnails?.medium || p.snippet?.thumbnails?.default || {}).url || '',
            itemCount:    p.contentDetails?.itemCount ?? 0,
        }));
        return { items, nextPageToken: j.nextPageToken || null, totalResults: j.pageInfo?.totalResults ?? items.length };
    }

    /**
     * List items in a specific playlist. 1 unit per page.
     * @param {string} playlistId
     * @param {{ pageSize?: number, pageToken?: string }} [opts]
     */
    async listPlaylistItems(playlistId, { pageSize = 50, pageToken } = {}) {
        if (!playlistId) throw new Error('listPlaylistItems: playlistId required');
        const params = new URLSearchParams({
            playlistId,
            part:       'snippet,contentDetails',
            maxResults: String(Math.min(50, Math.max(1, pageSize))),
        });
        if (pageToken) params.set('pageToken', pageToken);
        const j = await this._json(await fetch(`${BASE}/playlistItems?${params}`, { headers: this._auth }));
        const items = (j.items || []).map(it => {
            const s = it.snippet || {};
            const t = s.thumbnails || {};
            return {
                playlistItemId: it.id,                              // needed for removal
                videoId:        it.contentDetails?.videoId || s.resourceId?.videoId,
                title:          s.title || '',
                description:    s.description || '',
                publishedAt:    it.contentDetails?.videoPublishedAt || s.publishedAt || '',
                thumbnailUrl:   (t.medium || t.default || {}).url || '',
                position:       s.position ?? null,
            };
        });
        return { items, nextPageToken: j.nextPageToken || null, totalResults: j.pageInfo?.totalResults ?? items.length };
    }

    /**
     * For a given videoId, return which of the supplied playlists contain it.
     * Cost: 1 unit per playlist queried (one playlistItems.list call each,
     * filtered by videoId — YouTube does not expose a "playlists for video"
     * endpoint, so we fan out per playlist).
     *
     * @param {string} videoId
     * @param {string[]} playlistIds
     * @returns {Promise<{ playlistId: string, playlistItemId: string }[]>}
     *          One entry per playlist that contains the video. The
     *          playlistItemId is needed to remove the video later.
     */
    async findVideoPlaylists(videoId, playlistIds = []) {
        if (!videoId) throw new Error('findVideoPlaylists: videoId required');
        const checks = await Promise.all(playlistIds.map(async pid => {
            const params = new URLSearchParams({
                playlistId: pid,
                videoId,
                part:       'id',
                maxResults: '1',
            });
            try {
                const j = await this._json(await fetch(`${BASE}/playlistItems?${params}`, { headers: this._auth }));
                const item = j.items?.[0];
                return item ? { playlistId: pid, playlistItemId: item.id } : null;
            } catch {
                return null;   // non-fatal — a 403 on one playlist shouldn't kill the whole check
            }
        }));
        return checks.filter(Boolean);
    }

    /**
     * Add a video to a playlist. 50 units.
     * @param {string} playlistId
     * @param {string} videoId
     * @param {{ position?: number }} [opts]
     * @returns {Promise<{ playlistItemId: string }>}
     */
    async addToPlaylist(playlistId, videoId, { position } = {}) {
        if (!playlistId || !videoId) throw new Error('addToPlaylist: playlistId + videoId required');
        const body = {
            snippet: {
                playlistId,
                resourceId: { kind: 'youtube#video', videoId },
                ...(position !== undefined ? { position } : {}),
            },
        };
        const j = await this._json(await fetch(`${BASE}/playlistItems?part=snippet`, {
            method:  'POST',
            headers: { ...this._auth, 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        }));
        return { playlistItemId: j.id };
    }

    /**
     * Remove a video from a playlist by playlistItemId. 50 units.
     * @param {string} playlistItemId
     */
    async removeFromPlaylist(playlistItemId) {
        if (!playlistItemId) throw new Error('removeFromPlaylist: playlistItemId required');
        const r = await fetch(`${BASE}/playlistItems?id=${encodeURIComponent(playlistItemId)}`, {
            method:  'DELETE',
            headers: this._auth,
        });
        if (r.status !== 204) await this._check(r);
    }

    // ── Delete video (irreversible) ───────────────────────────────────────────

    /**
     * Delete a video. There is no undo at YouTube's end.
     * @param {string} videoId
     * @returns {Promise<void>}
     */
    async deleteVideo(videoId) {
        if (!videoId) throw new Error('deleteVideo: videoId required');
        const r = await fetch(`${BASE}/videos?id=${encodeURIComponent(videoId)}`, {
            method:  'DELETE',
            headers: this._auth,
        });
        if (r.status !== 204) await this._check(r);
    }
}

/** Topic URL → human label. e.g. ".../Software_engineering" → "Software engineering". */
function _topicLabel(url) {
    try {
        const last = decodeURIComponent(String(url).split('/').pop() || '');
        return last.replace(/_/g, ' ');
    } catch { return ''; }
}
