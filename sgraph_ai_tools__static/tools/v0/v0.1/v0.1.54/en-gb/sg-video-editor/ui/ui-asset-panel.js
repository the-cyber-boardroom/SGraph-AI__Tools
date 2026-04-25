/** ui-asset-panel.js — left-side asset list with file picker + drop source. */

import { buildAssetRow } from './asset-row.js';

const ASSET_MIME = 'application/x-sg-asset';

/** True when a File is a video or image we can register. */
function isAcceptedFile(f) {
    const t = f && (f.type || '');
    return t.startsWith('video/') || t.startsWith('image/');
}

/**
 * Mount the asset panel inside host. The full panel acts as a drop target.
 * @param {{host: HTMLElement, state: object, onFilesPicked: (files: File[]) => void}} opts
 * @returns {{refresh: (project: object) => void, destroy: () => void}}
 */
export function mountAssetPanel({ host, state, onFilesPicked }) {
    host.innerHTML = `
        <div class="sgve-asset-panel">
            <div class="sgve-asset-dropzone" tabindex="0">
                <p>Drop video or image files here or</p>
                <button type="button" class="sgve-asset-pick">Choose files</button>
                <input type="file" accept="video/*,image/*" multiple hidden />
            </div>
            <ul class="sgve-asset-list" role="list"></ul>
        </div>
    `;
    const root = host.firstElementChild;
    const pickBtn = root.querySelector('.sgve-asset-pick');
    const input = root.querySelector('input[type=file]');
    const list = root.querySelector('.sgve-asset-list');

    let dragDepth = 0;
    let activeUrls = [];

    function revokeActiveUrls() {
        for (const u of activeUrls) { try { URL.revokeObjectURL(u); } catch (_) {} }
        activeUrls = [];
    }

    function callPicked(files) {
        const ok = (files || []).filter(isAcceptedFile);
        if (ok.length && typeof onFilesPicked === 'function') onFilesPicked(ok);
    }

    function onPick() { input.click(); }
    function onChange() { callPicked([...input.files]); input.value = ''; }
    function onDragEnter(e) {
        e.preventDefault();
        dragDepth += 1;
        root.classList.add('is-drag-over');
    }
    function onDragOver(e) { e.preventDefault(); }
    function onDragLeave(e) {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) root.classList.remove('is-drag-over');
        void e;
    }
    function onDrop(e) {
        e.preventDefault();
        dragDepth = 0;
        root.classList.remove('is-drag-over');
        callPicked([...(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : [])]);
    }
    function onRowDragStart(e) {
        const row = e.target.closest('.sgve-asset-row');
        if (!row || !e.dataTransfer) return;
        const id = row.dataset.assetId;
        if (!id) return;
        e.dataTransfer.setData(ASSET_MIME, id);
        e.dataTransfer.effectAllowed = 'copy';
    }

    pickBtn.addEventListener('click', onPick);
    input.addEventListener('change', onChange);
    root.addEventListener('dragenter', onDragEnter);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave);
    root.addEventListener('drop', onDrop);
    list.addEventListener('dragstart', onRowDragStart);

    /** Re-render asset list from a wrapped project shape (state.getProject()). */
    function refresh(project) {
        const assets = (project && Array.isArray(project.assets)) ? project.assets : [];
        revokeActiveUrls();
        list.replaceChildren();
        if (!assets.length) {
            const empty = document.createElement('li');
            empty.className = 'sgve-asset-empty';
            empty.textContent = 'No assets yet.';
            list.appendChild(empty);
            return;
        }
        const registry = state.getAssetRegistry ? state.getAssetRegistry() : null;
        for (const a of assets) {
            const { element, urls } = buildAssetRow(a, registry);
            activeUrls.push(...urls);
            list.appendChild(element);
        }
    }

    function onStateChange() { refresh(state.getProject()); }
    state.addEventListener('change', onStateChange);
    refresh(state.getProject());

    /** Tear down listeners and clear host. */
    function destroy() {
        revokeActiveUrls();
        state.removeEventListener('change', onStateChange);
        pickBtn.removeEventListener('click', onPick);
        input.removeEventListener('change', onChange);
        root.removeEventListener('dragenter', onDragEnter);
        root.removeEventListener('dragover', onDragOver);
        root.removeEventListener('dragleave', onDragLeave);
        root.removeEventListener('drop', onDrop);
        list.removeEventListener('dragstart', onRowDragStart);
        host.innerHTML = '';
    }

    return { refresh, destroy };
}
