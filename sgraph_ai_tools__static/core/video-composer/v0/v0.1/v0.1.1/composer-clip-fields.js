/**
 * composer-clip-fields.js — defaults + clamping for the optional per-clip
 * `transform` and `crop` fields. Both are normalised (0..1 of canvas / source
 * dimensions) so they survive resolution changes. Defaults reproduce the
 * existing aspect-fit behaviour exactly.
 *
 * @module video-composer/composer-clip-fields
 */

/** Smallest scale we'll ever apply (anything tinier is a no-op crash risk). */
const MIN_SCALE = 0.05;
/** Largest scale we'll ever apply (UI sanity cap; overflow is clipped). */
const MAX_SCALE = 8;

/**
 * Default transform — centred, 100% scale (matches today's aspect-fit draw).
 * Returns a fresh object every call so callers can mutate without aliasing.
 * @returns {{x: number, y: number, scale: number}}
 */
export function defaultTransform() {
    return { x: 0.5, y: 0.5, scale: 1.0 };
}

/**
 * Default crop — full source frame, no cropping.
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function defaultCrop() {
    return { x: 0, y: 0, w: 1, h: 1 };
}

/** True if `t` is a fully-formed transform object with three finite numbers. */
function isValidTransform(t) {
    return !!t
        && Number.isFinite(t.x)
        && Number.isFinite(t.y)
        && Number.isFinite(t.scale);
}

/** True if `c` is a fully-formed crop object with four finite numbers. */
function isValidCrop(c) {
    return !!c
        && Number.isFinite(c.x)
        && Number.isFinite(c.y)
        && Number.isFinite(c.w)
        && Number.isFinite(c.h);
}

/**
 * Read a clip's transform; falls back to defaults if missing/malformed.
 * @param {object|null|undefined} clip
 * @returns {{x: number, y: number, scale: number}}
 */
export function getClipTransform(clip) {
    if (clip && isValidTransform(clip.transform)) {
        const t = clip.transform;
        return { x: t.x, y: t.y, scale: t.scale };
    }
    return defaultTransform();
}

/**
 * Read a clip's crop; falls back to defaults if missing/malformed.
 * @param {object|null|undefined} clip
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function getClipCrop(clip) {
    if (clip && isValidCrop(clip.crop)) {
        const c = clip.crop;
        return { x: c.x, y: c.y, w: c.w, h: c.h };
    }
    return defaultCrop();
}

function clamp01(n) {
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

/**
 * Clamp a transform to safe ranges — x/y to 0..1, scale to [0.05, 8].
 * Falls back to defaults on missing/non-numeric input.
 * @param {{x?: number, y?: number, scale?: number}|null|undefined} t
 * @returns {{x: number, y: number, scale: number}}
 */
export function clampTransform(t) {
    const out = defaultTransform();
    if (!t || typeof t !== 'object') return out;
    out.x = clamp01(t.x);
    out.y = clamp01(t.y);
    let s = Number.isFinite(t.scale) ? t.scale : 1;
    if (s < MIN_SCALE) s = MIN_SCALE;
    if (s > MAX_SCALE) s = MAX_SCALE;
    out.scale = s;
    return out;
}

/**
 * Clamp a crop to a safe sub-rect of 0..1. Honours `x + w ≤ 1` and
 * `y + h ≤ 1`; if the constraint can't be met, snaps to the full frame.
 * @param {{x?: number, y?: number, w?: number, h?: number}|null|undefined} c
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function clampCrop(c) {
    if (!c || typeof c !== 'object') return defaultCrop();
    let x = clamp01(c.x);
    let y = clamp01(c.y);
    let w = Number.isFinite(c.w) ? c.w : 1;
    let h = Number.isFinite(c.h) ? c.h : 1;
    if (w <= 0 || h <= 0) return defaultCrop();
    if (w > 1) w = 1;
    if (h > 1) h = 1;
    if (x + w > 1) x = 1 - w;
    if (y + h > 1) y = 1 - h;
    if (x < 0 || y < 0) return defaultCrop();
    return { x, y, w, h };
}
