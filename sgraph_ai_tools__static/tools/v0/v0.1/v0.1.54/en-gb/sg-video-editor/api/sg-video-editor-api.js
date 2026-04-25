/** sg-video-editor-api.js — entry; constructs SgToolApi, registers methods, mounts shell. */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { createState, createInitialProject } from '../ui/state.js';
import { buildApiMethods } from './api-methods.js';
import { mountShell } from '../ui/ui-shell.js';

const passthrough = (p) => p;

const fileSanitiser = (p = {}) => ({
    ...p,
    file: p.file ? `[File ${p.file.name || 'asset'} ${p.file.size || 0}b]` : p.file,
});

const projectSanitiser = (p = {}) => ({
    ...p,
    project: p.project ? '[project]' : p.project,
});

function emitToolError(step, message) {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent('tool:error', { detail: { step, message } }));
}

/** Tool entry; called by manifest-loader after all phases complete. */
export async function init(manifest) {
    try {
        const state = createState(createInitialProject({}));

        let composer = null;
        const getComposer = () => composer;
        const setComposer = (c) => { composer = c || null; };

        const host = document.querySelector('#sg-video-editor-root');
        const methods = buildApiMethods({ state, getComposer, setComposer, hostEl: host });

        const api = new SgToolApi({
            name: 'sg-video-editor',
            version: { api: '0.1.0', ui: '0.1.0', content: '0.1.0' },
            panelId: 'main',
            manifest: manifest || './manifest.json',
            skills: (manifest && manifest.skills) || {},
        });

        api
            .register('loadAsset',  methods.loadAsset,  { async: true,  sanitiseParams: fileSanitiser })
            .register('addClip',    methods.addClip,    { async: false, sanitiseParams: passthrough })
            .register('trimClip',   methods.trimClip,   { async: false, sanitiseParams: passthrough })
            .register('removeClip', methods.removeClip, { async: false, sanitiseParams: passthrough })
            .register('moveClip',   methods.moveClip,   { async: false, sanitiseParams: passthrough })
            .register('getProject', methods.getProject, { async: false, sanitiseParams: passthrough })
            .register('setProject', methods.setProject, { async: false, sanitiseParams: projectSanitiser })
            .register('exportMp4',  methods.exportMp4,  { async: true,  sanitiseParams: passthrough });

        api.activate();

        mountShell({ host, state, api, getComposer, setComposer });

        return api;
    } catch (err) {
        emitToolError('init', err && err.message ? err.message : String(err));
        throw err;
    }
}
