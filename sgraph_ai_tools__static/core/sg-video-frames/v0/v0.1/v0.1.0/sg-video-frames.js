/**
 * sg-video-frames — extract a still image from a video file, in the browser.
 *
 * Pure ES module. No build step. Two extraction strategies:
 *
 *   1. Fast path — a native `<video>` element seeks to the requested time and
 *      the current frame is drawn to a canvas. Works for web-friendly `.mp4`
 *      (H.264). The browser applies any rotation metadata before `drawImage`,
 *      so orientation is correct on this path.
 *
 *   2. Fallback — FFmpeg WASM (`-ss <at> -frames:v 1`). Used when the
 *      `<video>` element can't decode the codec — which is exactly the case
 *      for iPhone `.MOV` (HEVC / H.265), since Chrome/Firefox on
 *      Linux/Windows cannot decode HEVC in a `<video>` element. This path is
 *      SLOW (multi-second WASM decode) — surface progress via `onProgress`.
 *      FFmpeg autorotate is left ON (we do NOT pass `-noautorotate`) so iPhone
 *      rotation metadata is honoured.
 *
 * Both paths end in a canvas/FFmpeg re-encode, so the returned Blob carries NO
 * source metadata (no EXIF, no GPS) — that re-encode is the privacy guarantee.
 *
 * NOTE (orientation, FFmpeg path): correctness relies on FFmpeg's default
 * autorotate. This has not been verified in a real browser against a rotated
 * iPhone `.MOV`; if a follow-up shows frames come out sideways, add an explicit
 * `-vf transpose=...` derived from the rotation side-data. Tracked as a
 * follow-up.
 *
 * @module sg-video-frames
 * @version 0.1.0
 */

import { exportImage } from '/core/image/v1/v1.0/v1.0.0/sg-image.js';
import { loadFFmpeg } from '/core/video/v1/v1.0/v1.0.1/sg-video.js';

/** Extensions we treat as video. */
const VIDEO_EXT = /\.(mp4|mov|m4v|qt)$/i;

/** MIME types we treat as video (covers quicktime / mp4 / m4v). */
const VIDEO_MIME = /^video\/(mp4|quicktime|x-m4v|m4v)$/i;

/** How long (ms) to wait for the `<video>` fast path before giving up. */
const FAST_PATH_TIMEOUT_MS = 8000;

/**
 * Best-effort detection of a video file by extension + MIME sniff.
 *
 * Matches `.mp4`, `.mov`, `.m4v`, `.qt` by name and `video/mp4`,
 * `video/quicktime`, `video/x-m4v` by MIME. iPhone exports from Google Photos
 * sometimes arrive with an empty MIME, so the extension check is the primary
 * signal.
 *
 * @param {File|Blob} file
 * @returns {boolean}
 */
export function isVideoFile(file) {
    if (!file) return false;
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    if (VIDEO_EXT.test(name)) return true;
    if (VIDEO_MIME.test(type)) return true;
    return false;
}

/**
 * Draw a source (image element or canvas) sized to `w`×`h` onto a fresh canvas.
 * @param {CanvasImageSource} source
 * @param {number} w
 * @param {number} h
 * @returns {HTMLCanvasElement}
 */
function drawToCanvas(source, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(source, 0, 0, w, h);
    return canvas;
}

/**
 * Try to grab a frame using a native `<video>` element.
 *
 * Resolves with a canvas on success; rejects (so the caller falls through to
 * FFmpeg) if the codec is unsupported, dimensions are zero, an error event
 * fires, or the decode times out.
 *
 * @param {File|Blob} file
 * @param {number} at - seek target in seconds
 * @returns {Promise<HTMLCanvasElement>}
 */
function grabFrameViaVideo(file, at) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous';

        let settled = false;
        const cleanup = () => {
            clearTimeout(timer);
            video.removeAttribute('src');
            try { video.load(); } catch (_) { /* ignore */ }
            URL.revokeObjectURL(url);
        };
        const fail = (msg) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error(msg));
        };
        const succeed = (canvas) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(canvas);
        };

        const timer = setTimeout(() => fail('video frame grab timed out'), FAST_PATH_TIMEOUT_MS);

        video.addEventListener('error', () => fail('video element decode error'), { once: true });

        video.addEventListener('loadeddata', () => {
            if (!video.videoWidth || !video.videoHeight) {
                fail('video has zero dimensions (codec likely unsupported)');
                return;
            }
            // Clamp the seek to a tiny non-negative offset to land on a real
            // first frame; some decoders never fire `seeked` for currentTime 0
            // when it already equals 0, so we always nudge it.
            const target = Math.max(at, 0.0);
            const onSeeked = () => {
                try {
                    succeed(drawToCanvas(video, video.videoWidth, video.videoHeight));
                } catch (err) {
                    fail(`drawImage failed: ${err && err.message}`);
                }
            };
            video.addEventListener('seeked', onSeeked, { once: true });
            try {
                video.currentTime = target;
            } catch (err) {
                fail(`seek failed: ${err && err.message}`);
            }
        }, { once: true });

        video.src = url;
    });
}

