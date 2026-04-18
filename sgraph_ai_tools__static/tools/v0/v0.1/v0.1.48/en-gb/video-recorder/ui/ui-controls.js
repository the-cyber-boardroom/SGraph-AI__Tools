/**
 * ui-controls.js
 * Mode selector, record/stop button, elapsed timer, and recording-size display.
 * @module ui-controls
 */

import { isCameraSupported, isScreenSupported } from '/core/sg-capture/v0/v0.1/v0.1.0/sg-capture.js';
import { SGA_RECORDER } from '../api/recorder-events.js';

const MODES = [
    { value: 'audio',               label: '🎙 Audio only',            needsCamera: false, needsScreen: false },
    { value: 'camera',              label: '📷 Camera only',           needsCamera: true,  needsScreen: false },
    { value: 'screen',              label: '🖥 Screen only',           needsCamera: false, needsScreen: true  },
    { value: 'camera+audio',        label: '🎥 Camera + Audio',        needsCamera: true,  needsScreen: false },
    { value: 'screen+audio',        label: '🖥🎙 Screen + Audio',      needsCamera: false, needsScreen: true  },
    { value: 'camera+screen',       label: '📷🖥 Camera + Screen',     needsCamera: true,  needsScreen: true  },
    { value: 'camera+screen+audio', label: '🎥🖥🎙 Full (PiP + Audio)', needsCamera: true, needsScreen: true  },
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

            <div class="ctrl-row">
                <label class="ctrl-label" for="mode-select">Mode</label>
                <select id="mode-select" class="ctrl-select">
                    ${modeOptions}
                </select>
            </div>

            <div class="ctrl-row ctrl-row--actions">
                <button id="btn-record" class="ctrl-btn ctrl-btn--record">
                    ● Start Recording
                </button>
                <button id="btn-stop" class="ctrl-btn ctrl-btn--stop" disabled>
                    ■ Stop
                </button>
            </div>

            <div class="ctrl-row ctrl-row--status">
                <span class="ctrl-timer" id="rec-timer">0s</span>
                <sg-recording-size id="rec-size" threshold-mb="500" warn-at-percent="80" label="Size"></sg-recording-size>
            </div>

            <div class="ctrl-row">
                <span class="ctrl-status" id="ctrl-status">Ready</span>
            </div>
        </section>
    `;

    const modeSelect = container.querySelector('#mode-select');
    const btnRecord  = container.querySelector('#btn-record');
    const btnStop    = container.querySelector('#btn-stop');
    const timerEl    = container.querySelector('#rec-timer');
    const statusEl   = container.querySelector('#ctrl-status');
    const recSize    = container.querySelector('#rec-size');

    // Set initial mode value
    modeSelect.value = config.mode;

    let timerInterval = null;

    modeSelect.addEventListener('change', () => {
        config.mode = modeSelect.value;
    });

    // ── Record button — must call startRecording directly (user gesture for screen) ──

    btnRecord.addEventListener('click', async () => {
        btnRecord.disabled = true;
        btnStop.disabled   = false;
        modeSelect.disabled = true;
        statusEl.textContent = 'Starting…';

        try {
            await api.startRecording({ format: config.format });

            let elapsed = 0;
            timerEl.textContent = '0s';
            timerInterval = setInterval(() => {
                elapsed++;
                timerEl.textContent = `${elapsed}s`;
            }, 1000);

            if (recSize?.reset) recSize.reset();
            statusEl.textContent = 'Recording';
        } catch (err) {
            btnRecord.disabled  = false;
            btnStop.disabled    = true;
            modeSelect.disabled = false;
            statusEl.textContent = `Error: ${err.message}`;
        }
    });

    btnStop.addEventListener('click', async () => {
        btnStop.disabled = true;
        statusEl.textContent = 'Stopping…';

        clearInterval(timerInterval);
        timerInterval = null;

        try {
            const result = await api.stopRecording();
            statusEl.textContent = `Stopped — ${_formatMs(result.durationMs)}, ${_formatBytes(result.sizeBytes)}`;
        } catch (err) {
            statusEl.textContent = `Error: ${err.message}`;
        } finally {
            btnRecord.disabled  = false;
            modeSelect.disabled = false;
        }
    });

    // Wire recording-size component once MediaRecorder is active
    window.addEventListener(SGA_RECORDER.RECORD_START, () => {
        // The MediaRecorder lives in sg-video-recorder module state — we can't access it
        // directly, so sg-recording-size is driven by a custom event bridge in recorder-pipeline
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
