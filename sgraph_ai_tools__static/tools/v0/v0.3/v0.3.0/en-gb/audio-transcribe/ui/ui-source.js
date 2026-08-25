/**
 * ui-source — record button + dropzone + multi-select file input.
 *
 * Everything accumulates into the queue (source is not mutually exclusive with
 * files). All ingest goes through the SgToolApi (`api.addFiles` /
 * `api.startRecording` / `api.stopRecording`) so human + headless callers share
 * one path. The `accept` set includes the literal `.opus` extension.
 *
 * @module audio-transcribe/ui-source
 */

import { SAMPLES } from '../api/samples.js';

const ACCEPT = 'audio/*,.opus,.ogg,.oga,.m4a,.aac,.flac,.wav,.mp3,.webm';

/**
 * Mount the source panel.
 * @param {{ root: HTMLElement, state: object, api: object }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountSource({ root, api, getRecordingStream }) {
    root.innerHTML = `
        <h2 class="at-panel__title">Source</h2>
        <div class="at-dropzone" id="at-drop" tabindex="0" role="button"
             aria-label="Drop audio files here, or click to choose files">
            <div class="at-dropzone__icon">🎧</div>
            <div class="at-dropzone__primary">Drop audio files here (incl. WhatsApp .opus)</div>
            <div class="at-dropzone__secondary">or click to choose one or more files</div>
            <input type="file" id="at-file" accept="${ACCEPT}" multiple hidden>
        </div>
        <div class="at-record-row">
            <button type="button" class="at-btn primary" id="at-rec-btn">● Record</button>
            <span class="at-rec-timer" id="at-rec-timer" hidden>00:00</span>
        </div>
        <div class="at-viz" id="at-viz" hidden>
            <sg-audio-viz id="at-viz-el" mode="smooth-eq"></sg-audio-viz>
        </div>
        <div class="at-record-row">
            <label for="at-sample" style="font-size:0.85rem;color:#94a3b8;">Sample</label>
            <select class="at-select" id="at-sample">${SAMPLES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select>
            <button type="button" class="at-btn small" id="at-sample-load">Load sample</button>
        </div>
        <div class="at-meta-note">
            🔒 Decoding happens in your browser. Files are sent to OpenRouter only
            for transcription. Soft limit ~25 MB per file.
        </div>
        <div class="at-notice" id="at-notice" role="status" aria-live="polite"></div>
    `;

    const dz = root.querySelector('#at-drop');
    const input = root.querySelector('#at-file');
    const recBtn = root.querySelector('#at-rec-btn');
    const timer = root.querySelector('#at-rec-timer');
    const notice = root.querySelector('#at-notice');
    const sampleSel = root.querySelector('#at-sample');
    const sampleBtn = root.querySelector('#at-sample-load');
    const vizWrap = root.querySelector('#at-viz');
    const vizEl = root.querySelector('#at-viz-el');

    /** Start the live waveform (best-effort — recording works without it). */
    async function startViz() {
        try {
            const stream = getRecordingStream && getRecordingStream();
            if (!stream || !vizEl) return;
            vizWrap.hidden = false;
            if (vizEl.whenReady) await vizEl.whenReady();
            vizEl.setMode && vizEl.setMode('smooth-eq');
            if (vizEl.setSource) await vizEl.setSource(stream);
            vizEl.start && vizEl.start();
        } catch (_) { /* viz is decorative */ }
    }
    function stopViz() {
        try { vizEl && vizEl.stop && vizEl.stop(); } catch (_) { /* */ }
        if (vizWrap) vizWrap.hidden = true;
    }

    async function onLoadSample() {
        sampleBtn.disabled = true;
        try {
            const r = await api.loadSample({ id: sampleSel.value });
            showNotice(`Loaded sample (${(r && r.added && r.added.length) || 0})`, 'info');
        } catch (err) { showNotice(`Sample failed: ${err.message}`, 'error'); }
        finally { sampleBtn.disabled = false; }
    }
    sampleBtn.addEventListener('click', onLoadSample);

    let recording = false;
    let tick = null;
    let startedAt = 0;

    function showNotice(text, kind) {
        notice.textContent = text;
        notice.dataset.kind = kind || 'info';
        if (kind !== 'error') {
            setTimeout(() => { if (notice.textContent === text) notice.textContent = ''; }, 6000);
        }
    }

    async function addFiles(files) {
        if (!files || files.length === 0) return;
        try {
            const res = await api.addFiles({ files });
            const rejected = res.rejected || [];
            if (rejected.length) {
                const shown = rejected.slice(0, 4).map((r) => `${r.name} (${r.code})`).join(', ');
                showNotice(`Added ${res.added.length}; skipped ${rejected.length}: ${shown}`, 'warn');
            } else {
                showNotice(`Added ${res.added.length} file(s)`, 'info');
            }
        } catch (err) { showNotice(`Add failed: ${err.message}`, 'error'); }
    }

    function fmtTime(ms) {
        const s = Math.floor(ms / 1000);
        return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    async function toggleRecord() {
        if (!recording) {
            try {
                await api.startRecording({});
                recording = true;
                startedAt = Date.now();
                recBtn.textContent = '■ Stop';
                timer.hidden = false;
                timer.textContent = '00:00';
                tick = setInterval(() => { timer.textContent = fmtTime(Date.now() - startedAt); }, 250);
                startViz();
            } catch (err) { showNotice(`Record failed: ${err.message}`, 'error'); }
        } else {
            recBtn.disabled = true;
            try {
                const r = await api.stopRecording();
                showNotice(`Recorded ${r.name}`, 'info');
            } catch (err) { showNotice(`Stop failed: ${err.message}`, 'error'); }
            finally {
                stopViz();
                recording = false;
                recBtn.disabled = false;
                recBtn.textContent = '● Record';
                timer.hidden = true;
                if (tick) { clearInterval(tick); tick = null; }
            }
        }
    }

    function onPick() { input.click(); }
    function onKey(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }
    function onFileChange(e) { addFiles(e.target.files); try { input.value = ''; } catch (_) { /* */ } }
    function onDragOver(e) { e.preventDefault(); dz.classList.add('at-dropzone--drag'); }
    function onDragLeave() { dz.classList.remove('at-dropzone--drag'); }
    function onDrop(e) {
        e.preventDefault();
        dz.classList.remove('at-dropzone--drag');
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length) addFiles(dt.files);
    }

    dz.addEventListener('click', onPick);
    dz.addEventListener('keydown', onKey);
    input.addEventListener('change', onFileChange);
    dz.addEventListener('dragover', onDragOver);
    dz.addEventListener('dragenter', onDragOver);
    dz.addEventListener('dragleave', onDragLeave);
    dz.addEventListener('drop', onDrop);
    recBtn.addEventListener('click', toggleRecord);

    return {
        destroy() {
            if (tick) clearInterval(tick);
            try { vizEl && vizEl.destroy && vizEl.destroy(); } catch (_) { /* */ }
            dz.removeEventListener('click', onPick);
            dz.removeEventListener('keydown', onKey);
            input.removeEventListener('change', onFileChange);
            dz.removeEventListener('dragover', onDragOver);
            dz.removeEventListener('dragenter', onDragOver);
            dz.removeEventListener('dragleave', onDragLeave);
            dz.removeEventListener('drop', onDrop);
            recBtn.removeEventListener('click', toggleRecord);
        },
    };
}
