/** state-asset-storage.js — IndexedDB blob storage for sg-video-editor assets.
 *
 * Round-9-J. Asset blobs (video / image) are too large for localStorage
 * (browsers cap at ~5–10 MB total; videos are tens to hundreds of MB), so
 * blobs persist in IndexedDB while the lightweight project JSON keeps using
 * localStorage via `state-storage.js`.
 *
 * Storage shape:
 *   - Database name : `sgve`
 *   - Object store  : `assets`, keyed by `asset.id`
 *   - Entry shape   :
 *       {
 *         id,         // asset id (string, primary key)
 *         blob,       // Blob — the actual video/image bytes
 *         name,       // original filename
 *         kind,       // 'video' | 'image'
 *         mimeType,   // e.g. 'video/mp4'
 *         width?,     // pixels (when known)
 *         height?,    // pixels
 *         duration?,  // seconds (videos only)
 *         bytes?,     // duplicate of blob.size for cheap listing
 *         savedAt,    // ms epoch — set by saveAsset
 *       }
 *
 * Why this module — not the existing `core/sg-vfs` IndexedDB provider — is
 * documented in the Round-9-J commit body: sg-vfs models hierarchical *file*
 * paths and does its own folder bookkeeping, which is overkill for our
 * flat key→blob map. The wheel cache in `tools/.../sg-send-cli/index.html`
 * uses the same minimal `indexedDB.open` + single-store pattern this module
 * mirrors. Keeping the surface tiny means future tools can copy-paste it
 * without dragging the whole VFS abstraction.
 *
 * Pure async API. No DOM access. Safe to import from a worker if we ever
 * decide to move asset hydration off the main thread.
 *
 * @module sg-video-editor/state-asset-storage
 */

const DB_NAME = 'sgve';
const DB_VERSION = 1;
const STORE = 'assets';

/** Lazy DB handle — opened on first use, reused thereafter. */
let _dbPromise = null;

/** True when `globalThis.indexedDB` looks usable. */
function hasIndexedDb() {
    return typeof globalThis !== 'undefined'
        && globalThis.indexedDB
        && typeof globalThis.indexedDB.open === 'function';
}

/**
 * Open (or create) the sgve IDB database. Creates the `assets` store on
 * `onupgradeneeded`. Returns a singleton Promise so callers don't reopen
 * the connection on every call.
 *
 * @returns {Promise<IDBDatabase>}
 */
export function openAssetDb() {
    if (_dbPromise) return _dbPromise;
    if (!hasIndexedDb()) {
        return Promise.reject(new Error('IndexedDB unavailable'));
    }
    _dbPromise = new Promise((resolve, reject) => {
        const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error || new Error('open failed'));
    });
    return _dbPromise;
}

/** Reset the cached DB handle. Test-only. */
export function __resetAssetDbForTests() { _dbPromise = null; }

/** Wrap a single IDB request as a Promise. */
function reqAsPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('request failed'));
    });
}

/**
 * Persist an asset's blob (and metadata) to IDB. Idempotent — re-saving
 * the same id overwrites. Stamps `savedAt` with the current time.
 *
 * @param {{id: string, blob: Blob, name?: string, kind?: 'video'|'image',
 *          mimeType?: string, width?: number, height?: number,
 *          duration?: number, bytes?: number}} asset
 * @returns {Promise<{id: string, savedAt: number}>}
 */
export async function saveAsset(asset) {
    if (!asset || typeof asset !== 'object') throw new Error('asset object required');
    if (!asset.id || typeof asset.id !== 'string') throw new Error('asset.id required');
    if (!asset.blob) throw new Error('asset.blob required');
    const db = await openAssetDb();
    const savedAt = Date.now();
    const entry = {
        id: asset.id,
        blob: asset.blob,
        name: asset.name || '',
        kind: asset.kind === 'image' ? 'image' : 'video',
        mimeType: asset.mimeType || (asset.blob && asset.blob.type) || '',
        savedAt,
    };
    if (Number.isFinite(asset.width)) entry.width = asset.width;
    if (Number.isFinite(asset.height)) entry.height = asset.height;
    if (Number.isFinite(asset.duration)) entry.duration = asset.duration;
    entry.bytes = Number.isFinite(asset.bytes)
        ? asset.bytes
        : (asset.blob && Number.isFinite(asset.blob.size) ? asset.blob.size : 0);
    const tx = db.transaction(STORE, 'readwrite');
    await reqAsPromise(tx.objectStore(STORE).put(entry));
    return { id: asset.id, savedAt };
}

