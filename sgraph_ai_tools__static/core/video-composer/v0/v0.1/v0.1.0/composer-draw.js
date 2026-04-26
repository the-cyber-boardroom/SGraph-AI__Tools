/**
 * composer-draw.js — canvas paint helpers for active clip frames.
 * Per-clip transform + crop are applied here. `paintTransformedFrame` is
 * the single source of truth for the draw math; `computeClipDestRect`
 * exposes that math (without drawing) so the overlay UI can render handles
 * over the same destination rect.
 *
 * @module video-composer/composer-draw
 */

import { defaultTransform, defaultCrop } from './composer-clip-fields.js';

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
 * Compute the source-rect + destination-rect for a clip given its source
 * dimensions, the canvas dimensions, and (optional) transform + crop.
 * With default transform + default crop this reproduces today's aspect-fit
 * letterboxed placement exactly.
 *
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {number} srcWidth
 * @param {number} srcHeight
 * @param {{x: number, y: number, scale: number}} [transform]
 * @param {{x: number, y: number, w: number, h: number}} [crop]
 * @returns {{sx:number,sy:number,sw:number,sh:number,dx:number,dy:number,drawW:number,drawH:number}}
 */
export function computeClipDestRect(canvasW, canvasH, srcWidth, srcHeight, transform, crop) {
    const t = transform || defaultTransform();
    const c = crop || defaultCrop();
    const sx = c.x * srcWidth;
    const sy = c.y * srcHeight;
    const sw = c.w * srcWidth;
    const sh = c.h * srcHeight;
    // baseScale + full draw rect use the FULL source dims (not the crop) so
    // that the visible image stays anchored when the user trims the crop.
    // The dest rect is then the crop sub-rect of where the full source would
    // render. With a default crop, dx/dy/drawW/drawH match the original
    // aspect-fit placement exactly.
    const baseScale = Math.min(canvasW / srcWidth, canvasH / srcHeight);
    const fullDrawW = srcWidth * baseScale * t.scale;
    const fullDrawH = srcHeight * baseScale * t.scale;
    const fullDx = t.x * canvasW - fullDrawW / 2;
    const fullDy = t.y * canvasH - fullDrawH / 2;
    const drawW = c.w * fullDrawW;
    const drawH = c.h * fullDrawH;
    const dx = fullDx + c.x * fullDrawW;
    const dy = fullDy + c.y * fullDrawH;
    return { sx, sy, sw, sh, dx, dy, drawW, drawH };
}

/**
 * Draw a single source frame onto the canvas honouring crop + transform.
 * Does NOT clear the canvas — the caller controls compositing order.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasImageSource} source
 * @param {number} srcWidth
 * @param {number} srcHeight
 * @param {{x: number, y: number, scale: number}} [transform]
 * @param {{x: number, y: number, w: number, h: number}} [crop]
 * @returns {void}
 */
export function paintTransformedFrame(ctx, canvas, source, srcWidth, srcHeight, transform, crop) {
    if (!source || !srcWidth || !srcHeight) return;
    const r = computeClipDestRect(canvas.width, canvas.height, srcWidth, srcHeight, transform, crop);
    try { ctx.drawImage(source, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.drawW, r.drawH); }
    catch (_) {}
}

/**
 * Paint a video frame honouring per-clip transform + crop. Does NOT clear
 * the canvas — caller controls compositing. Falls back to a stretch-fill if
 * the browser hasn't reported videoWidth/Height yet (pre-metadata case).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLVideoElement|null} video
 * @param {{x: number, y: number, scale: number}} [transform]
 * @param {{x: number, y: number, w: number, h: number}} [crop]
 * @returns {void}
 */
export function paintVideo(ctx, canvas, video, transform, crop) {
    if (!video || video.readyState < 2) return;
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (!vw || !vh) {
        try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch (_) {}
        return;
    }
    paintTransformedFrame(ctx, canvas, video, vw, vh, transform, crop);
}

/**
 * Paint an image honouring per-clip transform + crop. Does NOT clear the
 * canvas — caller controls compositing. With defaults, reproduces the
 * original aspect-fit (letterboxed) placement exactly.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement|null} img
 * @param {{x: number, y: number, scale: number}} [transform]
 * @param {{x: number, y: number, w: number, h: number}} [crop]
 * @returns {void}
 */
export function paintImage(ctx, canvas, img, transform, crop) {
    if (!img) return;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    paintTransformedFrame(ctx, canvas, img, iw, ih, transform, crop);
}

/**
 * Paint a shape clip (currently rectangles only) honouring per-clip transform.
 * Reuses `computeClipDestRect` with the shape's intrinsic w/h so position +
 * scale behave identically to asset clips. Crop is intentionally ignored —
 * shapes already define their bounds via fill colour.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {{shape: {type: string, fill: string, w: number, h: number}}} clip
 * @param {{x: number, y: number, scale: number}} [transform]
 * @returns {void}
 */
export function paintShape(ctx, canvas, clip, transform) {
    const shape = clip && clip.shape;
    if (!shape || !shape.w || !shape.h) return;
    const r = computeClipDestRect(canvas.width, canvas.height, shape.w, shape.h, transform, undefined);
    if (shape.type !== 'rect') return;
    try {
        ctx.save();
        ctx.fillStyle = shape.fill || '#000000';
        ctx.fillRect(r.dx, r.dy, r.drawW, r.drawH);
        ctx.restore();
    } catch (_) { /* ignore — invalid colour or context lost */ }
}

/**
 * Paint a single-line text clip centred inside its `(text.w, text.h)` rect,
 * honouring per-clip transform. The font size scales with the rect so text
 * grows / shrinks when the user resizes via the move overlay.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {{text: {content: string, color: string, fontSize: number, fontFamily?: string, w: number, h: number}}} clip
 * @param {{x: number, y: number, scale: number}} [transform]
 * @returns {void}
 */
export function paintText(ctx, canvas, clip, transform) {
    const text = clip && clip.text;
    if (!text || !text.w || !text.h) return;
    const r = computeClipDestRect(canvas.width, canvas.height, text.w, text.h, transform, undefined);
    try {
        ctx.save();
        const px = Math.max(1, (text.fontSize || 64) * (r.drawW / text.w));
        ctx.fillStyle = text.color || '#ffffff';
        ctx.font = `${px}px ${text.fontFamily || 'system-ui, sans-serif'}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(String(text.content || ''), r.dx + r.drawW / 2, r.dy + r.drawH / 2);
        ctx.restore();
    } catch (_) { /* ignore — invalid font / colour */ }
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

/**
 * Pause every video whose assetId is not in the `keep` Set of assetIds.
 * Used by the multi-track scheduler/export tick where multiple videos
 * may be active simultaneously.
 * @param {Map<string, HTMLVideoElement>} videos
 * @param {Set<string>} keep
 * @returns {void}
 */
export function pauseUnused(videos, keep) {
    for (const [id, v] of videos.entries()) {
        if (keep && keep.has(id)) continue;
        try { v.pause(); } catch (_) {}
    }
}
