/**
 * ui-dropzone — drag-and-drop + file picker wiring.
 *
 * Files added here go through the SgToolApi (`api.addFiles({ files })`) so
 * the same code path applies to both human and headless callers.
 *
 * @module heic-converter/ui-dropzone
 */

/**
 * Render a dropzone + file picker into `root`.
 * @param {{root: HTMLElement, state: object, api: object}} opts
 * @returns {{destroy: () => void}}
 */
export function mountDropzone({ root, api }) {
    root.innerHTML = `
        <div class="hc-dropzone" id="hc-drop" tabindex="0" role="button"
             aria-label="Drop HEIC files here or click to choose">
            <div class="hc-dropzone__icon">⬇</div>
            <div class="hc-dropzone__primary">Drop HEIC / HEIF files here</div>
            <div class="hc-dropzone__secondary">or click to choose — multi-select supported</div>
            <input type="file" id="hc-file" accept=".heic,.heif,image/heic,image/heif" multiple hidden>
        </div>
        <div class="hc-dropzone__notice" id="hc-notice" role="status" aria-live="polite"></div>
    `;

    const dz = root.querySelector('#hc-drop');
    const input = root.querySelector('#hc-file');
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

    async function handleFiles(files) {
        if (!files || files.length === 0) return;
        try {
            const res = await api.addFiles({ files: Array.from(files) });
            const skipped = res.skipped || [];
            if (skipped.length > 0) {
                const reasons = skipped.map((s) => `${s.name} (${s.reason})`).join(', ');
                showNotice(`Skipped: ${reasons}`, 'warn');
            } else {
                showNotice(`Added ${res.added.length} file(s)`, 'info');
            }
        } catch (err) {
            showNotice(`Add failed: ${err.message}`, 'error');
        }
    }

    function onPick() { input.click(); }
    function onKey(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }
    function onChange(e) {
        handleFiles(e.target.files);
        // Reset so re-picking the same file fires another change event.
        try { input.value = ''; } catch (_) { /* ignore */ }
    }
    function onDragOver(e) { e.preventDefault(); dz.classList.add('hc-dropzone--drag'); }
    function onDragLeave() { dz.classList.remove('hc-dropzone--drag'); }
    function onDrop(e) {
        e.preventDefault();
        dz.classList.remove('hc-dropzone--drag');
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) handleFiles(dt.files);
    }

    dz.addEventListener('click', onPick);
    dz.addEventListener('keydown', onKey);
    input.addEventListener('change', onChange);
    dz.addEventListener('dragover', onDragOver);
    dz.addEventListener('dragenter', onDragOver);
    dz.addEventListener('dragleave', onDragLeave);
    dz.addEventListener('drop', onDrop);

    return {
        destroy() {
            dz.removeEventListener('click', onPick);
            dz.removeEventListener('keydown', onKey);
            input.removeEventListener('change', onChange);
            dz.removeEventListener('dragover', onDragOver);
            dz.removeEventListener('dragenter', onDragOver);
            dz.removeEventListener('dragleave', onDragLeave);
            dz.removeEventListener('drop', onDrop);
        },
    };
}
