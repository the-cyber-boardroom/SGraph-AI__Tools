/** api-methods.js — bind state to SgToolApi method implementations. */

import { exportComposerProject } from '/core/video-composer/v0/v0.1/v0.1.0/sg-video-composer.js';
import { buildTrackMethods } from './api-track-methods.js';
import { buildStorageMethods } from './api-storage-methods.js';
import { probeVideoFile, probeImageFile } from './api-probe.js';
import {
    isMemoryProbeEnabled, debugLog, debugLogThrottled, readPerfMemory,
} from '../ui/debug/memory-probe.js';

/** Round-9-M: log a one-line "[sgve]" summary line when the probe is on. */
function logHeap(tag) {
    if (!isMemoryProbeEnabled()) return;
    const m = readPerfMemory();
    if (!m) return;
    debugLogThrottled('heap', 5000,
        `${tag} heap used=${(m.usedJSHeapBytes / (1024 * 1024)).toFixed(1)}MB`,
        `total=${(m.totalJSHeapBytes / (1024 * 1024)).toFixed(1)}MB`,
        `limit=${(m.jsHeapLimitBytes / (1024 * 1024)).toFixed(1)}MB`);
}

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }
function unsupportedMime(mime) {
    return Object.assign(new Error(`unsupported mime: ${mime || 'unknown'}`), { code: 'unsupported-mime' });
}

