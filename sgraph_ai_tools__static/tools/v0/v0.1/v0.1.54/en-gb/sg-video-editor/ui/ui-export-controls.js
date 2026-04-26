/** ui-export-controls.js — export button + status + download trigger.
 *
 * Round-9-I Task 4: the button is now fixed-width + carries an inline
 * progress bar. The width-pinning + progress fill machinery lives in
 * ui-export-progress.js so this file only owns the click handler and
 * the post-success download trigger.
 */

import { mountExportButton } from './ui-export-progress.js';

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
    const handle = mountExportButton({ host });
    const { button, setLabel, setProgress, setBusy, setStatus } = handle;

    function showProgress(ratio) {
        const r = Math.max(0, Math.min(1, Number(ratio) || 0));
        setLabel(`Exporting ${Math.round(r * 100)}%`);
        setProgress(r);
    }

    async function onClick() {
        if (typeof onExport !== 'function') return;
        setBusy(true);
        showProgress(0);
        setStatus('', false);
        try {
            const onProgress = (info) => {
                const r = info && Number.isFinite(info.ratio) ? info.ratio : null;
                if (r != null) showProgress(r);
            };
            const result = await onExport({ onProgress });
            const blob = result && result.blob;
            if (!(blob instanceof Blob)) throw new Error('export returned no blob');
            const mime = (result && result.mimeType) || blob.type || 'video/mp4';
            const filename = `sg-video-editor-${Date.now()}.${extFor(mime)}`;
            downloadBlob(blob, filename);
            setLabel('Export MP4');
            setProgress(0);
            setStatus('Done', true);
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            setLabel('Export MP4');
            setProgress(0);
            setStatus(`Error: ${msg}`, true);
        } finally {
            setBusy(false);
        }
    }

    button.addEventListener('click', onClick);

    /** Tear down listeners and clear host. */
    function destroy() {
        button.removeEventListener('click', onClick);
        try { handle.destroy(); } catch (_) {}
    }

    return { destroy };
}
