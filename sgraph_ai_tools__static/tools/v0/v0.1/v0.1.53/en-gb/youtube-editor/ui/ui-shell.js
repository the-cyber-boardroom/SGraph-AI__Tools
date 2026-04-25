/**
 * ui-shell.js
 * Layout: sg-layout split (Auth | right stack of tabs).
 * Right stack starts with "📋 My Videos" + "⬆ Upload"; clicking a video
 * opens an editor tab on the right (mirrors the video-recorder per-recording
 * tab pattern).
 *
 * @module ui-shell
 */

import { SGL_EVENTS }   from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { SGA_YT }       from '../api/youtube-editor-events.js';
import { initAuth }     from './ui-auth.js';
import { initVideosTab } from './ui-videos-tab.js';
import { initUploadTab } from './ui-upload-tab.js';
import { initEditorTab }    from './ui-editor-tab.js';
import { initPlaylistsTab } from './ui-playlists-tab.js';
import { initApiPane }      from './ui-api-pane.js';
import { pickupHandoff }    from '../handoff/sg-youtube-handoff.js';

import '/core/sg-layout/v0.1.0/sg-layout.js';
import '/components/upload-dropzone/v1/v1.0/v1.0.0/sg-upload-dropzone.js';
import '/components/video/upload/sg-youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js';
import '/components/video/manage/sg-youtube-videos/v0/v0.1/v0.1.0/sg-youtube-videos.js';
import '/components/video/manage/sg-youtube-video-editor/v0/v0.1/v0.1.0/sg-youtube-video-editor.js';
import '/components/video/manage/sg-youtube-playlists/v0/v0.1/v0.1.0/sg-youtube-playlists.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';

/**
 * @param {import('../api/youtube-editor-state.js').YouTubeEditorState} state
 * @param {object} api    SgToolApi instance
 * @param {Function} emit
 */
export async function init(state, api, emit) {
    const wrap = document.getElementById('layout-wrap');
    if (!wrap) return;
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    const toolArea = document.createElement('div');
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
    wrap.appendChild(toolArea);

    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'width:100%;height:100%;display:block;';
    toolArea.appendChild(layout);

    const layoutReady = new Promise(r => layout.events.on(SGL_EVENTS.LAYOUT_READY, r));
    layout.setLayout({
        type: 'row', id: 'root', sizes: [0.32, 0.68],
        children: [
            {
                type: 'stack', id: 's-auth', activeTab: 0,
                tabs: [{ type: 'tab', id: 't-auth', title: '🔑 Account', tag: 'div', locked: true, closable: false }],
            },
            {
                type: 'stack', id: 's-right', activeTab: 0,
                tabs: [
                    { type: 'tab', id: 't-videos',    title: '📋 My Videos', tag: 'div', locked: true, closable: false },
                    { type: 'tab', id: 't-upload',    title: '⬆ Upload',     tag: 'div', locked: true, closable: false },
                    { type: 'tab', id: 't-playlists', title: '📂 Playlists', tag: 'div', locked: true, closable: false },
                ],
            },
        ],
    });
    await layoutReady;

    const authEl      = layout.getPanelElement('t-auth');
    const videosEl    = layout.getPanelElement('t-videos');
    const uploadEl    = layout.getPanelElement('t-upload');
    const playlistsEl = layout.getPanelElement('t-playlists');

    if (authEl)      { authEl.style.cssText      = 'height:100%;overflow-y:auto;padding:14px;box-sizing:border-box;'; initAuth(authEl, state, api, emit); }
    if (videosEl)    { videosEl.style.cssText    = 'height:100%;overflow:hidden;padding:14px;box-sizing:border-box;'; initVideosTab(videosEl, state, api, emit, layout); }
    if (uploadEl)    { uploadEl.style.cssText    = 'height:100%;overflow-y:auto;padding:14px;box-sizing:border-box;'; initUploadTab(uploadEl, state, api, emit); }
    if (playlistsEl) { playlistsEl.style.cssText = 'height:100%;overflow:hidden;padding:14px;box-sizing:border-box;'; initPlaylistsTab(playlistsEl, state, api, emit); }

    // ── Hand-off receiver ─────────────────────────────────────────────────────
    // If we were opened by another sg-tool that stashed window.opener.__sgYtHandoff,
    // grab the blob, focus the Upload tab, and stuff the file into the form.
    const handoff = pickupHandoff();
    if (handoff?.blob) {
        layout.focusPanel('t-upload');
        emit(SGA_YT.HANDOFF_RECEIVED, {
            sourceTool:     handoff.sourceTool,
            filename:       handoff.filename,
            suggestedTitle: handoff.suggestedTitle,
            byteSize:       handoff.blob.size,
        });
        // Defer one tick so ui-upload-tab has its DOM mounted to receive it.
        Promise.resolve().then(() => {
            window.dispatchEvent(new CustomEvent('sg-yt-handoff-pickup', { detail: handoff }));
        });
    }

    // ── Open an editor tab when a video is selected ──────────────────────────
    let _openEditors = new Map();   // videoId → tabId

    window.addEventListener(SGA_YT.VIDEO_SELECTED, async (e) => {
        const { id, video } = e.detail;
        if (!id) return;

        // If already open, just focus
        if (_openEditors.has(id)) {
            layout.focusPanel(_openEditors.get(id));
            return;
        }

        const shortTitle = (video?.title || id).slice(0, 30) + ((video?.title?.length || 0) > 30 ? '…' : '');
        const tabId = layout.addTabToStack('s-right', {
            tag:      'div',
            title:    `✎ ${shortTitle}`,
            closable: true,
            locked:   false,
        }, true);
        if (!tabId) return;

        _openEditors.set(id, tabId);

        const tabEl = layout.getPanelElement(tabId);
        if (tabEl) {
            tabEl.style.cssText = 'height:100%;overflow-y:auto;padding:14px;box-sizing:border-box;';
            initEditorTab(tabEl, state, api, emit, { id, summary: video });
        }
    });

    window.addEventListener(SGA_YT.VIDEO_DELETED, () => {
        // Editor tab will close itself on delete-success; nothing to do here.
    });

    initApiPane(wrap);
}