/** Build the 8 API methods bound to the given state container. */
export function buildApiMethods({ state, getComposer, setComposer, hostEl }) {
    void setComposer; void hostEl;

    /** Force the preview canvas to repaint at the current playhead. Useful as
     *  an escape hatch when the on-canvas image gets out of sync with state
     *  (the composer's frame cache normally invalidates on project change,
     *  but this gives callers a manual flush). No-op if no composer attached. */
    function refreshPreview() {
        const c = getComposer && getComposer();
        if (c && typeof c.refresh === 'function') c.refresh();
        return { ok: !!c };
    }

    async function loadAsset(params = {}) {
        const file = params && params.file;
        if (!(file instanceof Blob)) throw badArg('file must be a File/Blob');
        const mime = file.type || '';
        const assetId = `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        if (mime.startsWith('image/')) {
            const { width, height } = await probeImageFile(file);
            state.addAsset({
                assetId, name: file.name || 'asset', mime,
                width, height, bytes: file.size, blob: file, assetType: 'image',
            });
            // Round-9-M observability: large images are also a memory risk.
            debugLog(`asset added (image): id=${assetId} name=${file.name || ''}`,
                `size=${file.size}B`, `mime=${mime}`, `dims=${width}×${height}`);
            logHeap('asset-added');
            return { assetId, assetType: 'image', width, height, bytes: file.size };
        }
        if (mime.startsWith('video/') || !mime) {
            const { duration, width, height } = await probeVideoFile(file);
            state.addAsset({
                assetId, name: file.name || 'asset', mime: mime || 'video/mp4',
                duration, width, height, bytes: file.size, blob: file, assetType: 'video',
            });
            // Round-9-M observability — these are the numbers we need to
            // recognise the high-resolution-screen-recording case.
            debugLog(`asset added (video): id=${assetId} name=${file.name || ''}`,
                `size=${file.size}B`, `mime=${mime}`,
                `dims=${width}×${height}`, `duration=${duration ? duration.toFixed(2) : '?'}s`);
            logHeap('asset-added');
            return { assetId, assetType: 'video', duration, width, height, bytes: file.size };
        }
        throw unsupportedMime(mime);
    }

    function addClip(params = {}) {
        const { trackId, assetId, timelineStart, inPoint, outPoint, clipId, snap, maxSnapDistance } = params;
        if (!trackId) throw badArg('trackId required');
        if (!assetId) throw badArg('assetId required');
        const id = state.addClip({
            trackId, assetId, timelineStart, inPoint, outPoint, clipId,
            snap: !!snap,
            maxSnapDistance: Number.isFinite(maxSnapDistance) ? maxSnapDistance : undefined,
        });
        // Round-9-M observability: log the clip-add hop. The expensive bit
        // happens 100ms later when handleChange triggers rebuildComposer
        // (which logs its own [sgve] line).
        if (isMemoryProbeEnabled()) {
            const project = state.getProject();
            const totalClips = (project.tracks || []).reduce((s, t) =>
                s + ((t && Array.isArray(t.clips)) ? t.clips.length : 0), 0);
            debugLog(`clip added: id=${id} trackId=${trackId} assetId=${assetId}`,
                `totalClips=${totalClips} videosInDom=${document.querySelectorAll('video').length}`);
            logHeap('clip-added');
        }
        return { clipId: id };
    }

    function addShapeClip(params = {}) {
        const { trackId, timelineStart, duration, clipId, shape, snap, maxSnapDistance } = params;
        if (!trackId) throw badArg('trackId required');
        const id = state.addShapeClip({
            trackId, timelineStart, duration, clipId, shape,
            snap: !!snap,
            maxSnapDistance: Number.isFinite(maxSnapDistance) ? maxSnapDistance : undefined,
        });
        return { clipId: id };
    }

    function addTextClip(params = {}) {
        const { trackId, timelineStart, duration, clipId, text, snap, maxSnapDistance } = params;
        if (!trackId) throw badArg('trackId required');
        const id = state.addTextClip({
            trackId, timelineStart, duration, clipId, text,
            snap: !!snap,
            maxSnapDistance: Number.isFinite(maxSnapDistance) ? maxSnapDistance : undefined,
        });
        return { clipId: id };
    }

    function removeAsset(params = {}) {
        const { assetId } = params;
        if (!assetId) throw badArg('assetId required');
        const r = state.removeAsset({ assetId });
        return { assetId: r.assetId };
    }

    function setShapeProps(params = {}) {
        const { clipId, shape, transform, transient } = params;
        if (!clipId) throw badArg('clipId required');
        const r = state.setShapeProps({ clipId, shape, transform, transient: !!transient });
        return { clipId: r.clipId, shape: r.shape, transform: r.transform };
    }

    function setTextProps(params = {}) {
        const { clipId, text, transform, transient } = params;
        if (!clipId) throw badArg('clipId required');
        const r = state.setTextProps({ clipId, text, transform, transient: !!transient });
        return { clipId: r.clipId, text: r.text, transform: r.transform };
    }

    function trimClip(params = {}) {
        const { clipId, inPoint, outPoint } = params;
        if (!clipId) throw badArg('clipId required');
        state.trimClip({ clipId, inPoint, outPoint });
        return { clipId };
    }

    function removeClip(params = {}) {
        const { clipId } = params;
        if (!clipId) throw badArg('clipId required');
        state.removeClip({ clipId });
        if (isMemoryProbeEnabled()) {
            const project = state.getProject();
            const totalClips = (project.tracks || []).reduce((s, t) =>
                s + ((t && Array.isArray(t.clips)) ? t.clips.length : 0), 0);
            debugLog(`clip removed: id=${clipId} totalClips=${totalClips}`);
        }
        return { clipId };
    }

    function moveClip(params = {}) {
        const { clipId, timelineStart, snap, maxSnapDistance } = params;
        if (!clipId) throw badArg('clipId required');
        if (!Number.isFinite(timelineStart)) throw badArg('timelineStart must be a number');
        state.moveClip({
            clipId, timelineStart,
            snap: !!snap,
            maxSnapDistance: Number.isFinite(maxSnapDistance) ? maxSnapDistance : undefined,
        });
        return { clipId, timelineStart };
    }

    function splitClip(params = {}) {
        const { clipId, atTime } = params;
        if (!clipId) throw badArg('clipId required');
        if (!Number.isFinite(atTime)) throw badArg('atTime must be a number');
        const { newClipId } = state.splitClip({ clipId, atTime });
        return { newClipId };
    }

    function setClipColor(params = {}) {
        const { clipId, color } = params;
        if (!clipId) throw badArg('clipId required');
        state.setClipColor({ clipId, color: color == null ? null : color });
        return { clipId, color: color == null ? null : color };
    }

    function setClipTransform(params = {}) {
        const { clipId, transform, transient } = params;
        if (!clipId) throw badArg('clipId required');
        const r = state.setClipTransform({
            clipId,
            transform: transform == null ? null : transform,
            transient: !!transient,
        });
        return { clipId: r.clipId, transform: r.transform };
    }

    function setClipCrop(params = {}) {
        const { clipId, crop, transient } = params;
        if (!clipId) throw badArg('clipId required');
        const r = state.setClipCrop({
            clipId,
            crop: crop == null ? null : crop,
            transient: !!transient,
        });
        return { clipId: r.clipId, crop: r.crop };
    }

    function copyClip(params = {}) {
        const { clipId } = params;
        if (!clipId) throw badArg('clipId required');
        const r = state.copyClip({ clipId });
        return { hasClipboard: !!(r && r.hasClipboard) };
    }

    function pasteClip(params = {}) {
        const { targetTrackId, timelineStart, snap, maxSnapDistance } = params || {};
        if (!state.hasClipboard()) throw badArg('clipboard is empty');
        if (!targetTrackId) throw badArg('targetTrackId required');
        if (!Number.isFinite(timelineStart)) throw badArg('timelineStart must be a finite number');
        const r = state.pasteClip({
            targetTrackId, timelineStart,
            snap: !!snap,
            maxSnapDistance: Number.isFinite(maxSnapDistance) ? maxSnapDistance : undefined,
        });
        return r ? { clipId: r.clipId, trackId: r.trackId, timelineStart: r.timelineStart } : null;
    }

    function hasClipboard() { return { hasClipboard: state.hasClipboard() }; }

    function renameProject(params = {}) {
        const { name } = params || {};
        if (typeof name !== 'string') throw badArg('name must be a string');
        const r = state.renameProject({ name });
        return { name: r.name };
    }

    function getProject() { return state.getProject(); }

    function setProject(params = {}) {
        if (!params || !params.project) throw badArg('project required');
        state.setProject(params.project);
        return { ok: true };
    }

    function undo() {
        const did = state.undo();
        return { undid: did, canUndo: state.canUndo(), canRedo: state.canRedo() };
    }

    function redo() {
        const did = state.redo();
        return { redid: did, canUndo: state.canUndo(), canRedo: state.canRedo() };
    }

    function canUndo() { return { canUndo: state.canUndo() }; }
    function canRedo() { return { canRedo: state.canRedo() }; }

    async function exportMp4(params = {}) {
        const { preferMp4 = true, bitsPerSecond, onProgress } = params || {};
        const composerProject = state.toComposerProject();
        const assets = state.getAssetRegistry();
        const fps = composerProject.fps;
        const t0 = Date.now();
        const blob = await exportComposerProject({
            project: composerProject,
            assets,
            fps,
            preferMp4,
            bitsPerSecond,
            onProgress,
        });
        return {
            blob,
            mimeType: blob.type || 'video/mp4',
            sizeBytes: blob.size,
            durationMs: Date.now() - t0,
        };
    }

    const trackMethods = buildTrackMethods({ state });
    const storageMethods = buildStorageMethods({ state });

    return {
        loadAsset, removeAsset, addClip, trimClip, removeClip, moveClip, splitClip,
        setClipColor, setClipTransform, setClipCrop,
        addShapeClip, addTextClip, setShapeProps, setTextProps,
        copyClip, pasteClip, hasClipboard,
        renameProject,
        getProject, setProject,
        undo, redo, canUndo, canRedo,
        exportMp4, refreshPreview,
        addTrack: trackMethods.addTrack,
        removeTrack: trackMethods.removeTrack,
        moveClipToTrack: trackMethods.moveClipToTrack,
        reorderTracks: trackMethods.reorderTracks,
        setTrackMuted: trackMethods.setTrackMuted,
        setTrackLocked: trackMethods.setTrackLocked,
        renameTrack: trackMethods.renameTrack,
        setTrackColor: trackMethods.setTrackColor,
        saveProject:        storageMethods.saveProject,
        loadProject:        storageMethods.loadProject,
        listSavedProjects:  storageMethods.listSavedProjects,
        deleteSavedProject: storageMethods.deleteSavedProject,
        hasUnsavedChanges:  storageMethods.hasUnsavedChanges,
        autosave:           storageMethods.autosave,
        getAutosave:        storageMethods.getAutosave,
        discardAutosave:    storageMethods.discardAutosave,
        isAutosaveNewer:    storageMethods.isAutosaveNewer,
        // Round-9-J — IDB blob storage helpers.
        hydrateAssets:      storageMethods.hydrateAssets,
        getStorageUsage:    storageMethods.getStorageUsage,
    };
}