/**
 * Grab a frame via FFmpeg WASM. Always re-encodes through a canvas at the end
 * so the output is in the requested format and metadata-free.
 *
 * @param {File|Blob} file
 * @param {number} at - seek target in seconds
 * @param {string} format - output MIME (passed to exportImage)
 * @param {number} quality - encode quality 0..1
 * @param {Function} [onProgress] - forwarded to loadFFmpeg ({ ratio })
 * @returns {Promise<Blob>}
 */
async function grabFrameViaFfmpeg(file, at, format, quality, onProgress) {
    const ffmpeg = await loadFFmpeg(onProgress);

    const ext = (file.name && file.name.includes('.'))
        ? file.name.slice(file.name.lastIndexOf('.'))
        : '.mov';
    const inputName = `vf-input${ext}`;
    const frameName = 'frame.png';

    // Write the input via fetchFile-equivalent (Uint8Array) directly.
    const data = new Uint8Array(await file.arrayBuffer());
    await ffmpeg.writeFile(inputName, data);

    try {
        // Autorotate is ON by default (no -noautorotate) so iPhone rotation
        // metadata is honoured. -update 1 lets a single image overwrite cleanly.
        const code = await ffmpeg.exec([
            '-ss', String(at),
            '-i', inputName,
            '-frames:v', '1',
            '-update', '1',
            frameName,
        ]);
        if (code !== 0) {
            throw new Error('FFmpeg returned a non-zero exit code extracting the frame');
        }

        const out = await ffmpeg.readFile(frameName);
        const pngBlob = new Blob([out.buffer], { type: 'image/png' });

        // Re-encode through a canvas to the requested format/quality. This both
        // guarantees the chosen output format AND strips any metadata FFmpeg
        // may have written into the intermediate PNG.
        const bitmap = await createImageBitmap(pngBlob);
        const canvas = drawToCanvas(bitmap, bitmap.width, bitmap.height);
        if (typeof bitmap.close === 'function') bitmap.close();
        return await exportImage(canvas, format, quality);
    } finally {
        try { await ffmpeg.deleteFile(inputName); } catch (_) { /* ignore */ }
        try { await ffmpeg.deleteFile(frameName); } catch (_) { /* ignore */ }
    }
}

/**
 * Extract a single still frame from a video file as a metadata-free image Blob.
 *
 * Tries the fast `<video>` path first; on any failure (unsupported codec, zero
 * dimensions, error, timeout) it falls through to the slow FFmpeg WASM path.
 * HEVC `.mov` always takes the FFmpeg path — pass `onProgress` to surface its
 * (multi-second) progress to the user.
 *
 * @param {File|Blob} file - the source video
 * @param {{at?: number, format?: string, quality?: number, onProgress?: Function}} [opts]
 *   - `at` seek time in seconds (default 0 = first real frame)
 *   - `format` output MIME (default 'image/jpeg')
 *   - `quality` encode quality 0..1 (default 0.9)
 *   - `onProgress` forwarded to the FFmpeg loader ({ ratio })
 * @returns {Promise<Blob>} a metadata-free image blob in the requested format
 */
export async function extractFirstFrame(file, opts = {}) {
    const at = typeof opts.at === 'number' ? opts.at : 0;
    const format = opts.format || 'image/jpeg';
    const quality = typeof opts.quality === 'number' ? opts.quality : 0.9;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : undefined;

    try {
        const canvas = await grabFrameViaVideo(file, at);
        // Re-encode the drawn frame to the requested format — metadata-free.
        return await exportImage(canvas, format, quality);
    } catch (_fastErr) {
        // Fall through to the FFmpeg path (HEVC .mov lands here).
        return grabFrameViaFfmpeg(file, at, format, quality, onProgress);
    }
}
