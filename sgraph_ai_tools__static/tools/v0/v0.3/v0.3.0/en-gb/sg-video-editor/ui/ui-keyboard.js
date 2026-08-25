/** ui-keyboard.js — global keyboard shortcuts for the editor.
 *
 * Listens at the document level and ignores keys when the user is typing in
 * an input / textarea / contenteditable (e.g. the rename-track inline input
 * from Task 3). Fires intent through `api` calls.
 *
 * Shortcuts:
 *   Space         → play / pause toggle (via composer)
 *   Cmd/Ctrl+C    → copy selected clip
 *   Cmd/Ctrl+V    → paste clipboard at selected track + playhead
 *
 * Notes:
 *   - Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (undo/redo) are intentionally NOT
 *     bound — commit 83d004f explicitly removed them; the user wants them off.
 *   - Delete / Backspace also have no binding — clip deletion ships via the
 *     hover-× button on each clip; the keyboard shortcut was removed in the
 *     Round-9-L follow-up (same precedent as 83d004f).
 *
 * Round-9-L: the text-entry guard lives in
 * components/sg-timeline/v0/v0.1/v0.1.1/timeline-focus.js — the same helper
 * is reused by <sg-timeline>'s scoped S split listener so the shadow-DOM-
 * piercing logic is defined exactly once.
 */

import { isTextEntryFocus } from '/components/sg-timeline/v0/v0.1/v0.1.1/timeline-focus.js';

function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

/**
 * Attach the global shortcut listener. Returns a dispose function.
 * @param {{
 *   api: object,
 *   getSelectedClipId: () => string|null,
 *   getSelectedTrackId: () => string|null,
 *   getPlayhead: () => number,
 *   getComposer: () => object|null,
 * }} cfg
 * @returns {{ destroy: () => void }}
 */
export function attachGlobalShortcuts(cfg) {
    function onKeyDown(e) {
        if (isTextEntryFocus()) return;
        const cmdOrCtrl = e.metaKey || e.ctrlKey;

        // Space → play/pause via composer.
        if (e.code === 'Space' && !cmdOrCtrl && !e.altKey) {
            const c = (typeof cfg.getComposer === 'function') ? cfg.getComposer() : null;
            if (!c) return;
            e.preventDefault();
            try {
                if (c.isPlaying && c.isPlaying()) c.pause && c.pause();
                else c.play && c.play();
            } catch (err) { emitErr('play-toggle', err); }
            return;
        }

        if (cmdOrCtrl && (e.key === 'c' || e.key === 'C') && !e.shiftKey && !e.altKey) {
            const sel = cfg.getSelectedClipId && cfg.getSelectedClipId();
            if (!sel) return;
            e.preventDefault();
            Promise.resolve(cfg.api.copyClip({ clipId: sel }))
                .catch(err => emitErr('copyClip', err));
            return;
        }

        if (cmdOrCtrl && (e.key === 'v' || e.key === 'V') && !e.shiftKey && !e.altKey) {
            // Paste at selected track + playhead.
            const cb = cfg.api.hasClipboard ? cfg.api.hasClipboard() : null;
            const has = cb && (cb.hasClipboard === true || cb === true);
            if (!has) return;
            e.preventDefault();
            const proj = cfg.api.getProject ? cfg.api.getProject() : null;
            let target = (cfg.getSelectedTrackId && cfg.getSelectedTrackId()) || null;
            if (!target && proj && Array.isArray(proj.tracks)) {
                const first = proj.tracks.find(t => t && t.kind === 'video');
                if (first) target = first.id;
            }
            if (!target) target = 't-video-1';
            const t = (cfg.getPlayhead && cfg.getPlayhead()) || 0;
            Promise.resolve(cfg.api.pasteClip({
                targetTrackId: target,
                timelineStart: t,
                snap: true,
            })).catch(err => emitErr('pasteClip', err));
            return;
        }
    }

    document.addEventListener('keydown', onKeyDown);
    return {
        destroy() {
            try { document.removeEventListener('keydown', onKeyDown); } catch (_) {}
        },
    };
}
