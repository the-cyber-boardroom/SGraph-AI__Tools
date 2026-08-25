/** ui-shell-overlay.js — editor-mode + active-clip overlay glue for ui-shell. */

import {
    findActiveClipsPerTrack,
    getClipTransform,
    getClipCrop,
    getClipIntrinsicDims,
    getClipKind,
} from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { computeClipDestRect, computeDirectDestRect } from '/core/video-composer/v0/v0.1/v0.1.0/composer-draw.js';

function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

/**
 * Resolve the "active" clip for the overlay: the currently-selected clip,
 * but only if the playhead falls inside its timeline range AND the asset
 * has known source dimensions. Returns the shape `<sg-preview-canvas>`
 * expects for `setActiveClip(...)`, or `null`.
 *
 * @param {object|null} flatProject
 * @param {string|null} selectedClipId
 * @param {number} playhead
 * @returns {object|null}
 */
export function resolveActiveClip(flatProject, selectedClipId, playhead) {
    if (!flatProject || !selectedClipId) return null;
    const ph = Number.isFinite(playhead) ? playhead : 0;
    const lanes = findActiveClipsPerTrack(flatProject, ph);
    let active = null;
    for (const { clip } of lanes) {
        if (clip && clip.id === selectedClipId) { active = clip; break; }
    }
    if (!active) return null;
    const dims = getClipIntrinsicDims(active, flatProject);
    if (!dims || !dims.w || !dims.h) return null;
    return {
        clipId: active.id,
        kind: getClipKind(active),
        transform: getClipTransform(active),
        crop: getClipCrop(active),
        srcWidth: dims.w,
        srcHeight: dims.h,
    };
}

/**
 * Find the top-most active clip whose render rect contains the given canvas
 * point. Iterates `findActiveClipsPerTrack` top-down so the topmost layer
 * wins (matches the visual paint order). Returns `clipId` or `null`.
 *
 * @param {object} flatProject
 * @param {number} playhead
 * @param {{canvasW: number, canvasH: number, x: number, y: number}} hit
 * @returns {string|null}
 */
export function clipAtCanvasPoint(flatProject, playhead, hit) {
    if (!flatProject || !hit) return null;
    const ph = Number.isFinite(playhead) ? playhead : 0;
    const lanes = findActiveClipsPerTrack(flatProject, ph);
    for (let i = lanes.length - 1; i >= 0; i--) {
        const clip = lanes[i] && lanes[i].clip;
        if (!clip) continue;
        const dims = getClipIntrinsicDims(clip, flatProject);
        if (!dims || !dims.w || !dims.h) continue;
        const kind = getClipKind(clip);
        const fn = (kind === 'shape' || kind === 'text') ? computeDirectDestRect : computeClipDestRect;
        const r = fn(hit.canvasW, hit.canvasH, dims.w, dims.h,
            getClipTransform(clip), getClipCrop(clip));
        if (hit.x >= r.dx && hit.x <= r.dx + r.drawW
            && hit.y >= r.dy && hit.y <= r.dy + r.drawH) {
            return clip.id;
        }
    }
    return null;
}

/**
 * Wire the editor-mode toggle + on-canvas overlay events.
 *  - Listens on the preview for EDITOR_MODE_REQUESTED → flips local mode.
 *  - Listens on the preview for transform-requested / crop-requested →
 *    routes to api.setClipTransform / api.setClipCrop.
 *  - Listens on the preview for canvas-clicked → in select mode, picks the
 *    top-most clip whose render rect covers the click and selects it via
 *    `cfg.setSelectedClip`.
 *  - Provides a `pushActive()` helper for the shell to call whenever
 *    selection / playhead / project changes.
 *
 * @param {{
 *   previewEl: HTMLElement|null,
 *   api: object,
 *   getProject: () => object|null,
 *   getSelectedClipId: () => string|null,
 *   getPlayhead: () => number,
 *   setSelectedClip?: (clipId: string|null) => void,
 * }} cfg
 * @returns {{ pushActive: () => void, destroy: () => void, getMode: () => string }}
 */
