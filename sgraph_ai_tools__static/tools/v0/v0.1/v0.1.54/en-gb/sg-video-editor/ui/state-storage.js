/** state-storage.js — localStorage persistence for sg-video-editor.
 *
 * Pure functions over `window.localStorage` (or a polyfilled global). NO DOM,
 * NO direct state references — callers pass the wrapped project in / out.
 *
 * Storage keys:
 *  - `sgve:projects-index`    — JSON array of `{slug, name, savedAt, byteSize}`
 *  - `sgve:project:<slug>`    — JSON-stringified wrapped project
 *  - `sgve:autosave:current`  — JSON wrapper { savedAt, project } for autosave
 *
 * The project model serialises lossily: asset *metadata* (id/name/kind/
 * duration/width/height/mime/bytes) is preserved, but Blob refs are dropped.
 * On restore, assets without a re-uploaded blob are flagged
 * `__missingBlob: true` so the asset panel can show a "missing — re-upload"
 * placeholder.
 */

const PROJECT_PREFIX = 'sgve:project:';
const INDEX_KEY = 'sgve:projects-index';
const AUTOSAVE_KEY = 'sgve:autosave:current';
const SOFT_BYTE_LIMIT = 4 * 1024 * 1024; // 4 MB; localStorage caps vary 5–10MB

/* ── Utilities ─────────────────────────────────────────────────── */

/**
 * Slugify a project name for use as a localStorage key.
 *  - lowercase
 *  - non-alphanumeric runs collapse to a single `-`
 *  - leading / trailing `-` trimmed
 *  - empty result becomes `'untitled'`
 *
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
    const s = String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return s || 'untitled';
}

/** Cheap content hash — string length + first 256 chars of the JSON. Plenty
 *  to detect "did the project change since the last save" without crypto. */
export function hashProjectJson(json) {
    const s = String(json || '');
    return `${s.length}:${s.slice(0, 256)}`;
}

function getStore() {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
        return globalThis.localStorage;
    }
    return null;
}

function readJson(key, fallback) {
    const ls = getStore();
    if (!ls) return fallback;
    try {
        const raw = ls.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
    } catch (_) { return fallback; }
}

function writeJson(key, value) {
    const ls = getStore();
    if (!ls) throw new Error('localStorage unavailable');
    ls.setItem(key, JSON.stringify(value));
}

function removeKey(key) {
    const ls = getStore();
    if (!ls) return;
    try { ls.removeItem(key); } catch (_) {}
}

/* ── Serialise / deserialise project ───────────────────────────── */

/**
 * Strip Blob references from `project.assets` before serialisation. Keeps
 * `id`, `name`, `mime`, `assetType`, `duration`, `width`, `height`, `bytes`.
 * Leaves the rest of the project untouched.
 *
 * Pure: returns a new object; does not mutate `project`.
 */
export function stripAssetsForStorage(project) {
    if (!project || typeof project !== 'object') return project;
    const next = { ...project };
    if (Array.isArray(project.assets)) {
        next.assets = project.assets.map(a => {
            if (!a) return a;
            const { id, name, mime, assetType, duration, width, height, bytes } = a;
            const out = { id, name, mime, assetType };
            if (Number.isFinite(duration)) out.duration = duration;
            if (Number.isFinite(width)) out.width = width;
            if (Number.isFinite(height)) out.height = height;
            if (Number.isFinite(bytes)) out.bytes = bytes;
            return out;
        });
    }
    return next;
}

/**
 * Tag every asset entry with `__missingBlob: true` so the UI can render a
 * "missing — re-upload" placeholder. Caller clears the flag once the user
 * re-uploads a matching file (matched by name + bytes is a reasonable
 * heuristic, but that's the consumer's job).
 */
export function markAssetsAsMissing(project) {
    if (!project || !Array.isArray(project.assets)) return project;
    const next = { ...project };
    next.assets = project.assets.map(a => a ? { ...a, __missingBlob: true } : a);
    return next;
}

/* ── Index management ──────────────────────────────────────────── */

/**
 * Read the saved-projects index. Always returns an array (potentially empty).
 * Sorted by `savedAt` descending so the picker shows newest first.
 */
