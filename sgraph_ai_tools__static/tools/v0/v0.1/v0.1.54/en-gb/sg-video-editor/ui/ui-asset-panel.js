/** ui-asset-panel.js — left-side asset list with file picker + drop source.
 *  Also hosts the "+ Shape" / "+ Text" toolbar so synthetic clips share the
 *  same authoring surface as imported assets. */

import { buildAssetRow } from './asset-row.js';
import { mountAddClipButtons } from './ui-add-clip-buttons.js';

const ASSET_MIME = 'application/x-sg-asset';

/** True when a File is a video or image we can register. */
function isAcceptedFile(f) {
    const t = f && (f.type || '');
    return t.startsWith('video/') || t.startsWith('image/');
}

/**
 * Mount the asset panel inside host. The full panel acts as a drop target.
 * @param {{host: HTMLElement, state: object, onFilesPicked: (files: File[]) => void, api?: object, getPlayhead?: () => number}} opts
 * @returns {{refresh: (project: object) => void, destroy: () => void}}
 */
export function mountAssetPanel({ host, state, onFilesPicked, api, getPlayhead }) {
    host.innerHTML = `
        <div class="sgve-asset-panel">
            <div class="sgve-asset-dropzone" tabindex="0">
                <p>Drop video or image files here or</p>
                <button type="button" class="sgve-asset-pick">Choose files</button>
                <input type="file" accept="video/*,image/*" multiple hidden />
            </div>
            <div class="sgve-add-slot"></div>
            <ul class="sgve-asset-list" role="list"></ul>
        </div>
    `;
    const root = host.firstElementChild;
    const pickBtn = root.querySelector('.sgve-asset-pick');
    const input = root.querySelector('input[type=file]');
    const list = root.querySelector('.sgve-asset-list');
    const addSlot = root.querySelector('.sgve-add-slot');
    let addToolbar = null;
    if (api && typeof api.addShapeClip === 'function') {
        addToolbar = mountAddClipButtons({
            host: addSlot,
            getProject: () => state.getProject(),
            getPlayhead: typeof getPlayhead === 'function' ? getPlayhead : () => 0,
            api,
        });
    }

    let dragDepth = 0;
    let activeUrls = [];
    let dragImageEl = null;

    function revokeActiveUrls() {
        for (const u of activeUrls) { try { URL.revokeObjectURL(u); } catch (_) {} }
        activeUrls = [];
    }

    function callPicked(files) {
        const ok = (files || []).filter(isAcceptedFile);
        if (ok.length && typeof onFilesPicked === 'function') onFilesPicked(ok);
    }

    /** True when the drag carries our internal asset MIME (asset row → timeline)
     *  rather than external files. Used to suppress the drop-mode affordance on
     *  the asset panel while dragging an asset OUT to the timeline. */
    function isInternalAssetDrag(e) {
        const types = e && e.dataTransfer && e.dataTransfer.types;
        if (!types) return false;
        if (typeof types.includes === 'function') return types.includes(ASSET_MIME);
        for (let i = 0; i < types.length; i++) if (types[i] === ASSET_MIME) return true;
        return false;
    }

    function onPick() { input.click(); }
    function onChange() { callPicked([...input.files]); input.value = ''; }
    function onDragEnter(e) {
        if (isInternalAssetDrag(e)) return;
        e.preventDefault();
        dragDepth += 1;
        root.classList.add('is-drag-over');
    }
    function onDragOver(e) {
        if (isInternalAssetDrag(e)) return;
        e.preventDefault();
    }
    function onDragLeave(e) {
        if (isInternalAssetDrag(e)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) root.classList.remove('is-drag-over');
    }
    function onDrop(e) {
        if (isInternalAssetDrag(e)) return;
        e.preventDefault();
        dragDepth = 0;
        root.classList.remove('is-drag-over');
        callPicked([...(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : [])]);
    }
    function clearDragImage() {
        if (!dragImageEl) return;
        try { dragImageEl.remove(); } catch (_) {}
        dragImageEl = null;
    }
    function buildDragImage(label) {
        const el = document.createElement('div');
        el.textContent = label;
        el.style.cssText = [
            'position:fixed', 'top:-1000px', 'left:-1000px',
            'padding:6px 10px', 'background:#0f172a', 'color:#e5e7eb',
            'border:1px solid rgba(20,184,166,0.6)', 'border-radius:4px',
            'font:12px/1.2 system-ui,sans-serif', 'pointer-events:none',
            'box-shadow:0 4px 14px rgba(0,0,0,0.5)', 'white-space:nowrap',
        ].join(';');
        document.body.appendChild(el);
        return el;
    }
    function onRowDragStart(e) {
        const row = e.target.closest('.sgve-asset-row');
        if (!row || !e.dataTransfer) return;
        const id = row.dataset.assetId;
        if (!id) return;
        e.dataTransfer.setData(ASSET_MIME, id);
        e.dataTransfer.effectAllowed = 'copy';
        clearDragImage();
        const label = (row.querySelector('.sgve-asset-name')?.textContent || 'asset').trim();
        dragImageEl = buildDragImage(label);
        // Anchor the ghost so it sits a small distance below-right of the cursor
        // rather than at the spot the user clicked on inside the row.
        try { e.dataTransfer.setDragImage(dragImageEl, -12, -8); } catch (_) {}
    }
    function onRowDragEnd() { clearDragImage(); }

    pickBtn.addEventListener('click', onPick);
    input.addEventListener('change', onChange);
    root.addEventListener('dragenter', onDragEnter);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave);
    root.addEventListener('drop', onDrop);
    list.addEventListener('dragstart', onRowDragStart);
    list.addEventListener('dragend', onRowDragEnd);

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

    function onStateChange(e) {
        if (e && e.detail && e.detail.transient) return;
        refresh(state.getProject());
    }
    state.addEventListener('change', onStateChange);
    refresh(state.getProject());

    /** Tear down listeners and clear host. */
    function destroy() {
        if (addToolbar) { try { addToolbar.destroy(); } catch (_) {} }
        clearDragImage();
        revokeActiveUrls();
        state.removeEventListener('change', onStateChange);
        pickBtn.removeEventListener('click', onPick);
        input.removeEventListener('change', onChange);
        root.removeEventListener('dragenter', onDragEnter);
        root.removeEventListener('dragover', onDragOver);
        root.removeEventListener('dragleave', onDragLeave);
        root.removeEventListener('drop', onDrop);
        list.removeEventListener('dragstart', onRowDragStart);
        list.removeEventListener('dragend', onRowDragEnd);
        host.innerHTML = '';
    }

    return { refresh, destroy };
}
