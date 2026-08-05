/**
 * ui-source.js
 * Import tab — dropzone for existing MP4/WebM files, video preview of the
 * loaded job (from either entry), handoff notice.
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
        <div id="vp-src-info" class="vp-muted" hidden></div>
        <sg-video-player id="vp-src-player" style="display:none"></sg-video-player>
      </div>`;

    const drop = container.querySelector('#vp-drop');
    const notice = container.querySelector('#vp-src-notice');
    const info = container.querySelector('#vp-src-info');
    const player = container.querySelector('#vp-src-player');
    let objectUrl = null;

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

    window.addEventListener(VP_EVENTS.JOB_LOADED, e => {
        const d = e.detail || {};
        info.hidden = false;
        info.textContent = `${d.filename} · ${(d.byteSize / (1024 * 1024)).toFixed(1)} MB`;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (state.videoBlob) {
            objectUrl = URL.createObjectURL(state.videoBlob);
            player.setAttribute('src', objectUrl);
            player.style.display = 'block';
        }
    });

    window.addEventListener(VP_EVENTS.JOB_RESET, () => {
        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
        player.style.display = 'none';
        info.hidden = true;
        notice.hidden = true;
    });
}
