/** api-storage-methods.js — SgToolApi methods for save/load to localStorage
 *  + IndexedDB (Round-9-J).
 *
 *  Glue layer between the public API and:
 *    - `state-storage.js`        (project JSON in localStorage; lossy — no blobs)
 *    - `state-asset-storage.js`  (asset Blobs in IndexedDB; the heavy data)
 *
 *  Methods are intentionally low-level: they DO NOT prompt the user — that's
 *  the UI's responsibility (see `ui-save-load.js`).
 *
 *  Round-9-J asynchrony: every save/load/autosave/delete method is now
 *  async because IDB writes are inherently async. `getAutosave` /
 *  `isAutosaveNewer` / `hasUnsavedChanges` / `discardAutosave` /
 *  `listSavedProjects` stay synchronous — they only touch localStorage.
 */

import {
    saveProjectToStorage, loadProjectFromStorage,
    listSavedProjects, deleteSavedProject,
    writeAutosave, readAutosave, clearAutosave, autosaveIsNewer,
} from '../ui/state-storage.js';
import {
    saveAsset, loadAsset, pruneOrphanedAssets,
    computeAssetStorageUsage,
} from '../ui/state-asset-storage.js';

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }

function emitToast(message, kind = 'info') {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent('tool:toast', { detail: { message, kind } }));
}

/** Collect every asset id referenced by a wrapped project shape. */
function assetIdsInProject(wrapped) {
    const out = new Set();
    if (!wrapped || !Array.isArray(wrapped.assets)) return out;
    for (const a of wrapped.assets) if (a && a.id) out.add(a.id);
    return out;
}

/** Union of asset ids across every named save + the autosave slot. Used by
 *  `pruneOrphanedAssets` so we never evict a blob still referenced
 *  somewhere. Read-side only — no writes. */
function collectReferencedAssetIds(extraIds) {
    const ids = new Set();
    if (extraIds) for (const id of extraIds) if (id) ids.add(String(id));
    try {
        for (const e of listSavedProjects() || []) {
            if (!e || !e.slug) continue;
            const proj = loadProjectFromStorage(e.slug);
            if (proj) for (const id of assetIdsInProject(proj)) ids.add(id);
        }
    } catch (_) { /* tolerate corrupt index */ }
    try {
        const slot = readAutosave();
        if (slot && slot.project) {
            for (const id of assetIdsInProject(slot.project)) ids.add(id);
        }
    } catch (_) { /* tolerate corrupt autosave */ }
    return ids;
}

/**
 * Persist every blob currently in `state.getAssetRegistry()` to IDB. Called
 * before serialising the project to localStorage so the heavy bytes survive
 * the JSON round-trip. Tolerates per-asset failures — a single bad blob
 * shouldn't fail the whole save.
 */
async function persistBlobsToIdb(state) {
    const project = state.getProject();
    const registry = (typeof state.getAssetRegistry === 'function')
        ? state.getAssetRegistry() : null;
    if (!registry || !Array.isArray(project.assets)) return { saved: 0, failed: 0 };
    let saved = 0, failed = 0;
    for (const a of project.assets) {
        if (!a || !a.id) continue;
        const blob = registry.get(a.id);
        if (!(blob instanceof Blob)) continue;
        try {
            await saveAsset({
                id: a.id,
                blob,
                name: a.name,
                kind: a.assetType === 'image' ? 'image' : 'video',
                mimeType: a.mime || blob.type,
                width: a.width,
                height: a.height,
                duration: a.duration,
                bytes: a.bytes,
            });
            saved += 1;
        } catch (_) { failed += 1; }
    }
    return { saved, failed };
}

/**
 * Hydrate a freshly-loaded wrapped project: pull each asset's Blob from
 * IDB and attach it to the live state via `state.attachAssetBlobs`. Assets
 * still missing after hydration keep their `__missingBlob: true` flag so
 * the UI shows the placeholder.
 */
async function hydrateBlobsFromIdb(state) {
    const project = state.getProject();
    if (!Array.isArray(project.assets) || project.assets.length === 0) {
        return { hydrated: 0, missing: 0 };
    }
    const blobsById = new Map();
    let missing = 0;
    for (const a of project.assets) {
        if (!a || !a.id) continue;
        try {
            const rec = await loadAsset(a.id);
            if (rec && rec.blob instanceof Blob) blobsById.set(a.id, rec.blob);
            else missing += 1;
        } catch (_) { missing += 1; }
    }
    const r = (typeof state.attachAssetBlobs === 'function')
        ? state.attachAssetBlobs(blobsById)
        : { attached: 0 };
    return { hydrated: r.attached || 0, missing };
}

/**
 * Build the save/load methods bound to the given state container.
 *
 * @param {{state: object}} cfg
 * @returns {object} method map
 */
