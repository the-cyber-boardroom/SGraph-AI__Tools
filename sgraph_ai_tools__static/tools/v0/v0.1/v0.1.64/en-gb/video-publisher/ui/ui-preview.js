/**
 * ui-preview.js
 * Preview tab — the loaded video (recorded, imported, or handed off) plays
 * here. Auto-focused when a job lands so a finished recording is immediately
 * reviewable.
 * @module ui-preview
 */

import { VP_EVENTS } from '../api/publisher-events.js';

export function initPreviewTab(container, state, api, emit, layout) {
    if (!container) return;
    container.innerHTML = `
      <div class="vp-preview-tab">
        <div id="vp-prev-empty" class="vp-muted">Nothing loaded yet — record in the Record tab or drop a file in Import.</div>
        <div id="vp-prev-info" class="vp-muted" hidden></div>
        <sg-video-player id="vp-prev-player" class="vp-hidden"></sg-video-player>
      </div>`;

    const emptyEl = container.querySelector('#vp-prev-empty');
    const infoEl  = container.querySelector('#vp-prev-info');
    const player  = container.querySelector('#vp-prev-player');
    let objectUrl = null;

    const SOURCE_LABEL = { record: 'recorded', import: 'imported', handoff: 'received' };

    window.addEventListener(VP_EVENTS.JOB_LOADED, e => {
        const d = e.detail || {};
        emptyEl.hidden = true;
        infoEl.hidden = false;
        infoEl.textContent = `${d.filename} · ${(d.byteSize / (1024 * 1024)).toFixed(1)} MB · ${SOURCE_LABEL[d.source] || d.source}`;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (state.videoBlob) {
            objectUrl = URL.createObjectURL(state.videoBlob);
            player.setAttribute('src', objectUrl);
            player.classList.remove('vp-hidden');
        }
        layout?.focusPanel('t-preview');
    });

    window.addEventListener(VP_EVENTS.JOB_RESET, () => {
        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
        player.classList.add('vp-hidden');
        infoEl.hidden = true;
        emptyEl.hidden = false;
    });
}
