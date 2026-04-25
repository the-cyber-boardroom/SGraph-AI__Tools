// timeline-history-buttons.js — Undo/Redo toolbar buttons for sg-timeline (v0.1.0)

import { SGT_EVENTS } from './timeline-events.js';

/**
 * Build the Undo + Redo toolbar buttons. Caller appends `root` to the toolbar.
 * Refresh must be called whenever history flags change.
 *
 * @param {{
 *   getFlags: () => { canUndo: boolean, canRedo: boolean },
 *   dispatch: (name: string, detail: object) => void,
 * }} cfg
 * @returns {{ root: HTMLElement, refresh: () => void, dispose: () => void }}
 */
export function mountHistoryButtons(cfg) {
    const root = document.createElement('span');
    root.className = 'history-buttons';

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'history-button history-button--undo';
    undoBtn.textContent = 'Undo';
    undoBtn.title = 'Undo (Cmd/Ctrl+Z)';
    undoBtn.disabled = true;

    const redoBtn = document.createElement('button');
    redoBtn.type = 'button';
    redoBtn.className = 'history-button history-button--redo';
    redoBtn.textContent = 'Redo';
    redoBtn.title = 'Redo (Cmd/Ctrl+Shift+Z)';
    redoBtn.disabled = true;

    function refresh() {
        const f = cfg.getFlags() || { canUndo: false, canRedo: false };
        undoBtn.disabled = !f.canUndo;
        redoBtn.disabled = !f.canRedo;
    }

    undoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (undoBtn.disabled) return;
        cfg.dispatch(SGT_EVENTS.CLIP_UNDO_REQUESTED, {});
    });
    redoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (redoBtn.disabled) return;
        cfg.dispatch(SGT_EVENTS.CLIP_REDO_REQUESTED, {});
    });

    root.appendChild(undoBtn);
    root.appendChild(redoBtn);
    refresh();

    return { root, refresh, dispose: () => root.remove() };
}

/** Build a thin vertical separator div for the toolbar. */
export function buildToolbarSeparator() {
    const s = document.createElement('span');
    s.className = 'toolbar-sep';
    return s;
}
