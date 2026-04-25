/** ui-shell-composer.js — composer rebuild + project shape helpers for ui-shell. */

import { createComposer } from '/core/video-composer/v0/v0.1/v0.1.0/sg-video-composer.js';

/** True if the flat composer-project has at least one clip on a video track. */
export function hasAnyClip(flat) {
    if (!flat || !Array.isArray(flat.tracks)) return false;
    for (const t of flat.tracks) {
        if (t && t.kind === 'video' && Array.isArray(t.clips) && t.clips.length > 0) return true;
    }
    return false;
}

/** Dispatch a `tool:error` CustomEvent on `document`. */
export function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

/**
 * Rebuild the composer for the current state. Detaches the old composer
 * from the preview element first; no-ops if there are no clips or no preview.
 * After attaching the new composer, seeks to `playheadHint` (default 0) so
 * the canvas paints the current frame immediately rather than waiting for
 * the user to press play (the scheduler only paints inside the tick loop).
 *
 * @param {{
 *   state: object,
 *   previewEl: HTMLElement|null,
 *   getComposer: () => object|null,
 *   setComposer: (c: object|null) => void,
 *   playheadHint?: number,
 * }} cfg
 * @returns {void}
 */
export function rebuildComposer(cfg) {
    const existing = cfg.getComposer();
    if (existing) {
        try { cfg.previewEl && cfg.previewEl.detachComposer(); } catch (_) {}
        try { existing.destroy(); } catch (_) {}
        cfg.setComposer(null);
    }
    const flat = cfg.state.toComposerProject();
    if (!hasAnyClip(flat) || !cfg.previewEl) return;
    const fps = Number.isFinite(flat.fps) ? flat.fps : 30;
    try {
        const c = createComposer({
            project: flat,
            assets: cfg.state.getAssetRegistry(),
            canvas: cfg.previewEl.getCanvas(),
            fps,
        });
        cfg.previewEl.attachComposer(c);
        cfg.setComposer(c);
        const t = Number.isFinite(cfg.playheadHint) ? cfg.playheadHint : 0;
        try { if (typeof c.seek === 'function') c.seek(t); } catch (_) {}
    } catch (err) { emitErr('composer', err); }
}
