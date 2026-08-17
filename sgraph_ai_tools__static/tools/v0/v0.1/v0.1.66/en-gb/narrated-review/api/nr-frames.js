/**
 * nr-frames.js
 * The video side of the video-import ingest: one hidden <video> used as a
 * seekable frame source, plus the "which frame is this segment about?" search.
 *
 * WHY A SEARCH AND NOT A SINGLE SEEK
 * In a narrated screencast THE PICTURE LEADS THE WORDS: the presenter switches
 * to a screen, waits half a beat, then starts talking about it. Sometimes they
 * start talking first and the switch lands a second later. So the frame that
 * belongs to a spoken segment is not "the frame at the moment speech starts" —
 * it is the frame the screen SETTLES ON around that moment.
 *
 * So for each segment we sample a window that spans a LEAD (before speech) and
 * a LAG (after), reduce each sample to a tiny greyscale signature, find the LAST
 * visual transition in the window, and take the first settled sample after it.
 * All samples are kept as thumbnails so the operator can override the pick with
 * `setFrame` — the heuristic is a first draft, never a verdict.
 *
 * The thresholds below are honest guesses calibrated on synthetic frames. They
 * have NOT been tuned against a real screencast; that probe is still open (see
 * the v0.2.87 pack, Phase 0). They are all parameters for exactly that reason.
 *
 * @module nr-frames
 */

/** Signature raster — small enough to diff thousands of times, big enough to see a slide change. */
const SIG_W = 32, SIG_H = 18;
/** Thumbnail width for the candidate strip. */
const THUMB_W = 200;
/** A seek that never fires 'seeked' must not hang the import. */
const SEEK_TIMEOUT_MS = 4000;

const vid = { el: null, url: null, file: null, durationMs: 0, width: 0, height: 0 };

let sigCanvas = null;
let thumbCanvas = null;

/**
 * Attach a video file as the frame source.
 * @param {File|Blob} file
 * @returns {Promise<{ durationMs: number, width: number, height: number }>}
 */
export async function openVideo(file) {
    closeVideo();
    const el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto';
    el.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;';
    const url = URL.createObjectURL(file);
    el.src = url;
    document.body.appendChild(el);

    await new Promise((resolve, reject) => {
        const ok = () => { clear(); resolve(); };
        const bad = () => { clear(); reject(Object.assign(new Error('Could not decode this video in the browser'), { code: 'not-video' })); };
        const clear = () => { el.removeEventListener('loadedmetadata', ok); el.removeEventListener('error', bad); clearTimeout(timer); };
        const timer = setTimeout(bad, 15000);
        el.addEventListener('loadedmetadata', ok, { once: true });
        el.addEventListener('error', bad, { once: true });
    }).catch(err => { try { el.remove(); URL.revokeObjectURL(url); } catch (_) { /* */ } throw err; });

    if (!el.videoWidth) {
        try { el.remove(); URL.revokeObjectURL(url); } catch (_) { /* */ }
        throw Object.assign(new Error('This video has no decodable picture in the browser (HEVC .mov is the usual cause)'), { code: 'not-video' });
    }
    vid.el = el; vid.url = url; vid.file = file;
    vid.width = el.videoWidth; vid.height = el.videoHeight;
    vid.durationMs = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : await forceDuration(el);
    return { durationMs: vid.durationMs, width: vid.width, height: vid.height };
}

/**
 * Recover the duration of a stream-recorded file.
 *
 * A WebM written by MediaRecorder — which is exactly what SG's own recorders
 * produce — carries no duration in its header, so `video.duration` is Infinity
 * and every seek would clamp to zero. Seeking far past the end forces the
 * browser to scan to the real end and fire `durationchange`.
 *
 * @returns {Promise<number>} duration in ms, or 0 if it stays unknown
 */
function forceDuration(el) {
    return new Promise(resolve => {
        const finish = () => {
            el.removeEventListener('durationchange', onChange);
            clearTimeout(timer);
            const ms = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0;
            try { el.currentTime = 0; } catch (_) { /* */ }
            resolve(ms);
        };
        const onChange = () => { if (Number.isFinite(el.duration)) finish(); };
        const timer = setTimeout(finish, 5000);
        el.addEventListener('durationchange', onChange);
        try { el.currentTime = 1e101; } catch (_) { finish(); }
    });
}

/**
 * Tell the frame source how long the video is, when the container did not.
 * The decoded audio is the fallback authority: it came from the same file.
 * @param {number} ms
 */
export function setDurationMs(ms) {
    if (vid.el && ms > 0 && !(vid.durationMs > 0)) vid.durationMs = Math.round(ms);
    return vid.durationMs;
}

/** Release the frame source. */
export function closeVideo() {
    if (vid.el) { try { vid.el.pause(); vid.el.removeAttribute('src'); vid.el.remove(); } catch (_) { /* */ } }
    if (vid.url) { try { URL.revokeObjectURL(vid.url); } catch (_) { /* */ } }
    vid.el = null; vid.url = null; vid.file = null; vid.durationMs = 0; vid.width = 0; vid.height = 0;
}

/** @returns {boolean} true while a video is attached. */
export function hasVideo() { return !!vid.el; }

