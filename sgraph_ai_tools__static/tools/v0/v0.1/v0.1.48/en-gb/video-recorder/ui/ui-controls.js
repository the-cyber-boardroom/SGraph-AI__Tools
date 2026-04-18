/**
 * ui-controls.js
 * Mode selector, record/stop/preview buttons, timer, recording-size display,
 * and per-track download + new-recording buttons after stop.
 * @module ui-controls
 */

import { isCameraSupported, isScreenSupported } from '/core/sg-capture/v0/v0.1/v0.1.0/sg-capture.js';
import { SGA_RECORDER } from '../api/recorder-events.js';

const MODES = [
    { value: 'audio',               label: '🎙 Microphone only',                   needsCamera: false, needsScreen: false },
    { value: 'camera',              label: '📷 Camera only (silent)',               needsCamera: true,  needsScreen: false },
    { value: 'screen',              label: '🖥 Screen only (silent)',               needsCamera: false, needsScreen: true  },
    { value: 'camera+audio',        label: '🎥 Camera + Microphone',               needsCamera: true,  needsScreen: false },
    { value: 'screen+audio',        label: '🖥🎙 Screen + Microphone',             needsCamera: false, needsScreen: true  },
    { value: 'camera+screen',       label: '📷🖥 Camera + Screen (silent)',        needsCamera: true,  needsScreen: true  },
    { value: 'camera+screen+audio', label: '🎥🖥🎙 Camera + Screen + Microphone', needsCamera: true,  needsScreen: true  },
];

/**
 * @param {HTMLElement} container
 * @param {import('../api/recorder-state.js').RecordingState}  state
 * @param {import('../api/recorder-state.js').RecordingConfig} config
 * @param {object} api
 * @param {Function} emit
 */
