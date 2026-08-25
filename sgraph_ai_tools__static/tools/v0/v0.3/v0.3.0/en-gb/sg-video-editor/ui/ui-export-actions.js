/** ui-export-actions.js — post-export Download + Drag-out widgets.
 *
 * Round-9-I Task 5. Once the export pipeline returns a Blob the export
 * controls flip from a single Export button to two side-by-side
 * affordances:
 *
 *   • Download — saves the file via the standard
 *     `URL.createObjectURL(blob)` + invisible `<a download>` click
 *     pattern. Blob stays alive in memory; the temporary object URL
 *     is revoked a few seconds after the click so the browser can
 *     reclaim it.
 *
 *   • Drag handle — exposes BOTH SG-native and OS-native drag data so
 *     the user can drop the result onto:
 *
 *       (a) another SG tool (vault, send, workspace, the YouTube
 *           editor) — those pages either accept the OS File via
 *           `dataTransfer.files` (`<sg-upload-dropzone>`) or read the
 *           SG-native MIME `application/x-sg-asset` (the timeline's
 *           own asset-panel drop). The SG-native payload here is a
 *           JSON descriptor with the blob's metadata — receivers that
 *           expect just an asset id will silently fall back to OS files
 *           for now; descriptor-aware receivers can pick up the metadata.
 *
 *       (b) the desktop / a native tab — the OS handler reads the
 *           File pushed via `DataTransferItemList.add(file)` and
 *           spawns the usual save / open dialog.
 *
 * Re-export ⟲ link below the buttons resets state back to idle so the
 * user can change the project and run again. The previous blob's object
 * URL is revoked at that point.
 */

const SG_ASSET_MIME = 'application/x-sg-asset';

/** Build a download anchor + trigger an immediate download. The object URL
 *  is revoked 4 seconds after the click so the file finishes streaming
 *  to the user agent. */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Pick a `.mp4` / `.webm` extension from the recorded MIME type. */
export function extFor(mime) {
    if (!mime) return 'mp4';
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('webm')) return 'webm';
    return 'mp4';
}

/** Build a `File` object from a Blob if it isn't already one. Browsers
 *  treat `dataTransfer.files` items as File instances; a plain Blob is
 *  refused by some receivers. */
function ensureFile(blob, filename) {
    if (typeof File === 'function' && blob instanceof File) return blob;
    try {
        return new File([blob], filename, {
            type: blob.type || 'video/mp4',
            lastModified: Date.now(),
        });
    } catch (_) {
        // Older Safari may refuse the File ctor here. Fall back to the Blob;
        // receivers that strictly want File-with-name will skip it but the
        // OS-level drop still works.
        return blob;
    }
}

/**
 * Mount the post-export action row (Download + Drag handle + Re-export
 * link) into a host element. The host is cleared. Returns a handle the
 * caller can call to tear down listeners.
 *
 * @param {{
 *   host: HTMLElement,
 *   blob: Blob,
 *   mimeType?: string,
 *   filename?: string,
 *   onReexport?: () => void,
 * }} cfg
 * @returns {{ root: HTMLElement, destroy: () => void }}
 */
export function mountExportActions({ host, blob, mimeType, filename, onReexport }) {
    const mime = mimeType || (blob && blob.type) || 'video/mp4';
    const name = filename || `sg-video-editor-${Date.now()}.${extFor(mime)}`;
    const file = ensureFile(blob, name);

    host.innerHTML = `
        <div class="sgve-export-actions" data-state="done">
            <button type="button" class="sgve-export-download"
                    title="Save the rendered MP4 to disk">
                <span aria-hidden="true">⬇</span>
                <span>Download</span>
            </button>
            <button type="button" class="sgve-export-drag" draggable="true"
                    title="Drag onto another tool (SG / Send / Vault) or the desktop">
                <span aria-hidden="true">⇲</span>
                <span>Drag out</span>
            </button>
            <button type="button" class="sgve-export-reexport"
                    title="Discard this render and start a fresh export">
                <span aria-hidden="true">↺</span>
                <span>Re-export</span>
            </button>
        </div>
    `;
    const root = host.firstElementChild;
    const downloadBtn = root.querySelector('.sgve-export-download');
    const dragBtn = root.querySelector('.sgve-export-drag');
    const reexportBtn = root.querySelector('.sgve-export-reexport');

    function onDownloadClick() { triggerDownload(blob, name); }

    function onDragStart(e) {
        if (!e.dataTransfer) return;
        const dt = e.dataTransfer;
        // Some browsers default to 'none' for buttons; force 'copyMove'.
        try { dt.effectAllowed = 'copyMove'; } catch (_) {}

        // SG-native descriptor — JSON metadata for descriptor-aware receivers.
        // Doesn't include the blob itself (drop targets in other tools have
        // no way to dereference an in-memory blob from this page); it's a
        // hint so an SG tool that wants to special-case SG sources can.
        const descriptor = {
            kind: 'export-mp4',
            source: 'sg-video-editor',
            name,
            mime,
            size: blob.size,
            createdAt: Date.now(),
        };
        try { dt.setData(SG_ASSET_MIME, JSON.stringify(descriptor)); } catch (_) {}
        try { dt.setData('text/plain', name); } catch (_) {}

        // OS-native: push the File so `dataTransfer.files` works on receivers
        // that expect raw files (the desktop, sg-upload-dropzone, an
        // ordinary <input type="file"> drop). DataTransferItemList.add is
        // the only way to seed `.files` from script.
        try {
            if (dt.items && typeof dt.items.add === 'function' && file instanceof Blob) {
                dt.items.add(file);
            }
        } catch (_) { /* some browsers reject adding non-File Blobs; harmless */ }

        // Visual cue while dragging.
        dragBtn.classList.add('is-dragging');
    }
    function onDragEnd() { dragBtn.classList.remove('is-dragging'); }

    function onReexportClick() {
        if (typeof onReexport === 'function') onReexport();
    }

    downloadBtn.addEventListener('click', onDownloadClick);
    dragBtn.addEventListener('dragstart', onDragStart);
    dragBtn.addEventListener('dragend', onDragEnd);
    reexportBtn.addEventListener('click', onReexportClick);

    function destroy() {
        try { downloadBtn.removeEventListener('click', onDownloadClick); } catch (_) {}
        try { dragBtn.removeEventListener('dragstart', onDragStart); } catch (_) {}
        try { dragBtn.removeEventListener('dragend', onDragEnd); } catch (_) {}
        try { reexportBtn.removeEventListener('click', onReexportClick); } catch (_) {}
        host.innerHTML = '';
    }

    return { root, destroy };
}