/** @returns {{ durationMs, width, height, name, size }|null} */
export function videoInfo() {
    if (!vid.el) return null;
    return {
        durationMs: vid.durationMs, width: vid.width, height: vid.height,
        name: (vid.file && vid.file.name) || 'video', size: (vid.file && vid.file.size) || 0,
    };
}

/** Seek and wait for the frame to actually be there. Resolves on timeout too — a stale frame beats a hang. */
function seek(ms) {
    const el = vid.el;
    const sec = Math.max(0, Math.min((vid.durationMs || 0) / 1000 - 0.05, ms / 1000));
    if (Math.abs(el.currentTime - sec) < 0.005 && el.readyState >= 2) return Promise.resolve();
    return new Promise(resolve => {
        const done = () => { el.removeEventListener('seeked', done); clearTimeout(timer); resolve(); };
        const timer = setTimeout(done, SEEK_TIMEOUT_MS);
        el.addEventListener('seeked', done, { once: true });
        el.currentTime = sec;
    });
}

function ctxFor(canvas, w, h) {
    canvas.width = w; canvas.height = h;
    return canvas.getContext('2d', { willReadFrequently: true });
}

/** Reduce the current frame to a tiny greyscale signature. */
function signature() {
    sigCanvas = sigCanvas || document.createElement('canvas');
    const ctx = ctxFor(sigCanvas, SIG_W, SIG_H);
    ctx.drawImage(vid.el, 0, 0, SIG_W, SIG_H);
    const { data } = ctx.getImageData(0, 0, SIG_W, SIG_H);
    const out = new Uint8Array(SIG_W * SIG_H);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        out[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }
    return out;
}

/** Mean absolute greyscale difference, normalised 0..1. */
export function sigDiff(a, b) {
    if (!a || !b || a.length !== b.length) return 1;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / (a.length * 255);
}

/** JPEG thumbnail of the current frame (for the candidate strip). */
function thumbnail() {
    thumbCanvas = thumbCanvas || document.createElement('canvas');
    const w = THUMB_W;
    const h = Math.max(1, Math.round(w * (vid.height || 9) / (vid.width || 16)));
    ctxFor(thumbCanvas, w, h).drawImage(vid.el, 0, 0, w, h);
    return thumbCanvas.toDataURL('image/jpeg', 0.6);
}

/**
 * Sample one point in the video.
 * @param {number} at ms
 * @returns {Promise<{ at: number, sig: Uint8Array, thumb: string }>}
 */
export async function probeAt(at) {
    if (!vid.el) throw Object.assign(new Error('No video attached — call importVideo() first'), { code: 'no-video' });
    await seek(at);
    return { at: Math.round(at), sig: signature(), thumb: thumbnail() };
}

/**
 * Grab a full-resolution PNG at a point in the video — the capture's screenshot.
 * @param {number} at ms
 * @returns {Promise<Blob>}
 */
export async function grabAt(at) {
    if (!vid.el) throw Object.assign(new Error('No video attached — call importVideo() first'), { code: 'no-video' });
    await seek(at);
    const canvas = document.createElement('canvas');
    canvas.width = vid.width; canvas.height = vid.height;
    canvas.getContext('2d').drawImage(vid.el, 0, 0);
    return new Promise(res => canvas.toBlob(b => res(b), 'image/png'));
}

/**
 * Find the frame a spoken segment is about.
 *
 * @param {number} speechStartMs when the words begin
 * @param {{ leadMs: number, lagMs: number, stepMs: number, changeThreshold: number }} opts
 * @returns {Promise<{ chosen: number, candidates: Array<{at,thumb}>, sig: Uint8Array }>}
 *   `chosen` is an INDEX into `candidates`.
 */
export async function findFrame(speechStartMs, opts = {}) {
    const { leadMs = 2500, lagMs = 1200, stepMs = 400, changeThreshold = 0.02 } = opts;
    const from = Math.max(0, speechStartMs - leadMs);
    const to = Math.min(vid.durationMs || speechStartMs + lagMs, speechStartMs + lagMs);
    const shots = [];
    for (let at = from; at <= to; at += stepMs) shots.push(await probeAt(at));
    if (!shots.length) shots.push(await probeAt(Math.max(0, speechStartMs)));

    // The last visual transition in the window is the switch the words are about.
    let idx = -1;
    for (let i = 1; i < shots.length; i++) {
        if (sigDiff(shots[i - 1].sig, shots[i].sig) > changeThreshold) idx = i;
    }
    if (idx < 0) {
        // Nothing changed — the screen was already showing it. Take the sample
        // nearest to the words themselves.
        idx = 0;
        for (let i = 1; i < shots.length; i++) {
            if (Math.abs(shots[i].at - speechStartMs) < Math.abs(shots[idx].at - speechStartMs)) idx = i;
        }
    }
    // Walk forward off any still-animating frames (a fade, a scroll, a build).
    while (idx + 1 < shots.length && sigDiff(shots[idx].sig, shots[idx + 1].sig) > changeThreshold) idx += 1;

    return {
        chosen: idx,
        sig: shots[idx].sig,
        candidates: shots.map(s => ({ at: s.at, thumb: s.thumb })),
    };
}
