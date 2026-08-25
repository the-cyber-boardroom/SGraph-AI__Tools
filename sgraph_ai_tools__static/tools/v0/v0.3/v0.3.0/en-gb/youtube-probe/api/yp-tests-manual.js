/**
 * yp-tests-manual.js
 * Tests that need a Google access token or a user gesture.
 *
 * M4 is the one the whole v0.2.92 pack hinges on. Everything else in this file
 * exists to make M4's answer interpretable: M1 proves the token has the scope, M3
 * proves a track exists, and M5–M7 establish what the third-party path can and
 * cannot do — so an M4 failure cannot be mistaken for a setup problem.
 *
 * @module yp-tests-manual
 */

import * as YT from './yp-youtube.js';
import { parseCaptions } from './yp-captions.js';
import { probeTabCapture, VERDICTS } from './yp-tabcapture.js';

const needVideo = ctx => {
    const id = YT.parseVideoId(ctx.videoId);
    if (!id) throw Object.assign(new Error('Set a video id or URL first'), { code: 'no-token' });
    return id;
};

export const MANUAL_TESTS = [
    {
        id: 'M1', group: 'Your own videos (needs a token)', needs: 'token',
        title: 'The token exists and carries the right scopes',
        hypothesis: 'captions.download needs `youtube.force-ssl`, which is wider than `youtube.readonly`.',
        meaning: {
            pass: 'Any later 403 is a real API refusal, not a missing grant — which is the only way M4 is interpretable.',
            fail: 'Re-issue the token with force-ssl before reading anything into M4.',
        },
        async run() {
            const info = await YT.tokenInfo();
            return {
                status: info.hasForceSsl ? 'pass' : 'fail',
                detail: info.hasForceSsl
                    ? `Token valid for ~${info.expiresInS}s with force-ssl granted.`
                    : `Token is valid but force-ssl is NOT granted (${info.scopes.length} scopes). captions.download will 403 for a reason that has nothing to do with ASR.`,
                evidence: info,
            };
        },
    },
    {
        id: 'M2', group: 'Your own videos (needs a token)', needs: 'token',
        title: 'List my uploads',
        hypothesis: 'The existing v3 client can enumerate your own channel — the corpus picker needs nothing new.',
        meaning: {
            pass: 'core/youtube-api v0.1.0 covers the library panel as-is.',
            fail: 'Check the token is for the account that owns the channel.',
        },
        async run(ctx) {
            const r = await YT.listMyVideos({ max: 25 });
            ctx.myVideos = r.videos;
            return {
                status: r.videos.length ? 'pass' : 'fail',
                detail: r.videos.length
                    ? `${r.videos.length} uploads on “${r.channel}”. First: ${r.videos[0].title} (${r.videos[0].id}).`
                    : 'The call succeeded but the channel has no uploads.',
                evidence: { channel: r.channel, videos: r.videos.slice(0, 10) },
            };
        },
    },
    {
        id: 'M3', group: 'Your own videos (needs a token)', needs: 'token',
        title: 'captions.list on a video you own',
        hypothesis: 'Your talks have an auto-generated (ASR) track, and the API will at least admit it exists.',
        meaning: {
            pass: 'A track exists. Whether its BODY can be fetched is M4 — do not conflate the two.',
            fail: 'No track at all: route B is unavailable for this video regardless of what M4 says.',
        },
        async run(ctx) {
            const id = needVideo(ctx);
            const r = await YT.listCaptions({ videoId: id });
            const asr = r.tracks.filter(t => t.trackKind === 'ASR');
            ctx.tracks = r.tracks;
            return {
                status: r.tracks.length ? 'pass' : 'fail',
                detail: r.tracks.length
                    ? `${r.tracks.length} track(s); ${asr.length} auto-generated (ASR), ${r.tracks.length - asr.length} uploaded/edited.`
                    : 'No caption tracks on this video.',
                evidence: { videoId: id, tracks: r.tracks },
            };
        },
    },
    {
        id: 'M4', group: 'Your own videos (needs a token)', needs: 'token',
        title: '⭐ captions.download on an AUTO-GENERATED track',
        hypothesis: 'THE question the pack hinges on: will the API return the body of an ASR track to a third-party OAuth client, or refuse it?',
        meaning: {
            pass: 'Route B is the primary ingest for your own videos. The words are free and already timestamped — no VAD, no silence threshold, and the whole class of defect that has bitten this project twice cannot arise on that path.',
            fail: 'Route B degrades to manually-uploaded tracks only, which most talk uploads do not have. The corpus runs on route A (Studio download) or C (tab capture) with real transcription — and pack Phase 2 shrinks to optional.',
            blocked: 'Unanswered. Needs a token with force-ssl (M1) and one of your own video ids (M3).',
        },
        async run(ctx) {
            const id = needVideo(ctx);
            const tracks = ctx.tracks || (await YT.listCaptions({ videoId: id })).tracks;
            const asr = tracks.find(t => t.trackKind === 'ASR');
            const track = asr || tracks[0];
            if (!track) return { status: 'blocked', detail: 'No caption track to try — run M3 first.', evidence: { videoId: id } };
            try {
                const dl = await YT.downloadCaption({ trackId: track.id, format: 'vtt', trackKind: track.trackKind });
                const parsed = parseCaptions(dl.body);
                ctx.cues = parsed.cues;
                return {
                    status: 'pass',
                    detail: `Downloaded a ${track.trackKind} track: ${dl.bytes} bytes, ${parsed.cues.length} cues parsed (${parsed.format}). First cue: “${parsed.cues[0]?.text?.slice(0, 60) || ''}”.`,
                    evidence: {
                        videoId: id, trackKind: track.trackKind, bytes: dl.bytes,
                        format: parsed.format, cues: parsed.cues.length, dropped: parsed.dropped,
                        firstCues: parsed.cues.slice(0, 5),
                    },
                };
            } catch (err) {
                return {
                    status: 'fail',
                    detail: `${track.trackKind} track refused — HTTP ${err.status}${err.reason ? ` (${err.reason})` : ''}. ${err.message}`,
                    evidence: { videoId: id, trackKind: track.trackKind, status: err.status, reason: err.reason, code: err.code },
                };
            }
        },
    },
    {
        id: 'M5', group: 'Other people\'s videos', needs: 'token',
        title: 'captions.list on a video you do NOT own',
        hypothesis: 'The captions API is owner-only, so this should be refused — and HOW it refuses is the finding.',
        meaning: {
            fail: 'Expected, and it is the evidence for pack Decision 1: the caption route cannot serve third-party videos, so those need route C (tab capture). Record the exact status so the UI can say the right thing.',
            pass: 'UNEXPECTED — third-party captions are reachable, which would widen the tool considerably. Re-check that the video really is not yours.',
        },
        async run(ctx) {
            const id = YT.parseVideoId(ctx.otherVideoId);
            if (!id) return { status: 'blocked', detail: 'Set a third-party video id or URL first.', evidence: null };
            try {
                const r = await YT.listCaptions({ videoId: id });
                return {
                    status: 'pass',
                    detail: `Unexpectedly returned ${r.tracks.length} track(s) for a video you do not own.`,
                    evidence: { videoId: id, tracks: r.tracks },
                };
            } catch (err) {
                return {
                    status: 'fail',
                    detail: `Refused with HTTP ${err.status}${err.reason ? ` (${err.reason})` : ''} — as expected for a video you do not own.`,
                    evidence: { videoId: id, status: err.status, reason: err.reason, code: err.code, message: err.message },
                };
            }
        },
    },
    {
        id: 'M6', group: 'Other people\'s videos', needs: 'token',
        title: 'Public metadata for any video',
        hypothesis: 'videos.list returns title, channel and duration for any public video — enough to label a tab-captured session properly.',
        meaning: {
            pass: 'Third-party sessions can carry real provenance (title, channel, date) even though the captions route is closed to them.',
            fail: 'Tab-captured sessions would have to be labelled by hand.',
        },
        async run(ctx) {
            const id = YT.parseVideoId(ctx.otherVideoId) || needVideo(ctx);
            const info = await YT.videoInfo({ videoId: id });
            return {
                status: 'pass',
                detail: `“${info.title}” — ${info.channel}, ${info.duration}, ${info.privacy}.`,
                evidence: info,
            };
        },
    },
    {
        id: 'M7', group: 'Other people\'s videos', needs: null,
        title: 'The unofficial timedtext endpoint, from a browser',
        hypothesis: 'youtube.com/api/timedtext has no CORS headers, so a page cannot read it. Probed rather than assumed.',
        meaning: {
            fail: 'Confirmed blocked. Worth having watched: “we assumed” and “we measured” are different standards, and this project has been wrong by reasoning before.',
            pass: 'It responded — record exactly what came back before relying on an endpoint YouTube does not document.',
        },
        async run(ctx) {
            const id = YT.parseVideoId(ctx.otherVideoId) || YT.parseVideoId(ctx.videoId);
            if (!id) return { status: 'blocked', detail: 'Set a video id first.', evidence: null };
            const r = await YT.probeTimedText({ videoId: id });
            return {
                status: r.reachable ? 'pass' : 'fail',
                detail: r.reachable
                    ? `Reachable: HTTP ${r.status}, ${r.bytes} bytes.`
                    : `Blocked from the browser: ${r.error}${r.likelyCors ? ' (consistent with a CORS refusal — no response is visible to the page)' : ''}.`,
                evidence: { videoId: id, ...r },
            };
        },
    },
    {
        id: 'M8', group: 'Other people\'s videos', needs: 'gesture',
        title: '⭐ Tab capture — picture AND audio from a playing tab',
        hypothesis: 'Route C is the only path for third-party videos. getDisplayMedia can capture a tab WITH its audio — but only a tab, and only if the user ticks “share tab audio”.',
        meaning: {
            pass: 'Third-party videos are reachable. The captured stream is the same shape narrated-review\'s live path already consumes, so the ingest is nearly free to build.',
            fail: 'Read the verdict: “no-audio-track” almost always means a window or screen was shared instead of a tab. Retry before concluding the route is closed.',
            blocked: 'Needs a real click — start a YouTube video playing in another tab first, then run this and pick that tab.',
        },
        async run(ctx) {
            const r = await probeTabCapture({ seconds: ctx.captureSeconds || 8, onProgress: ctx.onProgress });
            const ok = r.verdict === 'ok';
            return {
                status: ok ? 'pass' : 'fail',
                detail: `${VERDICTS[r.verdict] || r.verdict} — surface “${r.video.surface}”, ${r.video.tracks} video / ${r.audio.tracks} audio track(s), peak RMS ${r.rms.max.toFixed(4)}, ${Math.round(r.frameChangeRatio * 100)}% of frames changed.`,
                evidence: r,
            };
        },
    },
];
