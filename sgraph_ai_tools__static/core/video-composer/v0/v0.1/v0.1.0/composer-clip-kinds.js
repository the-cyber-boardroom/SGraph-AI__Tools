/**
 * composer-clip-kinds.js — discriminated-union helpers for clip kinds.
 *
 * A clip on a video track is one of:
 *   - asset clip — has `assetId`; renders the underlying video/image
 *   - shape clip — has `kind: 'shape'` + `shape: {type, fill, w, h}`
 *   - text clip  — has `kind: 'text'`  + `text: {content, color, fontSize, fontFamily?, w, h}`
 *
 * Shape/text clips share the same timeline-position fields (timelineStart,
 * inPoint, outPoint) and optional `transform`. Their intrinsic w/h plays the
 * same role as srcWidth/srcHeight for asset clips, so the existing draw +
 * overlay math (`computeClipDestRect`, `activeClipCanvasRect`) works
 * unchanged once the caller passes the right dims.
 *
 * @module video-composer/composer-clip-kinds
 */

const DEFAULT_SHAPE_W = 480;
const DEFAULT_SHAPE_H = 320;
const DEFAULT_TEXT_W = 720;
const DEFAULT_TEXT_H = 160;
const DEFAULT_TEXT_FONT_SIZE = 96;
const DEFAULT_TEXT_FONT_FAMILY = 'system-ui, sans-serif';
const DEFAULT_DURATION_SEC = 5;

/** True when a clip uses inline shape config (no asset). */
export function isShapeClip(clip) {
    return !!(clip && clip.kind === 'shape' && clip.shape);
}

/** True when a clip uses inline text config (no asset). */
export function isTextClip(clip) {
    return !!(clip && clip.kind === 'text' && clip.text);
}

/** True when a clip carries an assetId (legacy asset clip). */
export function isAssetClip(clip) {
    return !!(clip && typeof clip.assetId === 'string' && !clip.kind);
}

/** Return one of 'asset' | 'shape' | 'text' for the given clip. */
export function getClipKind(clip) {
    if (isShapeClip(clip)) return 'shape';
    if (isTextClip(clip)) return 'text';
    return 'asset';
}

/** Default shape config — black filled rectangle at a modest centred size. */
export function defaultShape() {
    return { type: 'rect', fill: '#000000', w: DEFAULT_SHAPE_W, h: DEFAULT_SHAPE_H };
}

/** Default text config — white "Text" at a readable display size. */
export function defaultText() {
    return {
        content: 'Text',
        color: '#ffffff',
        fontSize: DEFAULT_TEXT_FONT_SIZE,
        fontFamily: DEFAULT_TEXT_FONT_FAMILY,
        w: DEFAULT_TEXT_W,
        h: DEFAULT_TEXT_H,
    };
}

/** Default initial duration for a freshly-added shape/text clip (seconds). */
export function defaultClipDuration() { return DEFAULT_DURATION_SEC; }

function clampPos(n, fallback) { return (Number.isFinite(n) && n > 0) ? n : fallback; }
function isHexColour(s) { return typeof s === 'string' && /^#[0-9a-f]{3,8}$/i.test(s); }

/** Validate / clamp a shape config; missing fields fall back to defaults. */
export function clampShape(s) {
    const out = defaultShape();
    if (!s || typeof s !== 'object') return out;
    if (s.type === 'rect') out.type = 'rect';
    if (isHexColour(s.fill)) out.fill = s.fill;
    out.w = clampPos(s.w, DEFAULT_SHAPE_W);
    out.h = clampPos(s.h, DEFAULT_SHAPE_H);
    return out;
}

/** Validate / clamp a text config; missing fields fall back to defaults. */
export function clampText(t) {
    const out = defaultText();
    if (!t || typeof t !== 'object') return out;
    if (typeof t.content === 'string') out.content = t.content;
    if (isHexColour(t.color)) out.color = t.color;
    if (typeof t.fontFamily === 'string' && t.fontFamily) out.fontFamily = t.fontFamily;
    out.fontSize = clampPos(t.fontSize, DEFAULT_TEXT_FONT_SIZE);
    out.w = clampPos(t.w, DEFAULT_TEXT_W);
    out.h = clampPos(t.h, DEFAULT_TEXT_H);
    return out;
}

/**
 * Intrinsic source dimensions for a clip (treated as srcWidth/srcHeight by
 * the draw + overlay code). For asset clips this comes from the project's
 * asset entry; for shape/text it's the inline w/h.
 *
 * @param {object|null|undefined} clip
 * @param {object|null|undefined} project
 * @returns {{w: number, h: number}|null}
 */
export function getClipIntrinsicDims(clip, project) {
    if (isShapeClip(clip)) return { w: clip.shape.w, h: clip.shape.h };
    if (isTextClip(clip)) return { w: clip.text.w, h: clip.text.h };
    if (isAssetClip(clip)) {
        const assets = project && project.assets;
        let a = null;
        if (Array.isArray(assets)) a = assets.find(x => x && x.id === clip.assetId) || null;
        else if (assets && typeof assets === 'object') a = assets[clip.assetId] || null;
        if (a && Number.isFinite(a.width) && Number.isFinite(a.height)) {
            return { w: a.width, h: a.height };
        }
    }
    return null;
}