export function listSavedProjects() {
    const arr = readJson(INDEX_KEY, []);
    if (!Array.isArray(arr)) return [];
    return arr.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

function writeIndex(arr) {
    writeJson(INDEX_KEY, arr);
}

function upsertIndexEntry(slug, name, byteSize) {
    const arr = readJson(INDEX_KEY, []);
    const now = Date.now();
    const next = (Array.isArray(arr) ? arr : []).filter(e => e && e.slug !== slug);
    next.push({ slug, name, savedAt: now, byteSize });
    writeIndex(next);
    return { slug, name, savedAt: now, byteSize };
}

function removeIndexEntry(slug) {
    const arr = readJson(INDEX_KEY, []);
    const next = (Array.isArray(arr) ? arr : []).filter(e => e && e.slug !== slug);
    writeIndex(next);
}

/* ── Public API ────────────────────────────────────────────────── */

/**
 * Save a wrapped project to localStorage under the slug derived from `name`.
 * Refuses (`code:'too-large'`) if the JSON exceeds the soft byte limit.
 *
 * @param {object} project Wrapped project (already deep-cloned by caller).
 * @param {string} name Display name. Will be slugified for the key.
 * @returns {{ slug: string, name: string, savedAt: number, byteSize: number, json: string }}
 */
export function saveProjectToStorage(project, name) {
    const stripped = stripAssetsForStorage(project);
    const json = JSON.stringify(stripped);
    if (json.length > SOFT_BYTE_LIMIT) {
        throw Object.assign(
            new Error(`Project too large to save (${json.length} bytes > ${SOFT_BYTE_LIMIT})`),
            { code: 'too-large', byteSize: json.length, limit: SOFT_BYTE_LIMIT },
        );
    }
    const slug = slugify(name);
    const ls = getStore();
    if (!ls) throw new Error('localStorage unavailable');
    ls.setItem(PROJECT_PREFIX + slug, json);
    const entry = upsertIndexEntry(slug, name, json.length);
    return { ...entry, json };
}

/**
 * Load a wrapped project by slug. Returns null if missing.
 * Asset entries are tagged `__missingBlob: true` because Blob refs are not
 * stored — the caller must re-supply them via `loadAsset`.
 */
export function loadProjectFromStorage(slug) {
    const raw = readJson(PROJECT_PREFIX + slug, null);
    if (!raw) return null;
    return markAssetsAsMissing(raw);
}

/** Delete a saved project + its index entry. */
export function deleteSavedProject(slug) {
    removeKey(PROJECT_PREFIX + slug);
    removeIndexEntry(slug);
}

/* ── Autosave (Task 4) ─────────────────────────────────────────── */

/**
 * Write the autosave slot. Same lossy serialisation as named saves; wrapped
 * with `{ savedAt, project }` so the on-init prompt can compute "N seconds
 * ago".
 */
export function writeAutosave(project) {
    const stripped = stripAssetsForStorage(project);
    writeJson(AUTOSAVE_KEY, { savedAt: Date.now(), project: stripped });
}

/** Read the autosave slot. Returns `null` when absent or unparseable. */
export function readAutosave() {
    const raw = readJson(AUTOSAVE_KEY, null);
    if (!raw || typeof raw !== 'object' || !raw.project) return null;
    return { savedAt: raw.savedAt || 0, project: markAssetsAsMissing(raw.project) };
}

/** Delete the autosave slot (e.g. after manual save or user-discard). */
export function clearAutosave() { removeKey(AUTOSAVE_KEY); }

/**
 * Compare an autosave's `savedAt` against the latest named-save in the index.
 * Returns `true` when the autosave is strictly newer than every named save —
 * i.e. there's unsaved work worth offering to restore.
 */
export function autosaveIsNewer(autosaveTs) {
    if (!Number.isFinite(autosaveTs) || autosaveTs <= 0) return false;
    const arr = listSavedProjects();
    if (!arr.length) return true;
    const latest = arr[0].savedAt || 0;
    return autosaveTs > latest;
}

/* ── Constants exported for tests / consumers ──────────────────── */

export const __STORAGE_KEYS__ = {
    PROJECT_PREFIX, INDEX_KEY, AUTOSAVE_KEY, SOFT_BYTE_LIMIT,
};