export function wireOverlay(cfg) {
    let editorMode = 'select';

    function applyMode(next) {
        const mode = (next === 'move' || next === 'crop') ? next : 'select';
        editorMode = mode;
        try { cfg.previewEl && cfg.previewEl.setEditorMode(mode); } catch (_) {}
        pushActive();
    }
    function pushActive() {
        if (!cfg.previewEl || typeof cfg.previewEl.setActiveClip !== 'function') return;
        // Keep the active clip set even in Select mode so the preview can
        // render a selection outline around it. The overlay component
        // decides what to show per mode.
        const info = resolveActiveClip(cfg.getProject(), cfg.getSelectedClipId(), cfg.getPlayhead());
        cfg.previewEl.setActiveClip(info);
    }

    function onModeReq(e) {
        const mode = e && e.detail && e.detail.mode;
        // Re-clicking Select while already in select mode → deselect the clip
        // so the Properties panel falls back to showing project settings.
        if (mode === 'select' && editorMode === 'select' && typeof cfg.setSelectedClip === 'function') {
            cfg.setSelectedClip(null);
        }
        applyMode(mode);
    }
    function onTransform(e) {
        const d = e.detail || {};
        if (!d.clipId || !d.transform) return;
        Promise.resolve(cfg.api.setClipTransform({
            clipId: d.clipId, transform: d.transform, transient: !!d.transient,
        })).catch(err => emitErr('setClipTransform', err));
    }
    function onCrop(e) {
        const d = e.detail || {};
        if (!d.clipId || !d.crop) return;
        Promise.resolve(cfg.api.setClipCrop({
            clipId: d.clipId, crop: d.crop, transient: !!d.transient,
        })).catch(err => emitErr('setClipCrop', err));
    }
    function onShapeResize(e) {
        const d = e.detail || {};
        if (!d.clipId || !d.shape) return;
        Promise.resolve(cfg.api.setShapeProps({
            clipId: d.clipId, shape: d.shape, transform: d.transform,
            transient: !!d.transient,
        })).catch(err => emitErr('setShapeProps', err));
    }
    function onTextResize(e) {
        const d = e.detail || {};
        if (!d.clipId || !d.text) return;
        Promise.resolve(cfg.api.setTextProps({
            clipId: d.clipId, text: d.text, transform: d.transform,
            transient: !!d.transient,
        })).catch(err => emitErr('setTextProps', err));
    }
    function onCanvasClick(e) {
        if (editorMode !== 'select') return;
        if (typeof cfg.setSelectedClip !== 'function') return;
        const canvas = cfg.previewEl && typeof cfg.previewEl.getCanvas === 'function'
            ? cfg.previewEl.getCanvas() : null;
        if (!canvas) return;
        const d = e.detail || {};
        const id = clipAtCanvasPoint(cfg.getProject(), cfg.getPlayhead(), {
            canvasW: canvas.width, canvasH: canvas.height,
            x: d.canvasX, y: d.canvasY,
        });
        cfg.setSelectedClip(id);
    }

    if (cfg.previewEl) {
        cfg.previewEl.addEventListener('sg-timeline:editor-mode-requested', onModeReq);
        cfg.previewEl.addEventListener('sg-preview:transform-requested', onTransform);
        cfg.previewEl.addEventListener('sg-preview:crop-requested', onCrop);
        cfg.previewEl.addEventListener('sg-preview:shape-resize-requested', onShapeResize);
        cfg.previewEl.addEventListener('sg-preview:text-resize-requested', onTextResize);
        cfg.previewEl.addEventListener('sg-preview:canvas-clicked', onCanvasClick);
    }

    applyMode('select');

    return {
        getMode: () => editorMode,
        pushActive,
        destroy() {
            if (cfg.previewEl) {
                cfg.previewEl.removeEventListener('sg-timeline:editor-mode-requested', onModeReq);
                cfg.previewEl.removeEventListener('sg-preview:transform-requested', onTransform);
                cfg.previewEl.removeEventListener('sg-preview:crop-requested', onCrop);
                cfg.previewEl.removeEventListener('sg-preview:shape-resize-requested', onShapeResize);
                cfg.previewEl.removeEventListener('sg-preview:text-resize-requested', onTextResize);
                cfg.previewEl.removeEventListener('sg-preview:canvas-clicked', onCanvasClick);
            }
        },
    };
}
