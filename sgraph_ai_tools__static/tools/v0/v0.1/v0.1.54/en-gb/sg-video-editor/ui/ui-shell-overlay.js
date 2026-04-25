/** ui-shell-overlay.js — editor-mode + active-clip overlay glue for ui-shell. */

import {
    findActiveClipsPerTrack,
    getAssetById,
    getClipTransform,
    getClipCrop,
} from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';

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
    const asset = getAssetById(flatProject, active.assetId);
    const w = asset && Number.isFinite(asset.width) ? asset.width : 0;
    const h = asset && Number.isFinite(asset.height) ? asset.height : 0;
    if (!w || !h) return null;
    return {
        clipId: active.id,
        transform: getClipTransform(active),
        crop: getClipCrop(active),
        srcWidth: w,
        srcHeight: h,
    };
}

/**
 * Wire the editor-mode toggle + on-canvas overlay events.
 *  - Listens on the timeline for EDITOR_MODE_REQUESTED → flips local mode.
 *  - Listens on the preview for transform-requested / crop-requested →
 *    routes to api.setClipTransform / api.setClipCrop.
 *  - Provides a `pushActive()` helper for the shell to call whenever
 *    selection / playhead / project changes.
 *
 * @param {{
 *   timelineEl: HTMLElement|null,
 *   previewEl: HTMLElement|null,
 *   api: object,
 *   getProject: () => object|null,
 *   getSelectedClipId: () => string|null,
 *   getPlayhead: () => number,
 * }} cfg
 * @returns {{ pushActive: () => void, destroy: () => void, getMode: () => string }}
 */
export function wireOverlay(cfg) {
    let editorMode = 'select';

    function applyMode(next) {
        const mode = (next === 'move' || next === 'crop') ? next : 'select';
        editorMode = mode;
        try { cfg.previewEl && cfg.previewEl.setEditorMode(mode); } catch (_) {}
        try { cfg.timelineEl && cfg.timelineEl.setEditorMode(mode); } catch (_) {}
        pushActive();
    }
    function pushActive() {
        if (!cfg.previewEl || typeof cfg.previewEl.setActiveClip !== 'function') return;
        if (editorMode === 'select') { cfg.previewEl.setActiveClip(null); return; }
        const info = resolveActiveClip(cfg.getProject(), cfg.getSelectedClipId(), cfg.getPlayhead());
        cfg.previewEl.setActiveClip(info);
    }

    function onModeReq(e) { applyMode(e && e.detail && e.detail.mode); }
    function onTransform(e) {
        const d = e.detail || {};
        if (!d.clipId || !d.transform) return;
        Promise.resolve(cfg.api.setClipTransform({ clipId: d.clipId, transform: d.transform }))
            .catch(err => emitErr('setClipTransform', err));
    }
    function onCrop(e) {
        const d = e.detail || {};
        if (!d.clipId || !d.crop) return;
        Promise.resolve(cfg.api.setClipCrop({ clipId: d.clipId, crop: d.crop }))
            .catch(err => emitErr('setClipCrop', err));
    }

    if (cfg.timelineEl) cfg.timelineEl.addEventListener('sg-timeline:editor-mode-requested', onModeReq);
    if (cfg.previewEl) cfg.previewEl.addEventListener('sg-preview:transform-requested', onTransform);
    if (cfg.previewEl) cfg.previewEl.addEventListener('sg-preview:crop-requested', onCrop);

    applyMode('select');

    return {
        getMode: () => editorMode,
        pushActive,
        destroy() {
            if (cfg.timelineEl) cfg.timelineEl.removeEventListener('sg-timeline:editor-mode-requested', onModeReq);
            if (cfg.previewEl) cfg.previewEl.removeEventListener('sg-preview:transform-requested', onTransform);
            if (cfg.previewEl) cfg.previewEl.removeEventListener('sg-preview:crop-requested', onCrop);
        },
    };
}
