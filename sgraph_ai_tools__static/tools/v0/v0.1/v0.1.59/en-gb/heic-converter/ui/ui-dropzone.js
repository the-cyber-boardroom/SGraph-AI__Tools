/**
 * ui-dropzone — drag-and-drop + file picker + folder picker wiring.
 *
 * Files added here go through the SgToolApi (`api.addFiles(...)`) so the same
 * code path applies to both human and headless callers. Supports:
 *   - clicking to pick individual HEIC / video files,
 *   - a separate "Pick folder" button (`<input webkitdirectory>`),
 *   - dropping individual files OR a whole folder (recursed via the
 *     FileSystem Entry API in ui-folder.js).
 *
 * @module heic-converter/ui-dropzone
 */

import { collectDropEntries, filesToEntries } from './ui-folder.js';

/**
 * Render a dropzone + file picker + folder picker into `root`.
 * @param {{root: HTMLElement, state: object, api: object}} opts
 * @returns {{destroy: () => void}}
 */
export function mountDropzone({ root, api }) {
    root.innerHTML = `
        <div class="hc-dropzone" id="hc-drop" tabindex="0" role="button"
             aria-label="Drop HEIC photos, videos, or a whole folder here, or click to choose files">
            <div class="hc-dropzone__icon">⬇</div>
            <div class="hc-dropzone__primary">Drop HEIC photos, videos, or a folder here</div>
            <div class="hc-dropzone__secondary">
                or click to choose files — or
                <button type="button" id="hc-pick-folder" class="hc-link-btn">pick a folder</button>
            </div>
            <input type="file" id="hc-file" accept=".heic,.heif,image/heic,image/heif,.mp4,.mov,.m4v,video/mp4,video/quicktime" multiple hidden>
            <input type="file" id="hc-folder" webkitdirectory multiple hidden>
        </div>
        <div class="hc-meta-note" role="note">
            🔒 Every output is re-encoded from pixels in your browser, so all original
            metadata — including GPS / location — is removed. Nothing is uploaded.
        </div>
        <div class="hc-dropzone__notice" id="hc-notice" role="status" aria-live="polite"></div>
    `;

    const dz = root.querySelector('#hc-drop');
    const input = root.querySelector('#hc-file');
    const folderInput = root.querySelector('#hc-folder');
    const folderBtn = root.querySelector('#hc-pick-folder');
    const notice = root.querySelector('#hc-notice');

    function showNotice(text, kind) {
        notice.textContent = text;
        notice.dataset.kind = kind || 'info';
        if (kind !== 'error') {
            setTimeout(() => {
                if (notice.textContent === text) notice.textContent = '';
            }, 6000);
        }
    }

    async function addEntries(entries) {
        if (!entries || entries.length === 0) {
            showNotice('No files found in the drop', 'warn');
            return;
        }
        try {
            const res = await api.addFiles({ entries });
            const skipped = res.skipped || [];
            if (skipped.length > 0) {
                const shown = skipped.slice(0, 5).map((s) => `${s.name} (${s.reason})`).join(', ');
                const more = skipped.length > 5 ? ` +${skipped.length - 5} more` : '';
                showNotice(`Added ${res.added.length}; skipped ${skipped.length}: ${shown}${more}`, 'warn');
            } else {
                showNotice(`Added ${res.added.length} file(s)`, 'info');
            }
        } catch (err) {
            showNotice(`Add failed: ${err.message}`, 'error');
        }
    }

    function onPick() { input.click(); }
    function onPickFolder(e) { e.preventDefault(); e.stopPropagation(); folderInput.click(); }
    function onKey(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }

    function onFileChange(e) {
        addEntries(filesToEntries(e.target.files));
        try { input.value = ''; } catch (_) { /* ignore */ }
    }
    function onFolderChange(e) {
        addEntries(filesToEntries(e.target.files));
        try { folderInput.value = ''; } catch (_) { /* ignore */ }
    }

    function onDragOver(e) { e.preventDefault(); dz.classList.add('hc-dropzone--drag'); }
    function onDragLeave() { dz.classList.remove('hc-dropzone--drag'); }
    async function onDrop(e) {
        e.preventDefault();
        dz.classList.remove('hc-dropzone--drag');
        const dt = e.dataTransfer;
        if (!dt) return;
        // Capture items synchronously — DataTransferItemList is cleared after
        // the event handler returns, so we must read entries inside the await.
        const entries = await collectDropEntries(dt);
        addEntries(entries);
    }

    dz.addEventListener('click', onPick);
    folderBtn.addEventListener('click', onPickFolder);
    dz.addEventListener('keydown', onKey);
    input.addEventListener('change', onFileChange);
    folderInput.addEventListener('change', onFolderChange);
    dz.addEventListener('dragover', onDragOver);
    dz.addEventListener('dragenter', onDragOver);
    dz.addEventListener('dragleave', onDragLeave);
    dz.addEventListener('drop', onDrop);

    return {
        destroy() {
            dz.removeEventListener('click', onPick);
            folderBtn.removeEventListener('click', onPickFolder);
            dz.removeEventListener('keydown', onKey);
            input.removeEventListener('change', onFileChange);
            folderInput.removeEventListener('change', onFolderChange);
            dz.removeEventListener('dragover', onDragOver);
            dz.removeEventListener('dragenter', onDragOver);
            dz.removeEventListener('dragleave', onDragLeave);
            dz.removeEventListener('drop', onDrop);
        },
    };
}
