// timeline-mode-buttons.js — Select / Move / Crop editor-mode toolbar buttons (v0.1.0)

import { SGT_EVENTS } from './timeline-events.js';

const MODES = ['select', 'move', 'crop'];
const LABELS = { select: 'Select', move: 'Move / Resize', crop: 'Crop' };
const TITLES = {
    select: 'Click a clip in the preview to select it',
    move: 'Move + resize the selected clip on the canvas',
    crop: 'Crop the selected clip on the canvas',
};

/**
 * Mount the three editor-mode buttons (Select, Move, Crop) into a toolbar.
 * The active mode is highlighted; clicking a button dispatches the
 * EDITOR_MODE_REQUESTED event with `{ mode }`.
 *
 * @param {{
 *   getMode: () => string,
 *   dispatch: (name: string, detail: object) => void,
 * }} cfg
 * @returns {{ root: HTMLElement, refresh: () => void, dispose: () => void }}
 */
export function mountModeButtons(cfg) {
    const root = document.createElement('span');
    root.className = 'editor-mode-buttons';

    const buttons = {};
    for (const mode of MODES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'editor-mode-button';
        btn.dataset.mode = mode;
        btn.textContent = LABELS[mode];
        btn.title = TITLES[mode];
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            cfg.dispatch(SGT_EVENTS.EDITOR_MODE_REQUESTED, { mode });
        });
        buttons[mode] = btn;
        root.appendChild(btn);
    }

    function refresh() {
        const active = cfg.getMode(); // null = no clip selected → none highlighted
        for (const mode of MODES) {
            const btn = buttons[mode];
            const on = mode === active;
            if (on) btn.classList.add('is-active');
            else btn.classList.remove('is-active');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    refresh();
    return { root, refresh, dispose: () => root.remove() };
}
