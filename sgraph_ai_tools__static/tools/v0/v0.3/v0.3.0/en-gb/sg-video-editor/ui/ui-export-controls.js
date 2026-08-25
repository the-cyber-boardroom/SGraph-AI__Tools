/** ui-export-controls.js — export button orchestrator.
 *
 * Round-9-I (Tasks 4 + 5). The export button has three states:
 *
 *   idle       → "Export MP4" button, click triggers an export.
 *   exporting  → "Exporting NN%" — disabled, fixed-width, L→R progress
 *                fill (Task 4). The width is pinned in JS at mount so
 *                "Export MP4" → "Exporting 100%" never reflows.
 *   done       → idle button is replaced by Download + Drag-out + a
 *                Re-export link (Task 5). Drag-out advertises both the
 *                SG-native MIME (`application/x-sg-asset`, JSON
 *                descriptor) AND a real File via DataTransferItemList,
 *                so the user can drop onto another SG tool, the
 *                desktop, or any plain file dropzone.
 *
 * The orchestrator owns the state machine and the host swap; the button
 * (idle/exporting) lives in ui-export-progress.js, the post-export
 * action row lives in ui-export-actions.js. Splitting kept this file
 * under 150 LOC.
 */

import { mountExportButton } from './ui-export-progress.js';
import { mountExportActions, extFor } from './ui-export-actions.js';

/**
 * Mount the export controls inside `host`. Returns a destroy handle.
 *
 * @param {{
 *   host: HTMLElement,
 *   onExport: (opts: {onProgress?: (info: {ratio: number}) => void})
 *     => Promise<{ blob: Blob, mimeType: string, sizeBytes: number, durationMs: number }>,
 * }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountExportControls({ host, onExport }) {
    let phase = 'idle'; // 'idle' | 'exporting' | 'done'
    let actions = null;
    let lastBlob = null;
    let lastMime = null;
    let lastFilename = null;
    let buttonHandle = null;

    /** Slot for the idle/exporting button. Cleared and re-mounted whenever
     *  we transition out of idle/exporting back into one of those states. */
    function mountButton() {
        if (buttonHandle) {
            try { buttonHandle.destroy(); } catch (_) {}
            buttonHandle = null;
        }
        host.innerHTML = '';
        buttonHandle = mountExportButton({ host });
        buttonHandle.button.addEventListener('click', onClickExport);
    }

    function setIdle() {
        phase = 'idle';
        if (actions) { try { actions.destroy(); } catch (_) {} actions = null; }
        mountButton();
        buttonHandle.setLabel('Export MP4');
        buttonHandle.setBusy(false);
        buttonHandle.setStatus('', false);
    }

    function setExporting(ratio = 0) {
        phase = 'exporting';
        if (!buttonHandle) mountButton();
        const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
        buttonHandle.setLabel(`Exporting ${pct}%`);
        buttonHandle.setProgress(ratio);
        buttonHandle.setBusy(true);
    }

    function setDone(blob, mime, filename) {
        phase = 'done';
        lastBlob = blob;
        lastMime = mime;
        lastFilename = filename;
        if (buttonHandle) { try { buttonHandle.destroy(); } catch (_) {} buttonHandle = null; }
        host.innerHTML = '';
        actions = mountExportActions({
            host, blob, mimeType: mime, filename,
            onReexport: () => setIdle(),
        });
    }

    async function onClickExport() {
        if (phase !== 'idle') return;
        if (typeof onExport !== 'function') return;
        setExporting(0);
        try {
            const onProgress = (info) => {
                const r = info && Number.isFinite(info.ratio) ? info.ratio : null;
                if (r != null && phase === 'exporting') setExporting(r);
            };
            const result = await onExport({ onProgress });
            const blob = result && result.blob;
            if (!(blob instanceof Blob)) throw new Error('export returned no blob');
            const mime = (result && result.mimeType) || blob.type || 'video/mp4';
            const filename = `sg-video-editor-${Date.now()}.${extFor(mime)}`;
            setDone(blob, mime, filename);
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            // Bounce back to idle but show the error in the status caption
            // so the user knows what happened (state-machine spec doesn't
            // need a fourth state for a one-shot transient error).
            setIdle();
            if (buttonHandle) buttonHandle.setStatus(`Error: ${msg}`, true);
        }
    }

    setIdle();

    /** Tear down listeners and clear host. */
    function destroy() {
        if (actions) { try { actions.destroy(); } catch (_) {} actions = null; }
        if (buttonHandle) { try { buttonHandle.destroy(); } catch (_) {} buttonHandle = null; }
        lastBlob = null; lastMime = null; lastFilename = null;
        host.innerHTML = '';
    }

    return { destroy };
}
