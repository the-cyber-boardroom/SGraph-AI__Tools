/**
 * state.js — in-memory item list + change emitter for the HEIC Converter.
 *
 * No persistence (HEIC blobs are large and the user is here to convert and
 * download, not to keep state). Mutations emit a `change` event on the
 * returned EventTarget so UI panels can re-render.
 *
 * Item shape:
 * {
 *   id, file (File), name, sizeBytes,
 *   kind: 'heic' | 'video',
 *   relativePath?: string,   // folder-relative path (mirrored into the ZIP)
 *   status: 'queued' | 'running' | 'done' | 'error' | 'skipped',
 *   skippedReason?: string,  // e.g. 'live-photo-duplicate'
 *   error?: string,
 *   outputBlob?: Blob, outputType?: string, outputName?: string, outputSize?: number,
 *   thumbnailUrl?: string,   // objectURL of the converted blob (revoke on reset)
 *   width?: number, height?: number,
 *   decodeLib?: 'heic-to' | 'libheif-js' | 'video' | 'ffmpeg',
 * }
 *
 * @module heic-converter/state
 */

/**
 * @returns {{
 *   addEventListener: Function, removeEventListener: Function,
 *   getItems: () => Array,
 *   getItem: (id: string) => object|null,
 *   addFile: (file: File, meta?: object) => string|null,
 *   updateItem: (id: string, patch: object) => void,
 *   removeItem: (id: string) => void,
 *   reset: () => void,
 *   getFormat: () => string,
 *   setFormat: (format: string) => void,
 *   getQuality: () => number,
 *   setQuality: (q: number) => void,
 *   getLivePhotoDedup: () => boolean,
 *   setLivePhotoDedup: (enabled: boolean) => void,
 *   getFolderName: () => string|null,
 *   setFolderName: (name: string) => void,
 * }}
 */
export function createState() {
    /** @type {Array<object>} */
    const items = [];
    /** @type {Set<string>} dedupe key = `${name}::${sizeBytes}` */
    const seen = new Set();
    const target = new EventTarget();

    let nextId = 1;
    let format = 'image/webp';
    let quality = 0.85;
    let livePhotoDedup = true;
    /** @type {string|null} top-level folder name when a folder was dropped/picked */
    let folderName = null;

    function emit(kind, extra) {
        target.dispatchEvent(new CustomEvent('change', {
            detail: { kind, ...(extra || {}) },
        }));
    }

    function getItems() {
        // Return a shallow-cloned list; callers should not mutate blobs.
        return items.map((it) => ({ ...it }));
    }

    function getItem(id) {
        return items.find((it) => it.id === id) || null;
    }

    function addFile(file, meta = {}) {
        if (!file) return null;
        const relativePath = meta.relativePath || file.webkitRelativePath || '';
        // Dedupe on relativePath when present (two folders may hold same name).
        const key = relativePath
            ? `${relativePath}::${file.size || 0}`
            : `${file.name || 'file'}::${file.size || 0}`;
        if (seen.has(key)) return null;
        seen.add(key);
        const id = `hc-${nextId++}`;
        items.push({
            id,
            file,
            name: file.name || `file-${id}`,
            sizeBytes: file.size || 0,
            kind: meta.kind || 'heic',
            relativePath: relativePath || undefined,
            status: 'queued',
        });
        emit('added', { id });
        return id;
    }

    function updateItem(id, patch) {
        const idx = items.findIndex((it) => it.id === id);
        if (idx < 0) return;
        const prev = items[idx];
        // Revoke an old thumbnail URL if we're about to replace it.
        if (patch.thumbnailUrl && prev.thumbnailUrl && prev.thumbnailUrl !== patch.thumbnailUrl) {
            try { URL.revokeObjectURL(prev.thumbnailUrl); } catch (_) { /* ignore */ }
        }
        items[idx] = { ...prev, ...patch };
        emit('updated', { id });
    }

    function removeItem(id) {
        const idx = items.findIndex((it) => it.id === id);
        if (idx < 0) return;
        const it = items[idx];
        if (it.thumbnailUrl) {
            try { URL.revokeObjectURL(it.thumbnailUrl); } catch (_) { /* ignore */ }
        }
        const key = it.relativePath
            ? `${it.relativePath}::${it.sizeBytes}`
            : `${it.name}::${it.sizeBytes}`;
        seen.delete(key);
        items.splice(idx, 1);
        emit('removed', { id });
    }

    function reset() {
        for (const it of items) {
            if (it.thumbnailUrl) {
                try { URL.revokeObjectURL(it.thumbnailUrl); } catch (_) { /* ignore */ }
            }
        }
        items.length = 0;
        seen.clear();
        folderName = null;
        emit('reset');
    }

    function getFormat() { return format; }
    function setFormat(f) {
        if (typeof f !== 'string') return;
        format = f;
        emit('format', { format: f });
    }
    function getQuality() { return quality; }
    function setQuality(q) {
        const n = Number(q);
        if (!Number.isFinite(n)) return;
        quality = Math.max(0, Math.min(1, n));
        emit('quality', { quality });
    }

    function getLivePhotoDedup() { return livePhotoDedup; }
    function setLivePhotoDedup(enabled) {
        livePhotoDedup = !!enabled;
        emit('livePhotoDedup', { enabled: livePhotoDedup });
    }

    function getFolderName() { return folderName; }
    function setFolderName(name) {
        if (typeof name === 'string' && name) {
            folderName = name;
            emit('folder', { folderName });
        }
    }

    return {
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        getItems,
        getItem,
        addFile,
        updateItem,
        removeItem,
        reset,
        getFormat,
        setFormat,
        getQuality,
        setQuality,
        getLivePhotoDedup,
        setLivePhotoDedup,
        getFolderName,
        setFolderName,
    };
}