/**
 * Retrieve an asset record (including the Blob) by id.
 *
 * @param {string} assetId
 * @returns {Promise<object|null>} The full record or null if missing.
 */
export async function loadAsset(assetId) {
    if (!assetId) return null;
    const db = await openAssetDb();
    const tx = db.transaction(STORE, 'readonly');
    const result = await reqAsPromise(tx.objectStore(STORE).get(assetId));
    return result || null;
}

/**
 * Delete an asset record by id. Idempotent — missing ids are a no-op.
 *
 * @param {string} assetId
 * @returns {Promise<void>}
 */
export async function deleteAsset(assetId) {
    if (!assetId) return;
    const db = await openAssetDb();
    const tx = db.transaction(STORE, 'readwrite');
    await reqAsPromise(tx.objectStore(STORE).delete(assetId));
}

/**
 * List every asset id currently in IDB. Cheap — only fetches keys, never
 * the underlying Blobs.
 *
 * @returns {Promise<string[]>}
 */
export async function listAssetIds() {
    const db = await openAssetDb();
    const tx = db.transaction(STORE, 'readonly');
    const keys = await reqAsPromise(tx.objectStore(STORE).getAllKeys());
    return Array.isArray(keys) ? keys.map(String) : [];
}

/**
 * Delete every asset whose id is NOT in `usedIds`. Pass the union of asset
 * ids referenced by every saved project + the autosave slot + the live
 * project, so we never evict a blob still in use somewhere.
 *
 * Returns the list of ids that were actually deleted, for logging.
 *
 * @param {Iterable<string>} usedIds
 * @returns {Promise<string[]>}
 */
export async function pruneOrphanedAssets(usedIds) {
    const keep = new Set();
    if (usedIds) for (const id of usedIds) if (id) keep.add(String(id));
    const all = await listAssetIds();
    const deleted = [];
    for (const id of all) {
        if (!keep.has(id)) {
            try { await deleteAsset(id); deleted.push(id); }
            catch (_) { /* non-fatal */ }
        }
    }
    return deleted;
}

/**
 * Compute total storage usage across the asset store. Walks every record
 * and sums the `bytes` field (falls back to `blob.size`). Returns
 * `{ totalBytes, count }`.
 *
 * Note: this does fetch every blob handle (not the bytes themselves —
 * IDB's structured-clone keeps Blob refs cheap). Acceptable cost for the
 * small Properties-pane "Storage: …" readout.
 *
 * @returns {Promise<{ totalBytes: number, count: number }>}
 */
export async function computeAssetStorageUsage() {
    const db = await openAssetDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.openCursor();
        let totalBytes = 0;
        let count = 0;
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) {
                resolve({ totalBytes, count });
                return;
            }
            const v = cursor.value || {};
            const sz = Number.isFinite(v.bytes)
                ? v.bytes
                : (v.blob && Number.isFinite(v.blob.size) ? v.blob.size : 0);
            totalBytes += sz;
            count += 1;
            cursor.continue();
        };
        req.onerror = () => reject(req.error || new Error('cursor failed'));
    });
}

/**
 * Wipe every asset blob from IDB. Pairs with the manual "Clear all saved
 * data" affordance (not yet shipped in the UI as of Round-9-J).
 *
 * @returns {Promise<void>}
 */
export async function clearAllAssets() {
    const db = await openAssetDb();
    const tx = db.transaction(STORE, 'readwrite');
    await reqAsPromise(tx.objectStore(STORE).clear());
}

/* ── Constants exported for tests / consumers ──────────────────── */

export const __ASSET_DB__ = { DB_NAME, DB_VERSION, STORE };
