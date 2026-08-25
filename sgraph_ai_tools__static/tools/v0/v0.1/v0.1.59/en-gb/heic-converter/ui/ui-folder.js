/**
 * ui-folder — folder-drop traversal helpers.
 *
 * Turns a dropped folder (or a flat multi-file drop) into a flat list of
 * `{ file, relativePath }` entries that `api.addFiles({ entries })` consumes.
 * Uses the non-standard but widely-supported `DataTransferItem.webkitGetAsEntry`
 * + FileSystem Entry API to recurse directory trees.
 *
 * NOTE: `webkitGetAsEntry` recursion is browser-only and could not be verified
 * headlessly. If a browser doesn't expose it, we fall back to the flat
 * `dataTransfer.files` list (no folder structure, but files still ingest).
 *
 * @module heic-converter/ui-folder
 */

/**
 * Read all entries from a directory reader, paging until empty
 * (`readEntries` returns at most ~100 entries per call).
 * @param {any} reader - a FileSystemDirectoryReader
 * @returns {Promise<any[]>}
 */
function readAllEntries(reader) {
    return new Promise((resolve, reject) => {
        const all = [];
        const pump = () => {
            reader.readEntries((batch) => {
                if (!batch.length) { resolve(all); return; }
                all.push(...batch);
                pump();
            }, reject);
        };
        pump();
    });
}

/**
 * Resolve a FileSystemFileEntry to a File.
 * @param {any} entry
 * @returns {Promise<File>}
 */
function entryToFile(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/**
 * Recurse a FileSystem entry tree, collecting `{ file, relativePath }`.
 * @param {any} entry - a FileSystemEntry (file or directory)
 * @param {string} prefix - path accumulated so far
 * @param {Array<{file: File, relativePath: string}>} out
 * @returns {Promise<void>}
 */
async function walkEntry(entry, prefix, out) {
    if (!entry) return;
    if (entry.isFile) {
        try {
            const file = await entryToFile(entry);
            out.push({ file, relativePath: `${prefix}${entry.name}` });
        } catch (_) { /* skip unreadable file */ }
        return;
    }
    if (entry.isDirectory) {
        const reader = entry.createReader();
        const children = await readAllEntries(reader);
        for (const child of children) {
            await walkEntry(child, `${prefix}${entry.name}/`, out);
        }
    }
}

/**
 * Collect `{ file, relativePath }` entries from a DataTransfer, recursing into
 * any dropped folders. Falls back to the flat file list when the
 * FileSystem Entry API is unavailable.
 *
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<Array<{file: File, relativePath: string}>>}
 */
export async function collectDropEntries(dataTransfer) {
    const items = dataTransfer && dataTransfer.items ? Array.from(dataTransfer.items) : [];
    const canTraverse = items.length > 0
        && typeof items[0].webkitGetAsEntry === 'function';

    if (!canTraverse) {
        // Flat fallback: plain files, no folder structure.
        const files = dataTransfer && dataTransfer.files ? Array.from(dataTransfer.files) : [];
        return files.map((file) => ({ file, relativePath: file.webkitRelativePath || '' }));
    }

    const roots = items
        .map((it) => it.webkitGetAsEntry())
        .filter(Boolean);

    const out = [];
    for (const root of roots) {
        await walkEntry(root, '', out);
    }
    return out;
}

/**
 * Map a flat FileList from a `<input webkitdirectory>` pick to entries,
 * preserving each file's `webkitRelativePath`.
 * @param {FileList|File[]} fileList
 * @returns {Array<{file: File, relativePath: string}>}
 */
export function filesToEntries(fileList) {
    return Array.from(fileList || []).map((file) => ({
        file,
        relativePath: file.webkitRelativePath || '',
    }));
}
