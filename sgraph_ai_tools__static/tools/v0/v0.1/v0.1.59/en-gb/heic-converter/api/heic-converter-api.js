/**
 * heic-converter-api — tool entry.
 *
 * Builds the in-memory state, registers all SgToolApi methods, calls
 * `api.activate()` (publishes `window.__tool`, fires `tool:ready`), then
 * mounts the UI shell.
 *
 * Loaded as the `entry: true` phase-3 script by manifest-loader.
 *
 * @module heic-converter/heic-converter-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { createState } from '../ui/state.js';
import { buildConvertMethods } from './api-convert.js';
import { buildOutputMethods } from './api-output.js';
import { mountShell } from '../ui/ui-shell.js';

const passthrough = (p) => p;

/** Strip blobs from logged params (files are large + un-serialisable). */
const fileSanitiser = (p = {}) => ({
    ...p,
    files: Array.isArray(p.files) || p.files instanceof FileList
        ? `[${p.files.length} File(s)]`
        : p.files,
});

/**
 * Tool entry. Called by manifest-loader once all loader phases complete.
 * @param {object} manifest - the parsed manifest.json
 * @returns {Promise<SgToolApi>}
 */
export async function init(manifest) {
    const state = createState();

    const api = new SgToolApi({
        name: 'heic-converter',
        version: { api: '0.2.0', ui: '0.2.0', content: '0.2.0' },
        panelId: 'root',
        manifest: './manifest.json',
        skills: (manifest && manifest.skills) || {},
    });

    // Bind a tool-scoped emitter so the api methods can fire window events
    // with `instanceId` injected (same convention as sg-video-editor).
    const emit = (name, detail) => api._emit(name, detail || {});

    const convert = buildConvertMethods({ state, emit });
    const output  = buildOutputMethods({ state });

    api
        .register('addFiles',           convert.addFiles,           { async: true,  sanitiseParams: fileSanitiser })
        .register('getItems',           convert.getItems,           { async: false, sanitiseParams: passthrough })
        .register('setFormat',          convert.setFormat,          { async: false, sanitiseParams: passthrough })
        .register('setQuality',         convert.setQuality,         { async: false, sanitiseParams: passthrough })
        .register('setLivePhotoDedup',  convert.setLivePhotoDedup,  { async: false, sanitiseParams: passthrough })
        .register('convertOne',         convert.convertOne,         { async: true,  sanitiseParams: passthrough })
        .register('convertAll',         convert.convertAll,         { async: true,  sanitiseParams: passthrough })
        .register('downloadOne',        output.downloadOne,         { async: true,  sanitiseParams: passthrough })
        .register('downloadAllZip',     output.downloadAllZip,      { async: true,  sanitiseParams: passthrough })
        .register('reset',              convert.reset,              { async: false, sanitiseParams: passthrough });

    api.activate();

    const host = document.querySelector('#heic-converter-root');
    mountShell({ host, state, api });

    return api;
}
