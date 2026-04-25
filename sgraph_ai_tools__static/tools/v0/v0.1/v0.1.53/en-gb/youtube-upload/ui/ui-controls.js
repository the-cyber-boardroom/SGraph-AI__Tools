/**
 * ui-controls.js
 * Left panel — file dropzone + the embeddable <sg-youtube-upload> component.
 * The dropzone hands the picked file to the component (so the component
 * itself remains source-agnostic — perfect for the recorder hand-off later).
 *
 * @module ui-controls
 */

import { SGA_YT }            from '../api/youtube-upload-events.js';
import { DEFAULT_CLIENT_ID } from '../api/youtube-upload-pipeline.js';

/**
 * @param {HTMLElement} root
 * @param {import('../api/youtube-upload-state.js').YouTubeUploadState} state
 * @param {object}   api    SgToolApi instance
 * @param {Function} emit
 */
export function initControls(root, state, api, emit) {
    root.innerHTML = '';

    const intro = document.createElement('div');
    intro.className = 'yt-intro';
    intro.innerHTML = `
        <h2 class="yt-intro__title">Upload a video to YouTube</h2>
        <p class="yt-intro__body">
            Pick a file (or drop it below), connect with Google, then upload.
            Bytes go straight from this browser tab to YouTube — no SGraph server in the middle.
        </p>
    `;
    root.appendChild(intro);

    // ── File dropzone ─────────────────────────────────────────────────────────
    const dropWrap = document.createElement('div');
    dropWrap.className = 'yt-block';
    const dz = document.createElement('sg-upload-dropzone');
    dz.id = 'yt-dropzone';
    dz.setAttribute('accept', 'video/*');
    dz.setAttribute('label', 'Drop a video here, or click to choose');
    dropWrap.appendChild(dz);
    root.appendChild(dropWrap);

    // ── Upload component ──────────────────────────────────────────────────────
    const upWrap = document.createElement('div');
    upWrap.className = 'yt-block';
    const uploader = document.createElement('sg-youtube-upload');
    uploader.id = 'yt-uploader';
    uploader.setAttribute('client-id', DEFAULT_CLIENT_ID);
    uploader.setAttribute('default-privacy', 'unlisted');
    upWrap.appendChild(uploader);
    root.appendChild(upWrap);

    // ── Wiring ────────────────────────────────────────────────────────────────
    dz.addEventListener('files-selected', (e) => {
        const file = e.detail?.files?.[0];
        if (!file) return;
        api.setFile({ file });
        uploader.setFile(file);
    });

    uploader.addEventListener('youtube-connected', (e) => {
        emit(SGA_YT.CONNECTED, e.detail);
    });
    uploader.addEventListener('youtube-disconnected', () => {
        emit(SGA_YT.DISCONNECTED, {});
    });
    uploader.addEventListener('youtube-upload-start', (e) => {
        emit(SGA_YT.UPLOAD_START, e.detail);
    });
    uploader.addEventListener('youtube-upload-progress', (e) => {
        emit(SGA_YT.UPLOAD_PROGRESS, e.detail);
    });
    uploader.addEventListener('youtube-upload-complete', (e) => {
        emit(SGA_YT.UPLOAD_COMPLETE, e.detail);
    });
    uploader.addEventListener('youtube-upload-error', (e) => {
        emit(SGA_YT.ERROR, { step: 'upload', message: e.detail?.message });
    });
}
