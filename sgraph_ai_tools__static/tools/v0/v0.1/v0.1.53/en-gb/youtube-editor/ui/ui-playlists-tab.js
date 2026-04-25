/**
 * ui-playlists-tab.js
 * Right tab — embeds <sg-youtube-playlists>. Forwards "playlist-item-selected"
 * to SGA_YT.VIDEO_SELECTED so clicking a video inside a playlist opens an
 * editor tab the same way clicking a row in My Videos does.
 *
 * @module ui-playlists-tab
 */

import { SGA_YT } from '../api/youtube-editor-events.js';

export function initPlaylistsTab(root, state, api, emit) {
    root.innerHTML = '';
    const list = document.createElement('sg-youtube-playlists');
    list.id = 'yt-playlists';
    list.style.cssText = 'display:block;height:100%;';
    root.appendChild(list);

    async function _hydrateToken() {
        try { await list.whenReady?.(); } catch { /* fall through */ }
        if (state.connected && state.accessToken) {
            list.setToken(state.accessToken);
            list.refresh();
        } else {
            list.setToken(null);
        }
    }

    _hydrateToken();

    list.addEventListener('playlists-loaded', (e) => emit(SGA_YT.PLAYLISTS_LOADED, e.detail));
    list.addEventListener('playlists-error',  (e) => emit(SGA_YT.ERROR, { step: 'playlists', message: e.detail.message }));
    list.addEventListener('playlist-expanded', (e) => emit(SGA_YT.PLAYLIST_EXPANDED, e.detail));
    list.addEventListener('playlist-item-selected', (e) => {
        // Reuse the same VIDEO_SELECTED event so the shell opens an editor tab.
        emit(SGA_YT.VIDEO_SELECTED, { id: e.detail.videoId, video: e.detail.item });
    });

    window.addEventListener(SGA_YT.CONNECTED,    _hydrateToken);
    window.addEventListener(SGA_YT.DISCONNECTED, _hydrateToken);
}
