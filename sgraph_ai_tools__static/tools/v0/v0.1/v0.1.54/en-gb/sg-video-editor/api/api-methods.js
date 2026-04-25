/** api-methods.js — bind state to SgToolApi method implementations. */

import { exportComposerProject } from '/core/video-composer/v0/v0.1/v0.1.0/sg-video-composer.js';

/** Probe a video File for duration/dimensions via a hidden <video> element. */
async function probeVideoFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        const cleanup = () => { URL.revokeObjectURL(url); v.src = ''; };
        const onLoaded = () => {
            const out = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
            cleanup();
            resolve(out);
        };
        const onError = () => { cleanup(); reject(new Error('failed to load video metadata')); };
        v.addEventListener('loadedmetadata', onLoaded, { once: true });
        v.addEventListener('error', onError, { once: true });
        v.src = url;
    });
}

/** Probe an image File for naturalWidth/naturalHeight via a hidden <img>. */
async function probeImageFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        const cleanup = () => { try { URL.revokeObjectURL(url); } catch (_) {} };
        img.onload = () => {
            const out = { width: img.naturalWidth, height: img.naturalHeight };
            cleanup();
            resolve(out);
        };
        img.onerror = () => { cleanup(); reject(new Error('failed to load image metadata')); };
        img.src = url;
    });
}

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }
function unsupportedMime(mime) {
    return Object.assign(new Error(`unsupported mime: ${mime || 'unknown'}`), { code: 'unsupported-mime' });
}

/** Build the 8 API methods bound to the given state container. */
export function buildApiMethods({ state, getComposer, setComposer, hostEl }) {
    void getComposer; void setComposer; void hostEl;

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
            return { assetId, assetType: 'image', width, height, bytes: file.size };
        }
        if (mime.startsWith('video/') || !mime) {
            const { duration, width, height } = await probeVideoFile(file);
            state.addAsset({
                assetId, name: file.name || 'asset', mime: mime || 'video/mp4',
                duration, width, height, bytes: file.size, blob: file, assetType: 'video',
            });
            return { assetId, assetType: 'video', duration, width, height, bytes: file.size };
        }
        throw unsupportedMime(mime);
    }

    function addClip(params = {}) {
        const { trackId, assetId, timelineStart, inPoint, outPoint, clipId } = params;
        if (!trackId) throw badArg('trackId required');
        if (!assetId) throw badArg('assetId required');
        const id = state.addClip({ trackId, assetId, timelineStart, inPoint, outPoint, clipId });
        return { clipId: id };
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
        return { clipId };
    }

    function moveClip(params = {}) {
        const { clipId, timelineStart } = params;
        if (!clipId) throw badArg('clipId required');
        if (!Number.isFinite(timelineStart)) throw badArg('timelineStart must be a number');
        state.moveClip({ clipId, timelineStart });
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

    return {
        loadAsset, addClip, trimClip, removeClip, moveClip, splitClip,
        setClipColor, getProject, setProject,
        undo, redo, canUndo, canRedo,
        exportMp4,
    };
}
