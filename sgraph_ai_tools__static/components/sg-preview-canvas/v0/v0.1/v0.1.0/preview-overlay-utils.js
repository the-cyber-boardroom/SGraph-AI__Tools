// preview-overlay-utils.js — geometry helpers shared by the overlay modes (v0.1.0)

import { computeClipDestRect, computeDirectDestRect } from '/core/video-composer/v0/v0.1/v0.1.0/composer-draw.js';
import { defaultTransform, defaultCrop } from '/core/video-composer/v0/v0.1/v0.1.0/composer-clip-fields.js';

/**
 * Build a px-mapper for a given canvas. The canvas has internal "logical"
 * pixels (canvas.width/height) and a rendered display rect from CSS layout
 * (getBoundingClientRect). The overlay sits on top of the canvas rendered
 * box; events arrive in client coordinates. Helpers:
 *  - clientToCanvas(cx, cy): convert clientX/Y → canvas-pixel coordinates.
 *  - canvasToOverlay(cx, cy): convert canvas-pixel coords → overlay-local
 *    pixel coords (the overlay is the same rect as the canvas display box).
 * Both rely on the canvas's current bounding box.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{
 *   rect: DOMRect,
 *   sx: number, sy: number,
 *   clientToCanvas: (cx: number, cy: number) => {x: number, y: number},
 *   canvasToOverlay: (cx: number, cy: number) => {x: number, y: number},
 * }}
 */
export function makeMapper(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dispW = rect.width || 1;
    const dispH = rect.height || 1;
    const sx = (canvas.width || dispW) / dispW;
    const sy = (canvas.height || dispH) / dispH;
    return {
        rect, sx, sy,
        clientToCanvas(cx, cy) {
            return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
        },
        canvasToOverlay(cx, cy) {
            return { x: cx / sx, y: cy / sy };
        },
    };
}

/**
 * Compute the on-canvas destination rect for the active clip. Returns
 * canvas-pixel coordinates (0..canvas.width / 0..canvas.height).
 * @param {HTMLCanvasElement} canvas
 * @param {{transform: object, crop: object, srcWidth: number, srcHeight: number}} active
 * @returns {{dx: number, dy: number, drawW: number, drawH: number}|null}
 */
export function activeClipCanvasRect(canvas, active) {
    if (!canvas || !active) return null;
    const sw = active.srcWidth | 0;
    const sh = active.srcHeight | 0;
    if (!sw || !sh) return null;
    const t = active.transform || defaultTransform();
    const c = active.crop || defaultCrop();
    // Shape/text clips use direct (non aspect-fit) draw math so their intrinsic
    // w/h map 1:1 to canvas pixels at scale=1 — required for non-uniform resize.
    const fn = (active.kind === 'shape' || active.kind === 'text')
        ? computeDirectDestRect : computeClipDestRect;
    const r = fn(canvas.width, canvas.height, sw, sh, t, c);
    return { dx: r.dx, dy: r.dy, drawW: r.drawW, drawH: r.drawH };
}

/**
 * Round a number to N decimal places. Pure helper.
 * @param {number} n
 * @param {number} dp
 * @returns {number}
 */
export function round(n, dp) {
    const k = Math.pow(10, dp);
    return Math.round(n * k) / k;
}

/**
 * Clamp a value between lo and hi (inclusive).
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(v, lo, hi) {
    if (!Number.isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}
