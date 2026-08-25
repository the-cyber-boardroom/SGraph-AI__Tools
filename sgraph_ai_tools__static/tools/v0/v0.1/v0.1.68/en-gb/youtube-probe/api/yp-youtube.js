/**
 * yp-youtube.js
 * The YouTube probes — the manual half of the suite.
 *
 * TWO WAYS TO GET A TOKEN, on purpose. The full GIS flow needs a Google Cloud
 * project with a client id and an authorised origin, which is 20 minutes of
 * console work. Pasting a token from Google's OAuth Playground takes two. The
 * question these probes exist to answer is worth answering TODAY, so the fast
 * path is a first-class option, not a fallback.
 *
 * Reuses `requestAccess` from `core/youtube-upload` — the same GIS helper
 * `youtube-editor` already ships, which takes an arbitrary scope.
 *
 * NOTHING HERE DOWNLOADS A VIDEO. Every call is a documented YouTube Data API v3
 * endpoint, and the third-party probes exist to record HOW they refuse — which is
 * itself the finding (pack Decision 1).
 *
 * @module yp-youtube
 */

const V3 = 'https://www.googleapis.com/youtube/v3';
const TOKENINFO = 'https://www.googleapis.com/oauth2/v3/tokeninfo';

export const SCOPES = Object.freeze({
    readonly: 'https://www.googleapis.com/auth/youtube.readonly',
    // captions.download needs this one — WIDER than readonly. Ask for it only
    // when the captions probe is actually run.
    forceSsl: 'https://www.googleapis.com/auth/youtube.force-ssl',
});

const LS_TOKEN = 'yp-access-token';
const LS_CLIENT = 'sg-youtube-client-id';        // shared with youtube-editor

let _token = null;

export function setToken(t) {
    _token = (t || '').trim() || null;
    try { _token ? localStorage.setItem(LS_TOKEN, _token) : localStorage.removeItem(LS_TOKEN); } catch (_) { /* */ }
    return { present: !!_token };
}
export function getToken() {
    if (_token) return _token;
    try { _token = localStorage.getItem(LS_TOKEN) || null; } catch (_) { /* */ }
    return _token;
}
export function getClientId() {
    try { return localStorage.getItem(LS_CLIENT) || ''; } catch (_) { return ''; }
}
export function setClientId(id) {
    try { id ? localStorage.setItem(LS_CLIENT, id.trim()) : localStorage.removeItem(LS_CLIENT); } catch (_) { /* */ }
    return { clientId: getClientId() };
}

/** Interactive sign-in via the GIS helper youtube-editor already uses. */
export async function signIn({ clientId, scope } = {}) {
    const cid = (clientId || getClientId()).trim();
    if (!cid) throw Object.assign(new Error('No Google client id — paste one, or paste an access token instead'), { code: 'no-client-id' });
    setClientId(cid);
    const { requestAccess } = await import('/core/youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js');
    const token = await requestAccess(cid, { scope: scope || `${SCOPES.readonly} ${SCOPES.forceSsl}` });
    const access = typeof token === 'string' ? token : token.accessToken;
    setToken(access);
    return { present: true, scope: (token && token.scope) || scope };
}

/**
 * What is this token actually allowed to do?
 *
 * Worth its own probe: half of "captions.download does not work" reports are a
 * token that was never granted `force-ssl`. Knowing the scopes BEFORE the
 * download probe turns an ambiguous 403 into a clear one.
 */
export async function tokenInfo() {
    const t = getToken();
    if (!t) throw Object.assign(new Error('No access token'), { code: 'no-token' });
    const r = await fetch(`${TOKENINFO}?access_token=${encodeURIComponent(t)}`);
    const body = await r.text();
    let json = null; try { json = JSON.parse(body); } catch (_) { /* */ }
    if (!r.ok) throw Object.assign(new Error(`tokeninfo ${r.status}: ${body.slice(0, 200)}`), { code: 'bad-token', status: r.status });
    const scopes = String(json.scope || '').split(/\s+/).filter(Boolean);
    return {
        scopes,
        hasReadonly: scopes.includes(SCOPES.readonly),
        hasForceSsl: scopes.includes(SCOPES.forceSsl),
        expiresInS: Number(json.expires_in) || null,
        audience: json.aud || null,
    };
}

/** Raw v3 call that always returns the status and body — a refusal is data here. */
async function v3(path, { method = 'GET' } = {}) {
    const t = getToken();
    if (!t) throw Object.assign(new Error('No access token'), { code: 'no-token' });
    const res = await fetch(`${V3}/${path}`, { method, headers: { Authorization: `Bearer ${t}` } });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* not JSON — e.g. a caption body */ }
    return { ok: res.ok, status: res.status, json, text, contentType: res.headers.get('content-type') || '' };
}

