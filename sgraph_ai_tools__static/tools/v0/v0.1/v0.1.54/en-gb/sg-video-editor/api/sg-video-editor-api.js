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
            manifest: './manifest.json',
            skills: (manifest && manifest.skills) || {},
        });

        api
            .register('loadAsset',  methods.loadAsset,  { async: true,  sanitiseParams: fileSanitiser })
            .register('removeAsset', methods.removeAsset, { async: false, sanitiseParams: passthrough })
            .register('addClip',    methods.addClip,    { async: false, sanitiseParams: passthrough })
            .register('trimClip',   methods.trimClip,   { async: false, sanitiseParams: passthrough })
            .register('removeClip', methods.removeClip, { async: false, sanitiseParams: passthrough })
            .register('moveClip',   methods.moveClip,   { async: false, sanitiseParams: passthrough })
            .register('splitClip',    methods.splitClip,    { async: false, sanitiseParams: passthrough })
            .register('setClipColor', methods.setClipColor, { async: false, sanitiseParams: passthrough })
            .register('setClipTransform', methods.setClipTransform, { async: false, sanitiseParams: passthrough })
            .register('setClipCrop',      methods.setClipCrop,      { async: false, sanitiseParams: passthrough })
            .register('addShapeClip',  methods.addShapeClip,  { async: false, sanitiseParams: passthrough })
            .register('addTextClip',   methods.addTextClip,   { async: false, sanitiseParams: passthrough })
            .register('setShapeProps', methods.setShapeProps, { async: false, sanitiseParams: passthrough })
            .register('setTextProps',  methods.setTextProps,  { async: false, sanitiseParams: passthrough })
            .register('copyClip',      methods.copyClip,      { async: false, sanitiseParams: passthrough })
            .register('pasteClip',     methods.pasteClip,     { async: false, sanitiseParams: passthrough })
            .register('hasClipboard',  methods.hasClipboard,  { async: false, sanitiseParams: passthrough })
            .register('renameProject', methods.renameProject, { async: false, sanitiseParams: passthrough })
            .register('getProject', methods.getProject, { async: false, sanitiseParams: passthrough })
            .register('setProject', methods.setProject, { async: false, sanitiseParams: projectSanitiser })
            .register('undo',       methods.undo,       { async: false, sanitiseParams: passthrough })
            .register('redo',       methods.redo,       { async: false, sanitiseParams: passthrough })
            .register('canUndo',    methods.canUndo,    { async: false, sanitiseParams: passthrough })
            .register('canRedo',    methods.canRedo,    { async: false, sanitiseParams: passthrough })
            .register('addTrack',        methods.addTrack,        { async: false, sanitiseParams: passthrough })
            .register('removeTrack',     methods.removeTrack,     { async: false, sanitiseParams: passthrough })
            .register('moveClipToTrack', methods.moveClipToTrack, { async: false, sanitiseParams: passthrough })
            .register('reorderTracks',   methods.reorderTracks,   { async: false, sanitiseParams: passthrough })
            .register('setTrackMuted',   methods.setTrackMuted,   { async: false, sanitiseParams: passthrough })
            .register('setTrackLocked',  methods.setTrackLocked,  { async: false, sanitiseParams: passthrough })
            .register('renameTrack',     methods.renameTrack,     { async: false, sanitiseParams: passthrough })
            .register('setTrackColor',   methods.setTrackColor,   { async: false, sanitiseParams: passthrough })
            .register('exportMp4',  methods.exportMp4,  { async: true,  sanitiseParams: passthrough })
            .register('refreshPreview', methods.refreshPreview, { async: false, sanitiseParams: passthrough })
            .register('saveProject',        methods.saveProject,        { async: false, sanitiseParams: passthrough })
            .register('loadProject',        methods.loadProject,        { async: false, sanitiseParams: passthrough })
            .register('listSavedProjects',  methods.listSavedProjects,  { async: false, sanitiseParams: passthrough })
            .register('deleteSavedProject', methods.deleteSavedProject, { async: false, sanitiseParams: passthrough })
            .register('hasUnsavedChanges',  methods.hasUnsavedChanges,  { async: false, sanitiseParams: passthrough })
            .register('autosave',           methods.autosave,           { async: false, sanitiseParams: passthrough })
            .register('getAutosave',        methods.getAutosave,        { async: false, sanitiseParams: passthrough })
            .register('discardAutosave',    methods.discardAutosave,    { async: false, sanitiseParams: passthrough })
            .register('isAutosaveNewer',    methods.isAutosaveNewer,    { async: false, sanitiseParams: passthrough });

        api.activate();

        mountShell({ host, state, api, getComposer, setComposer });

        return api;
    } catch (err) {
        emitToolError('init', err && err.message ? err.message : String(err));
        throw err;
    }
}
