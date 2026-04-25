/** ui-asset-panel.js — left-side asset list with file picker + drop source. */

const ASSET_MIME = 'application/x-sg-asset';

const ROOT_STYLE = 'display:flex;flex-direction:column;gap:.5rem;height:100%;'
    + 'padding:.75rem;box-sizing:border-box;overflow:hidden;';
const DROPZONE_STYLE = 'display:flex;flex-direction:column;align-items:center;gap:.4rem;'
    + 'padding:.75rem;border:1px dashed #475569;border-radius:6px;'
    + 'background:#111827;cursor:pointer;text-align:center;';
const LIST_STYLE = 'list-style:none;margin:0;padding:0;display:flex;flex-direction:column;'
    + 'gap:.25rem;overflow-y:auto;flex:1 1 auto;min-height:0;';
const ROW_STYLE = 'display:flex;flex-direction:column;gap:.1rem;padding:.4rem .5rem;'
    + 'border:1px solid #1f2937;border-radius:4px;background:#0f172a;cursor:grab;';
const META_STYLE = 'font-size:.75rem;color:#94a3b8;';

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

/** Format byte size as KB/MB. */
function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Mount the asset panel inside host.
 * @param {{host: HTMLElement, state: object, onFilesPicked: (files: File[]) => void}} opts
 * @returns {{refresh: (project: object) => void, destroy: () => void}}
 */
export function mountAssetPanel({ host, state, onFilesPicked }) {
    host.innerHTML = `
        <div class="sgve-asset-panel" style="${ROOT_STYLE}">
            <div class="sgve-asset-dropzone" tabindex="0" style="${DROPZONE_STYLE}">
                <p style="margin:0">Drop video files here or</p>
                <button type="button" class="sgve-asset-pick">Choose files</button>
                <input type="file" accept="video/*" multiple hidden />
            </div>
            <ul class="sgve-asset-list" role="list" style="${LIST_STYLE}"></ul>
        </div>
    `;
    const root = host.firstElementChild;
    const dropzone = root.querySelector('.sgve-asset-dropzone');
    const pickBtn = root.querySelector('.sgve-asset-pick');
    const input = root.querySelector('input[type=file]');
    const list = root.querySelector('.sgve-asset-list');

    function callPicked(files) {
        const vids = (files || []).filter(f => f && (f.type || '').startsWith('video/'));
        if (vids.length && typeof onFilesPicked === 'function') onFilesPicked(vids);
    }

    function onPick() { input.click(); }
    function onChange() { callPicked([...input.files]); input.value = ''; }
    function onDragEnter(e) { e.preventDefault(); dropzone.classList.add('is-drag-over'); }
    function onDragOver(e) { e.preventDefault(); }
    function onDragLeave() { dropzone.classList.remove('is-drag-over'); }
    function onDrop(e) {
        e.preventDefault();
        dropzone.classList.remove('is-drag-over');
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
    dropzone.addEventListener('dragenter', onDragEnter);
    dropzone.addEventListener('dragover', onDragOver);
    dropzone.addEventListener('dragleave', onDragLeave);
    dropzone.addEventListener('drop', onDrop);
    list.addEventListener('dragstart', onRowDragStart);

    /**
     * Re-render asset list from a wrapped project shape (state.getProject()).
     * @param {{assets: Array<object>}} project
     */
    function refresh(project) {
        const assets = (project && Array.isArray(project.assets)) ? project.assets : [];
        if (!assets.length) {
            list.innerHTML = `<li style="${META_STYLE};padding:.5rem">No assets yet.</li>`;
            return;
        }
        list.innerHTML = assets.map(a => `
            <li class="sgve-asset-row" draggable="true" data-asset-id="${escape(a.id)}" style="${ROW_STYLE}">
                <span class="sgve-asset-name">${escape(a.name || a.id)}</span>
                <span class="sgve-asset-meta" style="${META_STYLE}">${escape(formatDuration(a.duration))} · ${escape(formatSize(a.bytes ?? 0))}</span>
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
        dropzone.removeEventListener('dragenter', onDragEnter);
        dropzone.removeEventListener('dragover', onDragOver);
        dropzone.removeEventListener('dragleave', onDragLeave);
        dropzone.removeEventListener('drop', onDrop);
        list.removeEventListener('dragstart', onRowDragStart);
        host.innerHTML = '';
    }

    return { refresh, destroy };
}
