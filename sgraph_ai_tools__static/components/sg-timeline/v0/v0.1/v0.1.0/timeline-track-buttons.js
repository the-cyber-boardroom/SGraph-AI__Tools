// timeline-track-buttons.js — toolbar +Track button (v0.1.0)

import { SGT_EVENTS } from './timeline-events.js';

/**
 * Build the +Track toolbar button. Caller appends `root` to the toolbar.
 * Dispatches TRACK_ADD_REQUESTED with `{ kind: 'video' }`.
 *
 * @param {{ dispatch: (name: string, detail: object) => void }} cfg
 * @returns {{ root: HTMLElement, dispose: () => void }}
 */
export function mountAddTrackButton(cfg) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'add-track-button';
    btn.textContent = '+ Track';
    btn.title = 'Add a new video track';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        cfg.dispatch(SGT_EVENTS.TRACK_ADD_REQUESTED, { kind: 'video' });
    });
    return { root: btn, dispose: () => btn.remove() };
}
