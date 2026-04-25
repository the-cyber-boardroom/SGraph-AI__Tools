/**
 * composer-draw.js — canvas paint helpers for active clip frames.
 * @module video-composer/composer-draw
 */

/**
 * Paint solid black across the canvas (gap fill / fallback).
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @returns {void}
 */
export function paintBlack(ctx, canvas) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Paint the active video frame, or black if not ready.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLVideoElement|null} video
 * @returns {void}
 */
export function paintVideo(ctx, canvas, video) {
    if (!video || video.readyState < 2) { paintBlack(ctx, canvas); return; }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

/**
 * Paint an image to the canvas with letterboxed contain-fit (preserves aspect).
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement|null} img
 * @returns {void}
 */
export function paintImage(ctx, canvas, img) {
    paintBlack(ctx, canvas);
    if (!img) return;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.min(canvas.width / iw, canvas.height / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;
    try { ctx.drawImage(img, dx, dy, dw, dh); } catch (_) {}
}

/**
 * Pause every video element except `keep`.
 * @param {Map<string, HTMLVideoElement>} videos
 * @param {HTMLVideoElement|null} keep
 * @returns {void}
 */
export function pauseOthers(videos, keep) {
    for (const v of videos.values()) {
        if (v === keep) continue;
        try { v.pause(); } catch (_) {}
    }
}
