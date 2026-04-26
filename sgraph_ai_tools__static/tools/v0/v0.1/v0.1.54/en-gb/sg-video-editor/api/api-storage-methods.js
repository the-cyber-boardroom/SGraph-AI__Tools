/** api-storage-methods.js — SgToolApi methods for save/load to localStorage.
 *
 * Pure glue layer between the public API and `state-storage.js`. Methods are
 * intentionally low-level: they DO NOT prompt the user — that's the UI's
 * responsibility (see `ui-save-load.js`).
 */

import {
    saveProjectToStorage, loadProjectFromStorage,
    listSavedProjects, deleteSavedProject,
    writeAutosave, readAutosave, clearAutosave, autosaveIsNewer,
} from '../ui/state-storage.js';

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }

function emitToast(message, kind = 'info') {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent('tool:toast', { detail: { message, kind } }));
}

/**
 * Build the save/load methods bound to the given state container.
 *
 * @param {{state: object}} cfg
 * @returns {object} method map
 */
export function buildStorageMethods({ state }) {
    /** Save the current project. Defaults to the project's own name. */
    function saveProject(params = {}) {
        const project = state.getProject();
        const name = (params && typeof params.name === 'string' && params.name.trim())
            ? params.name.trim()
            : (project.project && project.project.name) || 'Untitled';
        try {
            const r = saveProjectToStorage(project, name);
            state.markSaved();
            // After a successful manual save, the autosave slot is moot.
            try { clearAutosave(); } catch (_) {}
            emitToast(`Saved as "${r.name}"`);
            return { slug: r.slug, name: r.name, savedAt: r.savedAt, byteSize: r.byteSize };
        } catch (err) {
            if (err && err.code === 'too-large') {
                emitToast(`Project too large to save (${err.byteSize} bytes)`, 'error');
            }
            throw err;
        }
    }

    /** Load a saved project by slug. Replaces the in-memory project. */
    function loadProject(params = {}) {
        const slug = params && typeof params.slug === 'string' ? params.slug : null;
        if (!slug) throw badArg('slug required');
        const restored = loadProjectFromStorage(slug);
        if (!restored) throw badArg(`unknown slug: ${slug}`);
        state.replaceProject(restored);
        emitToast(`Loaded "${(restored.project && restored.project.name) || slug}"`);
        return { slug, ok: true };
    }

    /** List saved projects newest-first. */
    function listSaved() {
        return { projects: listSavedProjects() };
    }

    /** Delete a saved project. */
    function deleteSaved(params = {}) {
        const slug = params && typeof params.slug === 'string' ? params.slug : null;
        if (!slug) throw badArg('slug required');
        deleteSavedProject(slug);
        return { slug, ok: true };
    }

    /** Cheap dirty check. Returns the boolean directly. */
    function hasUnsavedChanges() {
        return { hasUnsavedChanges: !!state.hasUnsavedChanges() };
    }

    /** Write the current project to the autosave slot. */
    function autosave() {
        const project = state.getProject();
        try {
            writeAutosave(project);
            state.markSaved(); // autosave === "all current edits are persisted"
            return { ok: true, savedAt: Date.now() };
        } catch (err) {
            return { ok: false, error: err && err.message };
        }
    }

    /** Read the autosave slot. Returns `{ savedAt, project }` or null. */
    function getAutosave() { return readAutosave(); }

    /** Discard the autosave slot. */
    function discardAutosave() { clearAutosave(); return { ok: true }; }

    /** Compare autosave timestamp against named-saves index. */
    function isAutosaveNewer(params = {}) {
        const ts = params && Number.isFinite(params.savedAt) ? params.savedAt : 0;
        return { newer: autosaveIsNewer(ts) };
    }

    return {
        saveProject, loadProject, listSavedProjects: listSaved, deleteSavedProject: deleteSaved,
        hasUnsavedChanges, autosave, getAutosave, discardAutosave, isAutosaveNewer,
    };
}
