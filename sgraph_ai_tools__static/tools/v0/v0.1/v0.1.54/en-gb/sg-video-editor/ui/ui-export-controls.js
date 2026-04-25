/** ui-export-controls.js — export button + status + download trigger. */

const ROOT_STYLE = 'display:inline-flex;align-items:center;gap:.5rem;';
const BTN_STYLE = 'padding:.4rem .9rem;border:1px solid #1f2937;border-radius:4px;'
    + 'background:#1e293b;color:inherit;font:inherit;cursor:pointer;';
const STATUS_STYLE = 'font-size:.8rem;color:#94a3b8;';

/** Trigger a programmatic download of a Blob with a given filename. */
function downloadBlob(blob, filename) {
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

/** Pick file extension from a mime type. */
function extFor(mime) {
    if (!mime) return 'mp4';
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('webm')) return 'webm';
    return 'mp4';
}

/**
 * Mount the export controls inside host.
 * @param {{host: HTMLElement, onExport: (opts: {onProgress?: Function}) => Promise<{blob: Blob, mimeType: string, sizeBytes: number, durationMs: number}>}} opts
 * @returns {{destroy: () => void}}
 */
export function mountExportControls({ host, onExport }) {
    host.innerHTML = `
        <div class="sgve-export" style="${ROOT_STYLE}">
            <button type="button" class="sgve-export-btn" style="${BTN_STYLE}">Export MP4</button>
            <span class="sgve-export-status" style="${STATUS_STYLE}" hidden></span>
        </div>
    `;
    const root = host.firstElementChild;
    const btn = root.querySelector('.sgve-export-btn');
    const status = root.querySelector('.sgve-export-status');

    function setStatus(text, visible = true) {
        status.textContent = text || '';
        status.hidden = !visible;
    }

    async function onClick() {
        if (typeof onExport !== 'function') return;
        btn.disabled = true;
        setStatus('Exporting…');
        try {
            const onProgress = (info) => {
                const r = info && Number.isFinite(info.ratio) ? info.ratio : null;
                if (r != null) setStatus(`Exporting ${Math.round(r * 100)}%`);
            };
            const result = await onExport({ onProgress });
            const blob = result && result.blob;
            if (!(blob instanceof Blob)) throw new Error('export returned no blob');
            const mime = (result && result.mimeType) || blob.type || 'video/mp4';
            const filename = `sg-video-editor-${Date.now()}.${extFor(mime)}`;
            downloadBlob(blob, filename);
            setStatus('Done');
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            setStatus(`Error: ${msg}`);
        } finally {
            btn.disabled = false;
        }
    }

    btn.addEventListener('click', onClick);

    /** Tear down listeners and clear host. */
    function destroy() {
        btn.removeEventListener('click', onClick);
        host.innerHTML = '';
    }

    return { destroy };
}
