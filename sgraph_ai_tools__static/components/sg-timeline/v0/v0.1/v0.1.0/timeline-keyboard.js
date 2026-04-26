// timeline-keyboard.js — keyboard shortcuts for sg-timeline (v0.1.0)

import { snapToFps, clipTimelineEnd } from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { SGT_EVENTS } from './timeline-events.js';
import { isTextEntryFocus } from './timeline-focus.js';

/**
 * Find a clip by id across all video tracks of state.project.
 * @param {object} state
 * @param {string} clipId
 * @returns {object|null}
 */
function findClip(state, clipId) {
    const project = state && state.project;
    if (!project || !Array.isArray(project.tracks)) return null;
    for (const t of project.tracks) {
        if (t && t.kind === 'video' && Array.isArray(t.clips)) {
            for (const c of t.clips) if (c && c.id === clipId) return c;
        }
    }
    return null;
}

/**
 * Whether keyboard input should be acted on (focus inside hostEl).
 * @param {HTMLElement|undefined} hostEl
 * @returns {boolean}
 */
function isFocusedInside(hostEl) {
    if (!hostEl) return true;
    const ae = document.activeElement;
    if (!ae) return false;
    if (ae === hostEl || hostEl.contains(ae)) return true;
    const sr = ae.shadowRoot;
    return !!(sr && sr.contains && sr.contains(hostEl));
}

/**
 * Attach the S split shortcut to the host element. The Delete/Backspace
 * clip-removal shortcut was removed (commit follows the same precedent as
 * 83d004f, which dropped the Cmd/Ctrl+Z undo/redo shortcuts) — clip removal
 * still ships via the hover-× button on each clip, dispatched from
 * timeline-interactions.js. The text-entry guard via isTextEntryFocus() is
 * retained because it benefits the S shortcut and any future shortcuts.
 * @param {HTMLElement|undefined} hostEl Custom-element host.
 * @param {() => {project: object|null, fps: number, playhead?: number, selectedClipId?: string|null}} getState
 * @param {(name: string, detail: object) => void} dispatch
 * @returns {() => void} dispose
 */
export function attachKeyboard(hostEl, getState, dispatch) {
    if (!hostEl) return () => {};
    function onKeyDown(e) {
        if (!isFocusedInside(hostEl)) return;
        // Text-entry guard: when focus is inside an INPUT / TEXTAREA / SELECT
        // / contenteditable (e.g. the inline rename input mounted by
        // timeline-track-headers.js), skip the shortcut entirely so the
        // keystroke reaches the input. NO preventDefault — the input must
        // still receive 's' as a normal text edit.
        if (isTextEntryFocus()) return;
        const state = getState();
        const sel = state.selectedClipId;
        if (!sel) return;
        if (e.key === 's' || e.key === 'S') {
            const clip = findClip(state, sel);
            if (!clip) return;
            const { fps, playhead } = state;
            const t = snapToFps(Number.isFinite(playhead) ? playhead : 0, fps || 30);
            if (t > clip.timelineStart && t < clipTimelineEnd(clip)) {
                e.preventDefault();
                dispatch(SGT_EVENTS.CLIP_SPLIT_REQUESTED, { clipId: sel, atTime: t });
            }
        }
    }
    hostEl.addEventListener('keydown', onKeyDown);
    return () => hostEl.removeEventListener('keydown', onKeyDown);
}
