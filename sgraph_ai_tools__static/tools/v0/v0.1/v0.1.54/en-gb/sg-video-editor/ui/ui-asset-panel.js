/** ui-asset-panel.js — left-side asset list with file picker + drop source. */

const ASSET_MIME = 'application/x-sg-asset';

/** Minimal HTML escaper. */
function escape(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Format seconds as m:ss. */
function formatDuration(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '–';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Format byte size as KB/MB/GB. */
function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
                <p>Drop video files here or</p>
                <button type="button" class="sgve-asset-pick">Choose files</button>
                <input type="file" accept="video/*" multiple hidden />
            </div>
            <ul class="sgve-asset-list" role="list"></ul>
        </div>
    `;
    const root = host.firstElementChild;
    const pickBtn = root.querySelector('.sgve-asset-pick');
    const input = root.querySelector('input[type=file]');
    const list = root.querySelector('.sgve-asset-list');

    let dragDepth = 0;

    function callPicked(files) {
        const vids = (files || []).filter(f => f && (f.type || '').startsWith('video/'));
        if (vids.length && typeof onFilesPicked === 'function') onFilesPicked(vids);
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

    /**
     * Re-render asset list from a wrapped project shape (state.getProject()).
     * @param {{assets: Array<object>}} project
     */
    function refresh(project) {
        const assets = (project && Array.isArray(project.assets)) ? project.assets : [];
        if (!assets.length) {
            list.innerHTML = `<li class="sgve-asset-empty">No assets yet.</li>`;
            return;
        }
        list.innerHTML = assets.map(a => `
            <li class="sgve-asset-row" draggable="true" data-asset-id="${escape(a.id)}">
                <span class="sgve-asset-name">${escape(a.name || a.id)}</span>
                <span class="sgve-asset-meta">${escape(formatDuration(a.duration))} · ${escape(formatSize(a.bytes ?? 0))}</span>
            </li>
        `).join('');
    }

    function onStateChange() { refresh(state.getProject()); }
    state.addEventListener('change', onStateChange);
    refresh(state.getProject());

    /** Tear down listeners and clear host. */
    function destroy() {
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
