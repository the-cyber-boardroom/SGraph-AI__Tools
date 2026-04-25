/**
 * ui-editor-tab.js
 * Per-video editor tab — wraps <sg-youtube-video-editor>.
 * Forwards its events to SGA_YT for activity tracking. Closes the tab on delete.
 *
 * @module ui-editor-tab
 */

import { SGA_YT } from '../api/youtube-editor-events.js';

/**
 * @param {HTMLElement} root
 * @param {object} state
 * @param {object} api    SgToolApi instance
 * @param {Function} emit
 * @param {{ id: string, summary?: object }} ctx
 */
export function initEditorTab(root, state, api, emit, { id, summary }) {
    root.innerHTML = '';

    const editor = document.createElement('sg-youtube-video-editor');
    editor.setAttribute('allow-delete', '');
    editor.style.cssText = 'display:block;width:100%;';
    root.appendChild(editor);

    // Hand it the access token + populate header from the summary while we fetch full details
    if (state.accessToken) editor.setToken(state.accessToken);
    if (summary)           editor.setVideoSummary(summary);

    editor.whenReady?.().then(() => editor.loadVideo(id));

    // Forward events so the activity log + state stay consistent
    editor.addEventListener('video-loaded',   (e) => emit(SGA_YT.VIDEO_LOADED,    e.detail));
    editor.addEventListener('video-saved',    (e) => emit(SGA_YT.VIDEO_SAVED,     e.detail));
    editor.addEventListener('video-thumbnail-set', (e) => emit(SGA_YT.THUMBNAIL_SET, e.detail));
    editor.addEventListener('video-error',    (e) => emit(SGA_YT.ERROR, { step: e.detail.step, message: e.detail.message }));
    editor.addEventListener('video-deleted',  (e) => emit(SGA_YT.VIDEO_DELETED, e.detail));

    // Re-token if the user reconnects mid-edit
    window.addEventListener(SGA_YT.CONNECTED, () => {
        if (state.accessToken) editor.setToken(state.accessToken);
    });
    window.addEventListener(SGA_YT.DISCONNECTED, () => editor.setToken(null));
}
