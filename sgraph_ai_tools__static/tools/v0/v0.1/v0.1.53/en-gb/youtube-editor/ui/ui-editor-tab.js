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
export async function initEditorTab(root, state, api, emit, { id, summary }) {
    root.innerHTML = '';

    const editor = document.createElement('sg-youtube-video-editor');
    editor.setAttribute('allow-delete', '');
    editor.style.cssText = 'display:block;width:100%;';
    root.appendChild(editor);

    // Forward events synchronously — these don't touch the shadow DOM, so
    // we can attach them before whenReady resolves.
    editor.addEventListener('video-loaded',        (e) => emit(SGA_YT.VIDEO_LOADED,    e.detail));
    editor.addEventListener('video-saved',         (e) => emit(SGA_YT.VIDEO_SAVED,     e.detail));
    editor.addEventListener('video-thumbnail-set', (e) => emit(SGA_YT.THUMBNAIL_SET,   e.detail));
    editor.addEventListener('video-deleted',       (e) => emit(SGA_YT.VIDEO_DELETED,   e.detail));
    editor.addEventListener('video-error',         (e) => emit(SGA_YT.ERROR, { step: e.detail.step, message: e.detail.message }));

    window.addEventListener(SGA_YT.CONNECTED, () => {
        if (state.accessToken) editor.setToken(state.accessToken);
    });
    window.addEventListener(SGA_YT.DISCONNECTED, () => editor.setToken(null));

    // Wait for SgComponent to fetch its template + bind elements before
    // populating. Otherwise setVideoSummary / loadVideo run against undefined
    // refs.
    try {
        await editor.whenReady?.();
    } catch {
        // whenReady has a 5 s timeout; fall through and let the component
        // surface its own template-load error.
    }

    if (state.accessToken) editor.setToken(state.accessToken);
    if (summary)           editor.setVideoSummary(summary);
    editor.loadVideo(id);
}
