/**
 * ui-publish.js
 * Publish tab — YouTube connect chip, upload with progress, result URL.
 * Upload is always an explicit click; auto-run never reaches this step.
 * @module ui-publish
 */

import { VP_EVENTS } from '../api/publisher-events.js';

export function initPublishTab(container, state, api, emit) {
    if (!container) return;
    container.innerHTML = `
      <div class="vp-publish">
        <div class="vp-row">
          <span id="vp-pub-chip" class="vp-chip">○ Not connected</span>
          <button id="vp-pub-connect" class="vp-btn">Sign in with Google</button>
          <button id="vp-pub-disconnect" class="vp-btn" hidden>Sign out</button>
        </div>
        <div id="vp-pub-summary" class="vp-muted">Load a video and set a title first.</div>
        <button id="vp-pub-upload" class="vp-btn vp-btn--primary" disabled>⬆ Upload to YouTube</button>
        <progress id="vp-pub-progress" class="vp-progress" max="100" value="0" hidden></progress>
        <button id="vp-pub-download" class="vp-btn vp-btn--big" disabled>⬇ Download video</button>
        <div class="vp-muted">Grab the file to publish elsewhere too — e.g. LinkedIn.</div>
        <div id="vp-pub-result" class="vp-result" hidden>
          <a id="vp-pub-link" target="_blank" rel="noopener"></a>
          <button id="vp-pub-copy" class="vp-btn vp-btn--mini">Copy</button>
        </div>
        <div id="vp-pub-status" class="vp-muted"></div>
      </div>`;

    const $ = s => container.querySelector(s);
    const chip = $('#vp-pub-chip'), connectBtn = $('#vp-pub-connect'), discBtn = $('#vp-pub-disconnect');
    const uploadBtn = $('#vp-pub-upload'), progressEl = $('#vp-pub-progress');
    const resultEl = $('#vp-pub-result'), linkEl = $('#vp-pub-link'), statusEl = $('#vp-pub-status');

    const downloadBtn = $('#vp-pub-download');
    downloadBtn.addEventListener('click', () => { api.downloadVideo().catch(() => {}); });

    function refresh() {
        const yt = state.youtube;
        downloadBtn.disabled = !state.videoBlob;
        if (state.videoBlob) {
            downloadBtn.textContent = `⬇ Download video (${(state.videoBlob.size / (1024 * 1024)).toFixed(1)} MB)`;
        }
        chip.textContent = yt.connected
            ? `● ${yt.channel?.title || 'Connected'}`
            : '○ Not connected';
        chip.classList.toggle('vp-chip--on', yt.connected);
        connectBtn.hidden = yt.connected;
        discBtn.hidden = !yt.connected;
        const ready = !!state.videoBlob && !!state.metadata.title && yt.connected && yt.uploadStatus !== 'uploading';
        uploadBtn.disabled = !ready;
        $('#vp-pub-summary').textContent = !state.videoBlob
            ? 'Load a video first (Record or Import).'
            : !state.metadata.title
                ? 'Set a title in the Metadata tab (or Generate one).'
                : !yt.connected
                    ? 'Sign in with Google to upload.'
                    : `Ready: “${state.metadata.title}” · ${state.metadata.privacy} · ${(state.videoBlob.size / (1024 * 1024)).toFixed(1)} MB`;
    }

    connectBtn.addEventListener('click', async () => {
        statusEl.textContent = '';
        try { await api.connectYouTube(); await api.getMyChannel(); }
        catch (err) { statusEl.textContent = err.message; }
        refresh();
    });
    discBtn.addEventListener('click', () => { api.disconnectYouTube(); refresh(); });

    uploadBtn.addEventListener('click', async () => {
        statusEl.textContent = '';
        try { await api.upload(); }
        catch (err) { statusEl.textContent = err.message; }
        refresh();
    });

    $('#vp-pub-copy').addEventListener('click', () => {
        navigator.clipboard?.writeText(linkEl.href).catch(() => {});
    });

    window.addEventListener(VP_EVENTS.UPLOAD_START, () => {
        progressEl.hidden = false; progressEl.value = 0; resultEl.hidden = true; refresh();
    });
    window.addEventListener(VP_EVENTS.UPLOAD_PROGRESS, e => { progressEl.value = e.detail?.percent ?? 0; });
    window.addEventListener(VP_EVENTS.UPLOAD_COMPLETE, e => {
        progressEl.value = 100;
        resultEl.hidden = false;
        linkEl.href = e.detail?.url || '#';
        linkEl.textContent = e.detail?.url || '';
        statusEl.textContent = 'Uploaded successfully.';
        refresh();
    });
    window.addEventListener(VP_EVENTS.RUN_CANCELLED, () => {
        progressEl.hidden = true;
        statusEl.textContent = 'Cancelled — nothing was published.';
        refresh();
    });
    for (const ev of [VP_EVENTS.YT_CONNECTED, VP_EVENTS.YT_DISCONNECTED, VP_EVENTS.JOB_LOADED,
                      VP_EVENTS.METADATA_COMPLETE, VP_EVENTS.STEP_CHANGED, VP_EVENTS.JOB_RESET]) {
        window.addEventListener(ev, refresh);
    }
    refresh();
}