export function initControls(container, state, config, api, emit) {
    const cameraOk = isCameraSupported();
    const screenOk = isScreenSupported();

    const modeOptions = MODES.map(m => {
        const disabled = (m.needsCamera && !cameraOk) || (m.needsScreen && !screenOk);
        return `<option value="${m.value}" ${disabled ? 'disabled' : ''}>${m.label}${disabled ? ' (unsupported)' : ''}</option>`;
    }).join('');

    container.innerHTML = `
        <section class="ctrl-panel">
            <h2 class="ctrl-panel__title">Recording</h2>

            <div class="ctrl-row" id="row-mode">
                <label class="ctrl-label" for="mode-select">Mode</label>
                <select id="mode-select" class="ctrl-select">
                    ${modeOptions}
                </select>
            </div>

            <div class="ctrl-row ctrl-row--actions" id="row-actions">
                <button id="btn-preview" class="ctrl-btn ctrl-btn--preview">
                    👁 Preview
                </button>
                <button id="btn-record" class="ctrl-btn ctrl-btn--record">
                    ● Start Recording
                </button>
                <button id="btn-stop" class="ctrl-btn ctrl-btn--stop" disabled>
                    ■ Stop
                </button>
            </div>

            <div class="ctrl-row ctrl-row--status" id="row-status">
                <span class="ctrl-timer" id="rec-timer">0s</span>
                <sg-recording-size id="rec-size" threshold-mb="500" warn-at-percent="80" label="Size"></sg-recording-size>
            </div>

            <div class="ctrl-row">
                <span class="ctrl-status" id="ctrl-status">Ready</span>
            </div>

            <!-- Post-recording download buttons — shown per available track -->
            <div class="ctrl-row ctrl-row--post" id="row-post" style="display:none">
                <button id="btn-dl-screen" class="ctrl-btn ctrl-btn--download" style="display:none">
                    ⬇ Screen (WebM)
                </button>
                <button id="btn-dl-camera" class="ctrl-btn ctrl-btn--download ctrl-btn--download-sec" style="display:none">
                    ⬇ Camera (WebM)
                </button>
                <button id="btn-dl-audio" class="ctrl-btn ctrl-btn--download ctrl-btn--download-sec" style="display:none">
                    ⬇ Audio (WebM)
                </button>
                <button id="btn-new-recording" class="ctrl-btn ctrl-btn--new">
                    ↺ New Recording
                </button>
            </div>
        </section>
    `;

    const modeSelect  = container.querySelector('#mode-select');
    const btnPreview  = container.querySelector('#btn-preview');
    const btnRecord   = container.querySelector('#btn-record');
    const btnStop     = container.querySelector('#btn-stop');
    const timerEl     = container.querySelector('#rec-timer');
    const statusEl    = container.querySelector('#ctrl-status');
    const recSize     = container.querySelector('#rec-size');
    const rowActions  = container.querySelector('#row-actions');
    const rowMode     = container.querySelector('#row-mode');
    const rowStatus   = container.querySelector('#row-status');
    const rowPost     = container.querySelector('#row-post');
    const btnDlScreen = container.querySelector('#btn-dl-screen');
    const btnDlCamera = container.querySelector('#btn-dl-camera');
    const btnDlAudio  = container.querySelector('#btn-dl-audio');
    const btnNew      = container.querySelector('#btn-new-recording');

    modeSelect.value = config.mode;
    let timerInterval = null;

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _modeHasCamera(mode) { return mode.includes('camera'); }

    function _updatePreviewBtn(mode) {
        // Preview is only meaningful for camera modes (getDisplayMedia can't preview)
        btnPreview.style.display = _modeHasCamera(mode) ? '' : 'none';
    }

    function _makeDownloadHandler(blobFn, filenameFn) {
        return () => {
            const blob = blobFn();
            if (!blob) return;
            const a    = document.createElement('a');
            a.href     = URL.createObjectURL(blob);
            a.download = filenameFn();
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        };
    }

    function _resetPreviewBtn() {
        btnPreview.textContent = '👁 Preview';
        btnPreview.onclick     = null;
        btnPreview.disabled    = false;
        modeSelect.disabled    = false;
        btnRecord.disabled     = false;
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    _updatePreviewBtn(config.mode);

    // ── Mode selector ─────────────────────────────────────────────────────────

    modeSelect.addEventListener('change', () => {
        config.mode = modeSelect.value;
        _updatePreviewBtn(config.mode);
    });

    // ── Preview ──────────────────────────────────────────────────────────────

    btnPreview.addEventListener('click', async () => {
        btnPreview.disabled  = true;
        btnRecord.disabled   = true;
        modeSelect.disabled  = true;
        statusEl.textContent = 'Requesting permissions…';

        try {
            await api.startPreview();
            btnPreview.textContent = '✕ Stop Preview';
            btnPreview.disabled    = false;
            btnRecord.disabled     = false;
            statusEl.textContent   = 'Preview active — click Start Recording';

            btnPreview.onclick = () => {
                api.stopPreview();
                _resetPreviewBtn();
                statusEl.textContent = 'Ready';
            };
        } catch (err) {
            btnPreview.disabled  = false;
            btnRecord.disabled   = false;
            modeSelect.disabled  = false;
            statusEl.textContent = `Error: ${err.message}`;
        }
    });

    // ── Record ────────────────────────────────────────────────────────────────

    btnRecord.addEventListener('click', async () => {
        btnRecord.disabled   = true;
        btnPreview.disabled  = true;
        btnStop.disabled     = false;
        modeSelect.disabled  = true;
        statusEl.textContent = 'Starting…';
        btnPreview.textContent = '👁 Preview';
        btnPreview.onclick     = null;

        try {
            await api.startRecording({ format: config.format });

            let elapsed = 0;
            timerEl.textContent = '0s';
            timerInterval = setInterval(() => {
                elapsed++;
                timerEl.textContent = `${elapsed}s`;
            }, 1000);

            if (recSize?.reset) recSize.reset();
            statusEl.textContent = 'Recording…';
        } catch (err) {
            btnRecord.disabled   = false;
            btnPreview.disabled  = false;
            btnStop.disabled     = true;
            modeSelect.disabled  = false;
            statusEl.textContent = `Error: ${err.message}`;
        }
    });

    // ── Stop ──────────────────────────────────────────────────────────────────

    btnStop.addEventListener('click', async () => {
        btnStop.disabled     = true;
        statusEl.textContent = 'Stopping…';
        clearInterval(timerInterval);
        timerInterval = null;

        try {
            const result = await api.stopRecording();
            statusEl.textContent = `Done — ${_formatMs(result.durationMs)}, ${_formatBytes(result.sizeBytes)}`;

            // Show post-recording UI with per-track download buttons
            rowActions.style.display = 'none';
            rowMode.style.display    = 'none';
            rowStatus.style.display  = 'none';
            rowPost.style.display    = '';

            const ts = Date.now();
            if (state.blobs.screen) {
                btnDlScreen.style.display = '';
                btnDlScreen.onclick = _makeDownloadHandler(
                    () => state.blobs.screen,
                    () => `screen-${ts}.webm`,
                );
            }
            if (state.blobs.camera) {
                btnDlCamera.style.display = '';
                btnDlCamera.onclick = _makeDownloadHandler(
                    () => state.blobs.camera,
                    () => `camera-${ts}.webm`,
                );
            }
            if (state.blobs.audio) {
                btnDlAudio.style.display = '';
                btnDlAudio.onclick = _makeDownloadHandler(
                    () => state.blobs.audio,
                    () => `audio-${ts}.webm`,
                );
            }
        } catch (err) {
            statusEl.textContent = `Error: ${err.message}`;
            btnRecord.disabled   = false;
            modeSelect.disabled  = false;
        }
    });

    // ── New Recording ─────────────────────────────────────────────────────────

    btnNew.addEventListener('click', () => { api.newRecording(); });

    window.addEventListener(SGA_RECORDER.RESET, () => {
        rowPost.style.display    = 'none';
        rowActions.style.display = '';
        rowMode.style.display    = '';
        rowStatus.style.display  = '';

        btnDlScreen.style.display = 'none';
        btnDlCamera.style.display = 'none';
        btnDlAudio.style.display  = 'none';

        btnRecord.disabled    = false;
        btnPreview.disabled   = false;
        btnStop.disabled      = true;
        modeSelect.disabled   = false;
        timerEl.textContent   = '0s';
        statusEl.textContent  = 'Ready';
        btnPreview.textContent = '👁 Preview';
        btnPreview.onclick     = null;
        _updatePreviewBtn(config.mode);
        if (recSize?.reset) recSize.reset();
    });

    // ── Wire sg-recording-size to primary MediaRecorder ───────────────────────

    window.addEventListener(SGA_RECORDER.RECORD_START, () => {
        if (recSize?.attach && state.mediaRecorder) {
            recSize.attach(state.mediaRecorder);
        }
    });
}

function _formatMs(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function _formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
