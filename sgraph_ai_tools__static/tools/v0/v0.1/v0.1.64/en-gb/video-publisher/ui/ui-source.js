/**
 * ui-source.js
 * Import tab — dropzone for existing MP4/WebM files, plus the handoff
 * notice. The loaded video plays in the Preview tab (ui-preview.js).
 * @module ui-source
 */

import { VP_EVENTS } from '../api/publisher-events.js';

export function initSourceTab(container, state, api, emit) {
    if (!container) return;
    container.innerHTML = `
      <div class="vp-source">
        <sg-upload-dropzone id="vp-drop" accept="video/*,.mp4,.webm,.mov,.mkv"
            label="Drop a video here" sublabel="or click to choose a file"></sg-upload-dropzone>
        <div id="vp-src-notice" class="vp-notice" hidden></div>
      </div>`;

    const drop = container.querySelector('#vp-drop');
    const notice = container.querySelector('#vp-src-notice');

    drop.addEventListener('files-selected', e => {
        const file = e.detail?.files?.[0];
        if (!file) return;
        try { api.importFile({ file }); }
        catch (err) { notice.hidden = false; notice.textContent = err.message; }
    });

    window.addEventListener(VP_EVENTS.HANDOFF_RECEIVED, e => {
        const d = e.detail || {};
        notice.hidden = false;
        notice.textContent = `Received from ${d.sourceTool || 'another tool'}${d.hasAudioBlob ? ' (with separate audio — no extraction needed)' : ''}.`;
    });

    window.addEventListener(VP_EVENTS.JOB_RESET, () => { notice.hidden = true; });
}
