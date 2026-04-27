/** state.js — pure project state container; no DOM. */

import { getVideoTracks } from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { splitClipOp } from './state-split.js';
import {
    addAssetOp, addClipOp, trimClipOp, moveClipOp, removeClipOp,
    setClipColorOp, setClipTransformOp, setClipCropOp,
    addShapeClipOp, addTextClipOp, setShapePropsOp, setTextPropsOp,
    removeAssetOp, copyClipOp, pasteClipOp,
} from './state-clip-ops.js';
import {
    addTrackOp, removeTrackOp, moveClipToTrackOp, reorderTracksOp, setTrackMutedOp,
    setTrackLockedOp, renameTrackOp,
} from './state-track-ops.js';
import { renameProjectOp } from './state-project-ops.js';
import { createHistory } from './state-history.js';
import { hashProjectJson, stripAssetsForStorage } from './state-storage.js';
import {
    createInitialProject, deepClone, validateWrapped, genId,
} from './state-init.js';

export { createInitialProject };

/** Create a state container with mutation helpers; emits 'change' per mutation.
 *  Undo/redo uses a 50-entry snapshot stack per side. The AssetRegistry
 *  (Map<assetId, Blob>) is shared across snapshots. */
export function createState(initialProject) {
    let project = validateWrapped(deepClone(initialProject));
    const assetRegistry = new Map();
    const target = new EventTarget();
    const history = createHistory({ maxEntries: 50 });
    /** Clipboard: in-memory only, holds the last copyClip payload. */
    let clipboard = null;
    /** Hash of the project JSON at the most recent successful save (manual or
     *  autosave). When `null`, treat the project as unsaved. */
    let lastSavedHash = null;
    /** Timestamp of the most recent mutation — used by the beforeunload guard
     *  to distinguish "autosave hasn't flushed yet" from "no unsaved work". */
    let lastMutationAt = 0;

    function computeCurrentHash() {
        return hashProjectJson(JSON.stringify(stripAssetsForStorage(project)));
    }

    function emit(extra) {
        const detail = { project: deepClone(project) };
        if (extra && extra.transient) detail.transient = true;
        else lastMutationAt = Date.now();
        target.dispatchEvent(new CustomEvent('change', { detail }));
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
        removeAsset(params) {
            snapshot();
            const r = removeAssetOp(project, params);
            assetRegistry.delete(r.assetId);
            withOp({ op: 'removeAsset', assetId: r.assetId });
            emit();
            return r;
        },

        addClip(params) {
            const snap = deepClone(project);
            const id = addClipOp(project, params, genId);
            history.pushSnapshot(snap);
            withOp({ op: 'addClip', clipId: id, trackId: params.trackId, assetId: params.assetId });
            emit(); return id;
        },
        addShapeClip(params) {
            const snap = deepClone(project);
            const id = addShapeClipOp(project, params, genId);
            history.pushSnapshot(snap);
            withOp({ op: 'addShapeClip', clipId: id, trackId: params.trackId });
            emit(); return id;
        },
        addTextClip(params) {
            const snap = deepClone(project);
            const id = addTextClipOp(project, params, genId);
            history.pushSnapshot(snap);
            withOp({ op: 'addTextClip', clipId: id, trackId: params.trackId });
            emit(); return id;
        },
        setShapeProps(params) {
            const transient = !!(params && params.transient);
            if (!transient) snapshot();
            const r = setShapePropsOp(project, params);
            if (!transient) withOp({
                op: 'setShapeProps', clipId: r.clipId,
                shape: r.shape, transform: r.transform,
            });
            emit(transient ? { transient: true } : null);
            return r;
        },
        setTextProps(params) {
            const transient = !!(params && params.transient);
            if (!transient) snapshot();
            const r = setTextPropsOp(project, params);
            if (!transient) withOp({
                op: 'setTextProps', clipId: r.clipId,
                text: r.text, transform: r.transform,
            });
            emit(transient ? { transient: true } : null);
            return r;
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
        setClipTransform(params) {
            const transient = !!(params && params.transient);
            if (!transient) snapshot();
            const r = setClipTransformOp(project, params);
            if (!transient) withOp({ op: 'setClipTransform', clipId: r.clipId, transform: r.transform });
            emit(transient ? { transient: true } : null);
            return r;
        },
        setClipCrop(params) {
            const transient = !!(params && params.transient);
            if (!transient) snapshot();
            const r = setClipCropOp(project, params);
            if (!transient) withOp({ op: 'setClipCrop', clipId: r.clipId, crop: r.crop });
            emit(transient ? { transient: true } : null);
            return r;
        },

        addTrack(params = {}) {
            const snap = deepClone(project);
            const { trackId } = addTrackOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'addTrack', trackId, kind: params.kind || 'video' });
            emit(); return { trackId };
        },
        removeTrack(params) {
            const snap = deepClone(project);
            const { trackId } = removeTrackOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'removeTrack', trackId });
            emit(); return { trackId };
        },
        moveClipToTrack(params) {
            const snap = deepClone(project);
            const r = moveClipToTrackOp(project, params);
            history.pushSnapshot(snap);
            withOp({
                op: 'moveClipToTrack',
                clipId: r.clipId, fromTrackId: r.fromTrackId, toTrackId: r.toTrackId,
                timelineStart: r.timelineStart,
            });
            emit(); return r;
        },
        setTrackMuted(params) {
            const snap = deepClone(project);
            const r = setTrackMutedOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'setTrackMuted', trackId: r.trackId, muted: r.muted });
            emit(); return r;
        },
        setTrackLocked(params) {
            const snap = deepClone(project);
            const r = setTrackLockedOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'setTrackLocked', trackId: r.trackId, locked: r.locked });
            emit(); return r;
        },
        renameTrack(params) {
            const snap = deepClone(project);
            const r = renameTrackOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'renameTrack', trackId: r.trackId, name: r.name });
            emit(); return r;
        },
        renameClip(params) {
            const { clipId, name } = params;
            for (const t of project.tracks) {
                const clip = t.clips && t.clips.find(c => c.id === clipId);
                if (!clip) continue;
                const snap = deepClone(project);
                if (name) clip.name = name; else delete clip.name;
                history.pushSnapshot(snap);
                withOp({ op: 'renameClip', clipId, name: name || '' });
                emit(); return { clipId, name: name || '' };
            }
            throw Object.assign(new Error('unknown clipId'), { code: 'not-found' });
        },
        renameProject(params) {
            const snap = deepClone(project);
            const r = renameProjectOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'renameProject', name: r.name });
            emit(); return r;
        },
        copyClip(params) {
            const payload = copyClipOp(project, params);
            // Defensive deep clone so mutations to project after copy don't bleed.
            clipboard = deepClone(payload);
            // Notify listeners so the toolbar can flip Paste from disabled→enabled.
            target.dispatchEvent(new CustomEvent('clipboard', {
                detail: { hasClipboard: !!clipboard },
            }));
            return { hasClipboard: true };
        },
        pasteClip(params) {
            if (!clipboard) return null;
            const snap = deepClone(project);
            const r = pasteClipOp(project, { ...params, payload: clipboard }, genId);
            history.pushSnapshot(snap);
            withOp({
                op: 'pasteClip',
                clipId: r.clipId, trackId: r.trackId, timelineStart: r.timelineStart,
            });
            emit();
            return r;
        },
        getClipboard() { return clipboard ? deepClone(clipboard) : null; },
        hasClipboard() { return !!clipboard; },
        clearClipboard() {
            const had = !!clipboard;
            clipboard = null;
            if (had) {
                target.dispatchEvent(new CustomEvent('clipboard', {
                    detail: { hasClipboard: false },
                }));
            }
        },
        reorderTracks(params) {
            const snap = deepClone(project);
            const r = reorderTracksOp(project, params);
            history.pushSnapshot(snap);
            withOp({ op: 'reorderTracks', trackIds: r.trackIds });
            emit(); return r;
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

        /** Replace the in-memory project with a restored one (e.g. from
         *  localStorage). Resets the clean / dirty hash to `next`'s shape so
         *  the just-loaded project is considered fully saved. Pushes a
         *  history snapshot so the user can undo the restore. Emits
         *  `project:replaced` followed by a `change`.
         *
         *  Round-9-J: clears the in-memory asset blob registry too — the
         *  restored project's assetIds may collide with stale ids from the
         *  previous session, so we start clean and let the IDB-hydration
         *  pass refill the registry. The `__missingBlob` flag on each asset
         *  keeps the UI honest in the brief window before hydration lands. */
        replaceProject(next) {
            const snap = deepClone(project);
            project = validateWrapped(deepClone(next));
            history.pushSnapshot(snap);
            assetRegistry.clear();
            // Mark as clean — caller already loaded from storage; the JSON
            // round-trip is the canonical "saved" state.
            lastSavedHash = computeCurrentHash();
            target.dispatchEvent(new CustomEvent('project:replaced', {
                detail: { project: deepClone(project) },
            }));
            emit();
        },

        /** Round-9-J: attach hydrated Blobs (loaded from IDB) into the
         *  in-memory asset registry, AND clear the `__missingBlob` flag on
         *  every matched asset entry. Emits a single non-transient `change`
         *  so the asset panel + composer rebuild against the full pixels.
         *
         *  Pure no-op for unknown ids — callers don't need to filter.
         *
         *  @param {Map<string, Blob>|Record<string, Blob>} blobsById
         *  @returns {{attached: number}} number of assets that gained pixels.
         */
        attachAssetBlobs(blobsById) {
            if (!blobsById) return { attached: 0 };
            const get = blobsById instanceof Map
                ? (id) => blobsById.get(id)
                : (id) => blobsById[id];
            let attached = 0;
            for (const a of project.assets) {
                if (!a || !a.id) continue;
                const blob = get(a.id);
                if (blob instanceof Blob) {
                    assetRegistry.set(a.id, blob);
                    if (a.__missingBlob) delete a.__missingBlob;
                    attached += 1;
                }
            }
            if (attached > 0) {
                lastSavedHash = computeCurrentHash();
                emit();
            }
            return { attached };
        },

        /** Stamp the saved-baseline for `hasUnsavedChanges()`. Called after
         *  every successful save (manual or autosave).
         *
         *  Round-9-K Item 2: accepts an optional `savedJson` (the exact JSON
         *  that was written to storage) so the baseline hash matches the
         *  on-disk bytes — not "the project as it stood at the moment of
         *  this call". Without that param a mutation that lands between the
         *  saver's snapshot and `markSaved()` would falsely become the new
         *  baseline (race: save snapshots t=0, await IDB, user types, save
         *  resolves, markSaved hashes t=1 → "clean" when the on-disk bytes
         *  describe t=0).
         */
        markSaved(savedJson) {
            if (typeof savedJson === 'string' && savedJson.length > 0) {
                lastSavedHash = hashProjectJson(savedJson);
            } else {
                lastSavedHash = computeCurrentHash();
            }
        },

        /** Wipe the saved-baseline; subsequent `hasUnsavedChanges()` always
         *  returns true. Used after a manual edit when no save has happened. */
        markDirty() {
            lastSavedHash = null;
        },

        /** Cheap dirty check based on stored project hash (length + first 256
         *  chars of JSON). Returns false on a fresh-empty project, true after
         *  any mutation that hasn't been saved. */
        hasUnsavedChanges() {
            if (lastSavedHash == null) {
                // Pristine baseline: an empty default project counts as
                // "no unsaved work" until the user makes a change.
                if (project.assets.length === 0
                    && project.tracks.every(t => !t || (t.clips && t.clips.length === 0))
                    && (project.project.name || 'Untitled') === 'Untitled') {
                    return false;
                }
                return true;
            }
            return computeCurrentHash() !== lastSavedHash;
        },

        /** Timestamp of the last non-transient mutation (or 0 if none). */
        getLastMutationAt() { return lastMutationAt; },

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