/** Your own uploads, via the channel's uploads playlist. */
export async function listMyVideos({ max = 25 } = {}) {
    const ch = await v3('channels?mine=true&part=contentDetails,snippet');
    if (!ch.ok) throw Object.assign(new Error(`channels ${ch.status}: ${describe(ch)}`), { code: 'api-error', status: ch.status });
    const uploads = ch.json?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw Object.assign(new Error('No uploads playlist on this account'), { code: 'no-channel' });
    const pl = await v3(`playlistItems?playlistId=${uploads}&part=snippet,contentDetails&maxResults=${max}`);
    if (!pl.ok) throw Object.assign(new Error(`playlistItems ${pl.status}: ${describe(pl)}`), { code: 'api-error', status: pl.status });
    return {
        channel: ch.json.items[0].snippet?.title || null,
        videos: (pl.json.items || []).map(i => ({
            id: i.contentDetails?.videoId,
            title: i.snippet?.title,
            publishedAt: i.contentDetails?.videoPublishedAt || i.snippet?.publishedAt,
            thumb: i.snippet?.thumbnails?.medium?.url || null,
        })).filter(v => v.id),
    };
}

/** Public metadata for ANY video — the third-party path that should work. */
export async function videoInfo({ videoId }) {
    const r = await v3(`videos?id=${encodeURIComponent(videoId)}&part=snippet,contentDetails,status`);
    if (!r.ok) throw Object.assign(new Error(`videos ${r.status}: ${describe(r)}`), { code: 'api-error', status: r.status });
    const it = r.json?.items?.[0];
    if (!it) throw Object.assign(new Error('No such video, or it is not public'), { code: 'not-found' });
    return {
        id: videoId, title: it.snippet?.title, channel: it.snippet?.channelTitle,
        channelId: it.snippet?.channelId, publishedAt: it.snippet?.publishedAt,
        duration: it.contentDetails?.duration, privacy: it.status?.privacyStatus,
        licensedContent: it.contentDetails?.licensedContent,
    };
}

/**
 * Caption TRACKS for a video.
 *
 * For a video you do not own this is expected to fail — and the shape of that
 * failure is the finding, so the error carries the status and the API's own
 * reason rather than being flattened to "no captions".
 */
export async function listCaptions({ videoId }) {
    const r = await v3(`captions?videoId=${encodeURIComponent(videoId)}&part=snippet`);
    if (!r.ok) {
        throw Object.assign(new Error(`captions.list ${r.status}: ${describe(r)}`), {
            code: r.status === 403 ? 'forbidden' : r.status === 404 ? 'not-found' : 'api-error',
            status: r.status, reason: reasonOf(r),
        });
    }
    return {
        tracks: (r.json.items || []).map(i => ({
            id: i.id,
            language: i.snippet?.language,
            name: i.snippet?.name || '',
            trackKind: i.snippet?.trackKind,          // 'ASR' = auto-generated
            isDraft: i.snippet?.isDraft,
            lastUpdated: i.snippet?.lastUpdated,
        })),
    };
}

/**
 * THE probe the whole pack hinges on: will the API hand back a track body, and
 * specifically an auto-generated (ASR) one?
 *
 * Returns the body on success. On refusal it throws with the status and the API's
 * own reason string — `asr-download-refused` is deliberately distinct from
 * "no captions", because they are different facts and lead to different tools.
 */
export async function downloadCaption({ trackId, format = 'vtt', trackKind }) {
    const r = await v3(`captions/${encodeURIComponent(trackId)}?tfmt=${encodeURIComponent(format)}`);
    if (!r.ok) {
        const reason = reasonOf(r);
        throw Object.assign(new Error(`captions.download ${r.status}: ${describe(r)}`), {
            code: trackKind === 'ASR' ? 'asr-download-refused' : 'download-refused',
            status: r.status, reason, trackKind,
        });
    }
    return { body: r.text, bytes: r.text.length, contentType: r.contentType, format };
}

/**
 * The unofficial `timedtext` endpoint, probed head-on.
 *
 * Expected to fail on CORS from a browser. It is probed anyway because "we
 * assumed it was blocked" and "we watched it be blocked" are different standards
 * of evidence, and this pack has been wrong before by reasoning instead of
 * measuring. A CORS refusal surfaces as a TypeError with no status — record that
 * exactly, rather than dressing it up.
 */
export async function probeTimedText({ videoId, lang = 'en' }) {
    const url = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}&fmt=vtt`;
    try {
        const res = await fetch(url);
        const body = await res.text();
        return { reachable: true, status: res.status, bytes: body.length, sample: body.slice(0, 200) };
    } catch (err) {
        return { reachable: false, error: err.message, likelyCors: /fetch|CORS|Failed/i.test(err.message) };
    }
}

function reasonOf(r) { return r.json?.error?.errors?.[0]?.reason || r.json?.error?.status || null; }
function describe(r) { return r.json?.error?.message || r.text.slice(0, 200); }

/** `https://youtu.be/ID`, `watch?v=ID`, or a bare id. */
export function parseVideoId(input) {
    const s = String(input || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/);
    return m ? m[1] : null;
}
