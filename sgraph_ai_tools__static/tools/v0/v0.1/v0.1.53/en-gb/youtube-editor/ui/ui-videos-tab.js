/**
 * ui-videos-tab.js
 * Right tab — embeds <sg-youtube-videos>, refreshes on connect, forwards
 * clicks as SGA_YT.VIDEO_SELECTED so the shell can open editor tabs.
 *
 * @module ui-videos-tab
 */

import { SGA_YT } from '../api/youtube-editor-events.js';

/**
 * @param {HTMLElement} root
 * @param {object} state
 * @param {object} api    SgToolApi instance
 * @param {Function} emit
 * @param {*} layout      sg-layout instance (unused here, kept for symmetry)
 */
export function initVideosTab(root, state, api, emit, layout) {
    root.innerHTML = '';
    const grid = document.createElement('sg-youtube-videos');
    grid.id = 'yt-grid';
    grid.setAttribute('page-size', '50');
    grid.style.cssText = 'display:block;height:100%;';
    root.appendChild(grid);

    function _hydrateToken() {
        if (state.connected && state.accessToken) {
            grid.setToken(state.accessToken);
            grid.refresh();
        } else {
            grid.setToken(null);
        }
    }

    _hydrateToken();

    grid.addEventListener('video-selected', (e) => {
        emit(SGA_YT.VIDEO_SELECTED, { id: e.detail.id, video: e.detail.video });
    });

    grid.addEventListener('videos-loaded', (e) => {
        emit(SGA_YT.VIDEOS_LOADED, e.detail);
    });

    grid.addEventListener('videos-error', (e) => {
        emit(SGA_YT.ERROR, { step: 'list', message: e.detail.message });
    });

    window.addEventListener(SGA_YT.CONNECTED,    _hydrateToken);
    window.addEventListener(SGA_YT.DISCONNECTED, _hydrateToken);

    // Refresh after upload completes so the new video appears
    window.addEventListener(SGA_YT.UPLOAD_COMPLETE, () => {
        if (state.connected) grid.refresh();
    });

    // Also drop deleted rows from the visible grid
    window.addEventListener(SGA_YT.VIDEO_DELETED, () => {
        if (state.connected) grid.refresh();
    });
}
