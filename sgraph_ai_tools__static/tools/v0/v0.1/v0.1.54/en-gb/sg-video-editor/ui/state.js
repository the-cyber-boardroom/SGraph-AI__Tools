/** state.js — pure project state container; no DOM. */

import { getVideoTracks } from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { splitClipOp } from './state-split.js';
import {
    addAssetOp, addClipOp, trimClipOp, moveClipOp, removeClipOp, setClipColorOp,
} from './state-clip-ops.js';
import {
    addTrackOp, removeTrackOp, moveClipToTrackOp, reorderTracksOp,
} from './state-track-ops.js';
import { createHistory } from './state-history.js';
import {
    createInitialProject, deepClone, validateWrapped, genId,
} from './state-init.js';

export { createInitialProject };

/**
 * Create a state container with mutation helpers; emits 'change' on every
 * mutation. Undo/redo uses a 50-entry snapshot stack per side. The
 * AssetRegistry (Map<assetId, Blob>) is shared across snapshots — undoing an
 * addAsset leaves the blob behind but the project no longer references it.
 */
export function createState(initialProject) {
    let project = validateWrapped(deepClone(initialProject));
    const assetRegistry = new Map();
    const target = new EventTarget();
    const history = createHistory({ maxEntries: 50 });

    function emit() {
        target.dispatchEvent(new CustomEvent('change', { detail: { project: deepClone(project) } }));
    }
    function withOp(op) { project.operations.push({ ...op, t: Date.now() }); }
    function snapshot() { history.pushSnapshot(project); }

    return {
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),

        getProject() { return deepClone(project); },

        setProject(next) {
            snapshot();
            project = validateWrapped(deepClone(next));
            emit();
        },

        getAssetRegistry() { return assetRegistry; },

        addAsset(params) {
            if (!(params && params.blob instanceof Blob)) {
                throw Object.assign(new Error('blob must be a Blob'), { code: 'invalid-arg' });
            }
            snapshot();
            const { assetId, assetType } = addAssetOp(project, params);
            assetRegistry.set(assetId, params.blob);
            withOp({ op: 'addAsset', assetId, assetType });
            emit();
            return assetId;
        },

        addClip(params) {
            const snap = deepClone(project);
            const id = addClipOp(project, params, genId);
            history.pushSnapshot(snap);
            withOp({ op: 'addClip', clipId: id, trackId: params.trackId, assetId: params.assetId });
            emit();
            return id;
        },

        removeClip(params) {
            snapshot();
            removeClipOp(project, params);
            withOp({ op: 'removeClip', clipId: params.clipId });
            emit();
        },

        trimClip(params) {
            const snap = deepClone(project);
            const { inPoint, outPoint } = trimClipOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'trimClip', clipId: params.clipId, inPoint, outPoint });
            emit();
        },

        moveClip(params) {
            const snap = deepClone(project);
            const { timelineStart } = moveClipOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'moveClip', clipId: params.clipId, timelineStart });
            emit();
        },

        splitClip({ clipId, atTime }) {
            snapshot();
            const r = splitClipOp(project, { clipId, atTime }, genId);
            withOp({ op: 'splitClip', clipId, atTime: r.atTime, newClipId: r.newClipId });
            emit();
            return { newClipId: r.newClipId };
        },

        setClipColor(params) {
            snapshot();
            const { clipId, color } = setClipColorOp(project, params);
            withOp({ op: 'setClipColor', clipId, color });
            emit();
        },

        addTrack(params = {}) {
            const snap = deepClone(project);
            const { trackId } = addTrackOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'addTrack', trackId, kind: params.kind || 'video' });
            emit();
            return { trackId };
        },

        removeTrack(params) {
            const snap = deepClone(project);
            const { trackId } = removeTrackOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'removeTrack', trackId });
            emit();
            return { trackId };
        },

        moveClipToTrack(params) {
            const snap = deepClone(project);
            const r = moveClipToTrackOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'moveClipToTrack', clipId: r.clipId, fromTrackId: r.fromTrackId, toTrackId: r.toTrackId });
            emit();
            return r;
        },

        reorderTracks(params) {
            const snap = deepClone(project);
            const r = reorderTracksOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'reorderTracks', trackIds: r.trackIds });
            emit();
            return r;
        },

        undo() {
            const next = history.undo(project);
            if (!next) return false;
            project = next; emit(); return true;
        },

        redo() {
            const next = history.redo(project);
            if (!next) return false;
            project = next; emit(); return true;
        },

        canUndo() { return history.canUndo(); },
        canRedo() { return history.canRedo(); },

        toComposerProject() {
            return {
                width: project.project.width,
                height: project.project.height,
                fps: project.project.fps,
                tracks: deepClone(project.tracks),
                assets: deepClone(project.assets),
            };
        },
    };
}

export { getVideoTracks };
