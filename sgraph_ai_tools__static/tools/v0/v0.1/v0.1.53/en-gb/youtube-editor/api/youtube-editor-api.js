/**
 * youtube-editor-api.js
 * Entry point — registers SgToolApi, calls activate() before UI init.
 * All window.__tool methods are live as soon as tool:ready fires.
 *
 * @module youtube-editor-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { SGA_YT }    from './youtube-editor-events.js';
import { state }     from './youtube-editor-state.js';
import * as P        from './youtube-editor-pipeline.js';
import { init as initShell } from '../ui/ui-shell.js';

// ── API instance ─────────────────────────────────────────────────────────────

const api = new SgToolApi({
    name:     'youtube-editor',
    version:  { api: '0.1.0', ui: '0.1.0', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './skills/SKILL-human.md',
        browser: './skills/SKILL-browser.md',
        api:     './skills/SKILL-api.md',
    },
});

function emit(eventName, detail = {}) { api._emit(eventName, detail); }

P.hydrate();

// ── Method implementations ───────────────────────────────────────────────────

async function connect(params = {}) { await P.connect({ ...params, emit }); return { ok: true }; }
function disconnect()                { P.disconnect({ emit }); return {}; }

function setClientId({ clientId })   { P.setClientId(clientId); return { clientId: P.getClientId() }; }

async function getMyChannel()        { return await P.getMyChannel({ emit }); }
async function listMyUploads(params = {}) { return await P.listMyUploads({ ...params, emit }); }
async function loadVideo({ id })     { return await P.loadVideo(id, { emit }); }
async function updateVideo({ id, patch }) { return await P.updateVideo(id, patch, { emit }); }
async function setThumbnail({ id, blob })  { return await P.setThumbnail(id, blob, { emit }); }
async function deleteVideo({ id })   { await P.deleteVideo(id, { emit }); return { id }; }

async function uploadVideo({ file, metadata }) {
    return await P.uploadVideo(file, metadata, { emit });
}

async function listMyPlaylists(params = {})            { return await P.listMyPlaylists({ ...params, emit }); }
async function listPlaylistItems({ playlistId, ...rest }) { return await P.listPlaylistItems(playlistId, { ...rest, emit }); }
async function findVideoPlaylists({ videoId, playlistIds }) { return await P.findVideoPlaylists(videoId, playlistIds, { emit }); }
async function addToPlaylist({ playlistId, videoId, position }) { return await P.addToPlaylist(playlistId, videoId, { position, emit }); }
async function removeFromPlaylist({ playlistItemId, playlistId, videoId }) {
    await P.removeFromPlaylist(playlistItemId, { emit, playlistId, videoId });
    return { ok: true };
}

async function getChannelAnalyticsSummary(params = {}) { return await P.getChannelAnalyticsSummary({ ...params, emit }); }
async function getVideoAnalyticsSummary({ videoId, days })   { return await P.getVideoAnalyticsSummary(videoId, { days, emit }); }
async function getVideoRetention({ videoId })                { return await P.getVideoRetention(videoId, { emit }); }
async function getVideoDailyTrend({ videoId, days })         { return await P.getVideoDailyTrend(videoId, { days, emit }); }

function getStatus() {
    return {
        connected:      state.connected,
        expiresInMs:    state.expiresAt ? state.expiresAt - Date.now() : null,
        channelTitle:   state.channel?.title || null,
        videosLoaded:   state.videos.length,
        selectedId:     state.selectedId,
        editingVideoId: state.editingVideo?.id || null,
        uploadStatus:   state.uploadStatus,
        uploadProgress: state.uploadProgress,
        lastError:      state.lastError,
    };
}

function health() { return P.health(); }

// ── Registration + activation ────────────────────────────────────────────────

api
    .register('connect',       connect,       { async: true,  events: [SGA_YT.CONNECTED, SGA_YT.ERROR] })
    .register('disconnect',    disconnect,    { async: false, events: [SGA_YT.DISCONNECTED] })
    .register('setClientId',   setClientId,   { async: false, sanitiseParams: p => ({ ...p, clientId: '••••' }) })
    .register('getMyChannel',  getMyChannel,  { async: true,  events: [SGA_YT.CHANNEL_LOADED] })
    .register('listMyUploads', listMyUploads, { async: true,  events: [SGA_YT.VIDEOS_LOADED] })
    .register('loadVideo',     loadVideo,     { async: true,  events: [SGA_YT.VIDEO_LOADED] })
    .register('updateVideo',   updateVideo,   { async: true,  events: [SGA_YT.VIDEO_SAVED, SGA_YT.ERROR] })
    .register('setThumbnail',  setThumbnail,  { async: true,  events: [SGA_YT.THUMBNAIL_SET, SGA_YT.ERROR] })
    .register('deleteVideo',   deleteVideo,   { async: true,  events: [SGA_YT.VIDEO_DELETED, SGA_YT.ERROR] })
    .register('uploadVideo',   uploadVideo,   { async: true,  events: [SGA_YT.UPLOAD_START, SGA_YT.UPLOAD_PROGRESS, SGA_YT.UPLOAD_COMPLETE, SGA_YT.ERROR] })
    .register('listMyPlaylists',    listMyPlaylists,    { async: true, events: [SGA_YT.PLAYLISTS_LOADED] })
    .register('listPlaylistItems',  listPlaylistItems,  { async: true, events: [SGA_YT.PLAYLIST_EXPANDED] })
    .register('findVideoPlaylists', findVideoPlaylists, { async: true })
    .register('addToPlaylist',      addToPlaylist,      { async: true, events: [SGA_YT.PLAYLISTS_CHANGED, SGA_YT.ERROR] })
    .register('removeFromPlaylist', removeFromPlaylist, { async: true, events: [SGA_YT.PLAYLISTS_CHANGED, SGA_YT.ERROR] })
    .register('getChannelAnalyticsSummary', getChannelAnalyticsSummary, { async: true, events: [SGA_YT.ANALYTICS_CHANNEL] })
    .register('getVideoAnalyticsSummary',   getVideoAnalyticsSummary,   { async: true, events: [SGA_YT.ANALYTICS_VIDEO] })
    .register('getVideoRetention',          getVideoRetention,          { async: true, events: [SGA_YT.ANALYTICS_RETENTION] })
    .register('getVideoDailyTrend',         getVideoDailyTrend,         { async: true })
    .register('getStatus',     getStatus,     { async: false })
    .register('health',        health,        { async: false });

api.activate();

await initShell(state, api, emit);
