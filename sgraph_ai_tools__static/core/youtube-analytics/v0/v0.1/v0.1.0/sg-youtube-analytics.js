/**
 * sg-youtube-analytics — YouTube Analytics API v2 client.
 *
 * Pure JS, no UI, no localStorage. Uses a SEPARATE scope from the
 * Data API (`yt-analytics.readonly`) — caller must have requested it
 * during OAuth grant. Quota is also separate from the Data API and is
 * generous (~ 1 query/sec/user, no daily unit cap).
 *
 * Response normalisation: the v2 reports endpoint returns rows as
 * arrays-of-arrays with a parallel `columnHeaders` definition. This
 * client converts that into arrays of objects keyed by column name.
 *
 * @module sg-youtube-analytics
 * @version 0.1.0
 */

const BASE = 'https://youtubeanalytics.googleapis.com/v2/reports';

export const YOUTUBE_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';

/** Format a Date (or YYYY-MM-DD string) as YYYY-MM-DD. */
function _ymd(input) {
    if (typeof input === 'string') return input;
    const d = input || new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** N-days-ago Date. */
function _daysAgo(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d;
}

/** Convert v2 reports response → array of {col: value} objects. */
function _rowsToObjects(j) {
    const cols = (j.columnHeaders || []).map(h => h.name);
    return (j.rows || []).map(row => {
        const o = {};
        cols.forEach((c, i) => { o[c] = row[i]; });
        return o;
    });
}

export class YouTubeAnalytics {
    /** @param {string} accessToken */
    constructor(accessToken) {
        if (!accessToken) throw new Error('YouTubeAnalytics: accessToken required');
        this._token = accessToken;
    }

    get _auth() { return { Authorization: `Bearer ${this._token}` }; }

    async _query(params) {
        const search = new URLSearchParams({ ids: 'channel==MINE', ...params });
        const r = await fetch(`${BASE}?${search}`, { headers: this._auth });
        if (!r.ok) {
            const text = await r.text().catch(() => '');
            const err = new Error(`YouTube Analytics ${r.status}: ${text.slice(0, 300)}`);
            err.status = r.status;
            throw err;
        }
        return r.json();
    }

    /**
     * Channel-wide totals for a date range.
     *
     * @param {{ startDate?: Date|string, endDate?: Date|string, days?: number }} [opts]
     *        Default range: last 28 days ending yesterday (analytics lags ~1 day).
     * @returns {Promise<{ views: number, estimatedMinutesWatched: number,
     *                    subscribersGained: number, subscribersLost: number,
     *                    likes: number, comments: number,
     *                    averageViewDuration: number, averageViewPercentage: number,
     *                    startDate: string, endDate: string }>}
     */
    async getChannelSummary({ startDate, endDate, days = 28 } = {}) {
        const end   = _ymd(endDate   || _daysAgo(1));   // yesterday — analytics lags
        const start = _ymd(startDate || _daysAgo(days));
        const j = await this._query({
            startDate: start,
            endDate:   end,
            metrics:   'views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,averageViewDuration,averageViewPercentage',
        });
        const row = _rowsToObjects(j)[0] || {};
        return { startDate: start, endDate: end, ...row };
    }

    /**
     * Same metrics as getChannelSummary but filtered to one video.
     *
     * @param {string} videoId
     * @param {{ startDate?, endDate?, days?: number }} [opts]
     */
    async getVideoSummary(videoId, { startDate, endDate, days = 28 } = {}) {
        if (!videoId) throw new Error('getVideoSummary: videoId required');
        const end   = _ymd(endDate   || _daysAgo(1));
        const start = _ymd(startDate || _daysAgo(days));
        const j = await this._query({
            startDate: start,
            endDate:   end,
            filters:   `video==${videoId}`,
            metrics:   'views,estimatedMinutesWatched,subscribersGained,likes,comments,averageViewDuration,averageViewPercentage',
        });
        const row = _rowsToObjects(j)[0] || {};
        return { videoId, startDate: start, endDate: end, ...row };
    }

    /**
     * Daily views + watch-time trend for a video — perfect for a sparkline.
     *
     * @param {string} videoId
     * @param {{ days?: number }} [opts]
     * @returns {Promise<{day, views, estimatedMinutesWatched}[]>}  ordered ascending
     */
    async getDailyTrend(videoId, { days = 28 } = {}) {
        if (!videoId) throw new Error('getDailyTrend: videoId required');
        const end   = _ymd(_daysAgo(1));
        const start = _ymd(_daysAgo(days));
        const j = await this._query({
            startDate:  start,
            endDate:    end,
            filters:    `video==${videoId}`,
            dimensions: 'day',
            metrics:    'views,estimatedMinutesWatched',
            sort:       'day',
        });
        return _rowsToObjects(j);
    }

    /**
     * Audience retention curve. Returns ~100 points along the video timeline
     * (0.0 → 1.0 elapsed) with the % of audience still watching at each.
     *
     * Note: requires the video to have non-trivial views; YouTube returns an
     * empty result for videos with too few views to anonymise demographics.
     *
     * @param {string} videoId
     * @returns {Promise<{elapsedVideoTimeRatio, audienceWatchRatio}[]>}
     */
    async getRetentionCurve(videoId) {
        if (!videoId) throw new Error('getRetentionCurve: videoId required');
        // Lifetime range — use the channel's earliest plausible date through today.
        const j = await this._query({
            startDate:  '2005-02-14',                // YouTube launch
            endDate:    _ymd(new Date()),
            filters:    `video==${videoId};audienceType==ORGANIC`,
            dimensions: 'elapsedVideoTimeRatio',
            metrics:    'audienceWatchRatio,relativeRetentionPerformance',
            sort:       'elapsedVideoTimeRatio',
        });
        return _rowsToObjects(j);
    }
}
