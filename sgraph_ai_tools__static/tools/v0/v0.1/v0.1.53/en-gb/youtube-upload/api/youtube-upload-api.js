/**
 * youtube-upload-api.js
 * Entry point — registers SgToolApi methods, calls activate() before UI init.
 * @module youtube-upload-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { SGA_YT }    from './youtube-upload-events.js';
import { state }     from './youtube-upload-state.js';
import * as P        from './youtube-upload-pipeline.js';
import { init as initShell } from '../ui/ui-shell.js';

// ── API instance ──────────────────────────────────────────────────────────────

const api = new SgToolApi({
    name:     'youtube-upload',
    version:  { api: '0.1.0', ui: '0.1.0', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './skills/SKILL-human.md',
        browser: './skills/SKILL-browser.md',
        api:     './skills/SKILL-api.md',
    },
});

function emit(eventName, detail = {}) { api._emit(eventName, detail); }

// ── Method implementations ────────────────────────────────────────────────────

P.hydrate();

/** @returns {Promise<{ ok: true }>} */
async function connect({ clientId, silent } = {}) {
    await P.connect({ clientId, silent, emit });
    return { ok: true };
}

function disconnect() {
    P.disconnect({ emit });
    return {};
}

/** @param {{ file: File|Blob }} params */
function setFile({ file }) {
    P.setFile(file, { emit });
    return {
        fileName: state.file?.name ?? null,
        fileSize: state.file?.size ?? 0,
    };
}

/** @param {{ clientId: string }} params */
function setClientId({ clientId }) {
    P.setClientId(clientId);
    return { clientId: P.getClientId() };
}

/**
 * Upload the currently-set file.
 * @param {{ title: string, description?: string, tags?: string[],
 *           privacyStatus?: 'private'|'unlisted'|'public', categoryId?: number }} metadata
 * @returns {Promise<{ id: string, url: string }>}
 */
async function uploadVideo(metadata) {
    return await P.uploadVideo(metadata, { emit });
}

function getStatus() {
    return {
        connected:    state.connected,
        hasFile:      !!state.file,
        fileName:     state.file?.name ?? null,
        fileSize:     state.file?.size ?? 0,
        status:       state.status,
        progress:     state.progress,
        lastVideoId:  state.lastVideoId,
        lastVideoUrl: state.lastVideoUrl,
        lastError:    state.lastError,
        expiresInMs:  state.expiresAt ? state.expiresAt - Date.now() : null,
    };
}

function health() { return P.health(); }

// ── Registration + activation ─────────────────────────────────────────────────

api
    .register('connect',       connect,       { async: true,  events: [SGA_YT.CONNECTED, SGA_YT.ERROR] })
    .register('disconnect',    disconnect,    { async: false, events: [SGA_YT.DISCONNECTED] })
    .register('setClientId',   setClientId,   { async: false, sanitiseParams: p => ({ ...p, clientId: '••••' }) })
    .register('setFile',       setFile,       { async: false, events: [SGA_YT.FILE_SET] })
    .register('uploadVideo',   uploadVideo,   { async: true,  events: [SGA_YT.UPLOAD_START, SGA_YT.UPLOAD_PROGRESS, SGA_YT.UPLOAD_COMPLETE, SGA_YT.ERROR] })
    .register('getStatus',     getStatus,     { async: false })
    .register('health',        health,        { async: false });

// JS-API-first: activate before UI so window.__tool is live from tool:ready
api.activate();

// Hand off to UI shell
await initShell(state, api, emit);