export function buildStorageMethods({ state }) {
    /** Save the current project. Defaults to the project's own name.
     *  Round-9-J: persists blobs to IDB before localStorage save. */
    async function saveProject(params = {}) {
        const project = state.getProject();
        const name = (params && typeof params.name === 'string' && params.name.trim())
            ? params.name.trim()
            : (project.project && project.project.name) || 'Untitled';
        try {
            // 1. Push blobs to IDB FIRST. If IDB fails, surface the error
            //    before we mutate localStorage so we don't end up with an
            //    index entry pointing at lost pixels.
            await persistBlobsToIdb(state);
            // 2. Now write the (lossy, blob-stripped) project JSON.
            const r = saveProjectToStorage(project, name);
            // Round-9-K Item 2: pass the exact JSON that hit storage so
            // the dirty-baseline hash matches on-disk bytes — not whatever
            // the live project looks like after any in-flight mutations.
            state.markSaved(r.json);
            // After a successful manual save the autosave slot is moot.
            try { clearAutosave(); } catch (_) {}
            // 3. GC: evict any IDB blobs no longer referenced by ANY
            //    saved project + autosave + the live registry.
            try {
                const live = assetIdsInProject(project);
                const referenced = collectReferencedAssetIds(live);
                await pruneOrphanedAssets(referenced);
            } catch (_) { /* GC is best-effort */ }
            emitToast(`Saved as "${r.name}"`);
            return { slug: r.slug, name: r.name, savedAt: r.savedAt, byteSize: r.byteSize };
        } catch (err) {
            if (err && err.code === 'too-large') {
                emitToast(`Project too large to save (${err.byteSize} bytes)`, 'error');
            }
            throw err;
        }
    }

    /** Load a saved project by slug. Replaces the in-memory project, then
     *  hydrates each asset's Blob from IDB. */
    async function loadProject(params = {}) {
        const slug = params && typeof params.slug === 'string' ? params.slug : null;
        if (!slug) throw badArg('slug required');
        const restored = loadProjectFromStorage(slug);
        if (!restored) throw badArg(`unknown slug: ${slug}`);
        // 1. Replace the in-memory project (clears asset registry).
        state.replaceProject(restored);
        // 2. Hydrate blobs asynchronously. The UI shows placeholders while
        //    this resolves; clips render once their blob lands.
        const h = await hydrateBlobsFromIdb(state);
        emitToast(`Loaded "${(restored.project && restored.project.name) || slug}"`);
        return { slug, ok: true, hydrated: h.hydrated, missing: h.missing };
    }

    /** List saved projects newest-first. */
    function listSaved() {
        return { projects: listSavedProjects() };
    }

    /** Delete a saved project. Round-9-J: also prunes orphaned IDB blobs. */
    async function deleteSaved(params = {}) {
        const slug = params && typeof params.slug === 'string' ? params.slug : null;
        if (!slug) throw badArg('slug required');
        deleteSavedProject(slug);
        try {
            // After deletion, recompute referenced ids across the survivors
            // (named saves + autosave + live project) and evict orphans.
            const live = assetIdsInProject(state.getProject());
            const referenced = collectReferencedAssetIds(live);
            await pruneOrphanedAssets(referenced);
        } catch (_) { /* GC is best-effort */ }
        return { slug, ok: true };
    }

    /** Cheap dirty check. Returns the boolean directly. */
    function hasUnsavedChanges() {
        return { hasUnsavedChanges: !!state.hasUnsavedChanges() };
    }

    /** Write the current project to the autosave slot.
     *  Round-9-J: also persists blobs to IDB so an autosave-restore can
     *  hydrate pixels.
     *  Round-9-K Item 2: pass the bytes that hit storage to `markSaved` so
     *  the dirty-baseline matches on-disk content even if a mutation lands
     *  while we await the IDB write. */
    async function autosave() {
        const project = state.getProject();
        try {
            await persistBlobsToIdb(state);
            const r = writeAutosave(project);
            state.markSaved(r.json); // autosave === "all current edits are persisted"
            return { ok: true, savedAt: r.savedAt };
        } catch (err) {
            return { ok: false, error: err && err.message };
        }
    }

    /** Read the autosave slot. Returns `{ savedAt, project }` or null.
     *  Note: the project's asset entries are tagged `__missingBlob` until
     *  the caller hydrates via IDB. */
    function getAutosave() { return readAutosave(); }

    /** Discard the autosave slot. */
    function discardAutosave() { clearAutosave(); return { ok: true }; }

    /** Compare autosave timestamp against named-saves index. */
    function isAutosaveNewer(params = {}) {
        const ts = params && Number.isFinite(params.savedAt) ? params.savedAt : 0;
        return { newer: autosaveIsNewer(ts) };
    }

    /** Round-9-J: hydrate blobs for the CURRENT in-memory project. Used by
     *  the autosave-restore path (where setProject() injects the project,
     *  but blobs still live in IDB). Returns `{ hydrated, missing }`. */
    async function hydrateAssets() {
        return await hydrateBlobsFromIdb(state);
    }

    /** Round-9-J: report storage usage across IDB + the active localStorage
     *  project JSON. Cheap enough for a live "Storage: …" readout. */
    async function getStorageUsage() {
        const idb = await computeAssetStorageUsage();
        // localStorage usage: sum byteSize across the saved-projects index
        // (the project JSON itself is small without blobs).
        let lsBytes = 0;
        try {
            for (const e of listSavedProjects() || []) {
                if (e && Number.isFinite(e.byteSize)) lsBytes += e.byteSize;
            }
        } catch (_) {}
        const totalBytes = (idb.totalBytes || 0) + lsBytes;
        return {
            totalBytes,
            assetBytes: idb.totalBytes || 0,
            assetCount: idb.count || 0,
            projectJsonBytes: lsBytes,
        };
    }

    return {
        saveProject, loadProject, listSavedProjects: listSaved, deleteSavedProject: deleteSaved,
        hasUnsavedChanges, autosave, getAutosave, discardAutosave, isAutosaveNewer,
        hydrateAssets, getStorageUsage,
    };
}
