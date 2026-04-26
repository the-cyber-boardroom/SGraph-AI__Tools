/** api-methods.js — bind state to SgToolApi method implementations. */

import { exportComposerProject } from '/core/video-composer/v0/v0.1/v0.1.0/sg-video-composer.js';
import { buildTrackMethods } from './api-track-methods.js';
import { probeVideoFile, probeImageFile } from './api-probe.js';

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
        const { trackId, assetId, timelineStart, inPoint, outPoint, clipId, snap, maxSnapDistance } = params;
        if (!trackId) throw badArg('trackId required');
        if (!assetId) throw badArg('assetId required');
        const id = state.addClip({
            trackId, assetId, timelineStart, inPoint, outPoint, clipId,
            snap: !!snap,
            maxSnapDistance: Number.isFinite(maxSnapDistance) ? maxSnapDistance : undefined,
        });
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

    return {
        loadAsset, removeAsset, addClip, trimClip, removeClip, moveClip, splitClip,
        setClipColor, setClipTransform, setClipCrop,
        addShapeClip, addTextClip, setShapeProps, setTextProps,
        getProject, setProject,
        undo, redo, canUndo, canRedo,
        exportMp4,
        addTrack: trackMethods.addTrack,
        removeTrack: trackMethods.removeTrack,
        moveClipToTrack: trackMethods.moveClipToTrack,
        reorderTracks: trackMethods.reorderTracks,
        setTrackMuted: trackMethods.setTrackMuted,
        setTrackLocked: trackMethods.setTrackLocked,
        renameTrack: trackMethods.renameTrack,
    };
}
