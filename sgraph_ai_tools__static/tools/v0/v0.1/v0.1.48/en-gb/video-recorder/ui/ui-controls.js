/**
 * ui-controls.js
 * Mode selector, recording name input, record/stop/preview buttons,
 * timer, recording-size display, and advanced options.
 *
 * Post-recording downloads/share live in the per-recording tab (ui-recording-tab.js).
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
    { value: 'viz+audio',           label: '🎵 Audio Visualizer + Microphone',    needsCamera: false, needsScreen: false },
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

            <div class="ctrl-row" id="row-name">
                <label class="ctrl-label" for="rec-name">Recording name</label>
                <input id="rec-name" class="ctrl-select" type="text"
                       placeholder="e.g. Team Meeting"
                       autocomplete="off" spellcheck="false" />
            </div>

            <div class="ctrl-row" id="row-mode">
                <label class="ctrl-label" for="mode-select">Mode</label>
                <select id="mode-select" class="ctrl-select">
                    ${modeOptions}
                </select>
            </div>

            <div class="ctrl-row" id="row-viz-style" style="display:none">
                <label class="ctrl-label" for="viz-style-select">Viz style</label>
                <select id="viz-style-select" class="ctrl-select">
                    <option value="mirror-wave">Mirror Wave (ribbon)</option>
                    <option value="smooth-eq">Smooth EQ (filled spectrum)</option>
                    <option value="mirror-bars">Mirror Bars</option>
                    <option value="mirror-eq">Mirror EQ</option>
                    <option value="circular-bars">Circular Bars</option>
                    <option value="circular-wave">Circular Wave</option>
                    <option value="blob">Blob</option>
                    <option value="waveform">Waveform</option>
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

            <!-- Advanced options — open by default, collapsible -->
            <details class="ctrl-options" id="row-options" open>
                <summary class="ctrl-options__summary">Options</summary>
                <div class="ctrl-options__body">
                    <div class="ctrl-row">
                        <label class="ctrl-label ctrl-label--normal">Output streams — how many files are recorded</label>
                        <div class="ctrl-toggle-group" id="rec-mode-group">
                            <button class="ctrl-toggle" data-value="combined">1 stream</button>
                            <button class="ctrl-toggle" data-value="combined+separate">All streams</button>
                            <button class="ctrl-toggle" data-value="separate">Split</button>
                        </div>
                    </div>
                    <div class="ctrl-row">
                        <label class="ctrl-label">Quality</label>
                        <div class="ctrl-toggle-group" id="quality-group">
                            <button class="ctrl-toggle" data-value="1000000">1 Mbps</button>
                            <button class="ctrl-toggle" data-value="2500000">2.5 Mbps</button>
                            <button class="ctrl-toggle" data-value="5000000">5 Mbps</button>
                        </div>
                    </div>
                </div>
            </details>
        </section>
    `;

    const nameInput      = container.querySelector('#rec-name');
    const modeSelect     = container.querySelector('#mode-select');
    const vizStyleRow    = container.querySelector('#row-viz-style');
    const vizStyleSelect = container.querySelector('#viz-style-select');
    const recModeGroup   = container.querySelector('#rec-mode-group');
    const qualityGroup  = container.querySelector('#quality-group');
    const rowOptions    = container.querySelector('#row-options');
    const btnPreview    = container.querySelector('#btn-preview');
    const btnRecord     = container.querySelector('#btn-record');
    const btnStop       = container.querySelector('#btn-stop');
    const timerEl       = container.querySelector('#rec-timer');
    const statusEl      = container.querySelector('#ctrl-status');
    const recSize       = container.querySelector('#rec-size');

    modeSelect.value     = config.mode;
    vizStyleSelect.value = config.vizMode;
    let timerInterval    = null;

    // ── Recording name ────────────────────────────────────────────────────────

    nameInput.addEventListener('input', () => {
        config.recordingName = nameInput.value.trim();
    });

    // ── Recording mode toggle ─────────────────────────────────────────────────

    function _setRecMode(value) {
        config.recordingMode = value;
        recModeGroup.querySelectorAll('.ctrl-toggle').forEach(btn => {
            btn.classList.toggle('ctrl-toggle--active', btn.dataset.value === value);
        });
    }

    recModeGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.ctrl-toggle');
        if (!btn || btn.disabled) return;
        _setRecMode(btn.dataset.value);
    });

    _setRecMode(config.recordingMode);

    // ── Quality (video bitrate) toggle ────────────────────────────────────────

    function _setQuality(bps) {
        config.videoBitsPerSecond = bps;
        qualityGroup.querySelectorAll('.ctrl-toggle').forEach(btn => {
            btn.classList.toggle('ctrl-toggle--active', Number(btn.dataset.value) === bps);
        });
    }

    qualityGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.ctrl-toggle');
        if (!btn || btn.disabled) return;
        _setQuality(Number(btn.dataset.value));
    });

    _setQuality(config.videoBitsPerSecond);

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _modeHasCamera(mode) { return mode.includes('camera'); }

    function _updatePreviewBtn(mode) {
        btnPreview.style.display = _modeHasCamera(mode) ? '' : 'none';
    }

    function _updateVizRow(mode) {
        vizStyleRow.style.display = mode === 'viz+audio' ? '' : 'none';
    }

    function _resetPreviewBtn() {
        btnPreview.textContent = '👁 Preview';
        btnPreview.onclick     = null;
        btnPreview.disabled    = false;
        modeSelect.disabled    = false;
        btnRecord.disabled     = false;
    }

    function _enableOptions(enabled) {
        recModeGroup.querySelectorAll('.ctrl-toggle').forEach(b => { b.disabled = !enabled; });
        qualityGroup.querySelectorAll('.ctrl-toggle').forEach(b => { b.disabled = !enabled; });
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    _updatePreviewBtn(config.mode);
    _updateVizRow(config.mode);

    // ── Mode selector ─────────────────────────────────────────────────────────

    modeSelect.addEventListener('change', () => {
        config.mode = modeSelect.value;
        _updatePreviewBtn(config.mode);
        _updateVizRow(config.mode);
    });

    vizStyleSelect.addEventListener('change', () => {
        config.vizMode = vizStyleSelect.value;
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
        // Auto-reset if a recording was already stopped
        if (state.status === 'stopped') {
            api.newRecording();
        }

        btnRecord.disabled   = true;
        btnPreview.disabled  = true;
        btnStop.disabled     = false;
        modeSelect.disabled  = true;
        nameInput.disabled   = true;
        _enableOptions(false);
        statusEl.textContent = 'Starting…';
        btnPreview.textContent = '👁 Preview';
        btnPreview.onclick     = null;

        // Capture the name at recording start
        config.recordingName = nameInput.value.trim();

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
            nameInput.disabled   = false;
            _enableOptions(true);
            statusEl.textContent = `Error: ${err.message}`;
        }
    });

    // ── Stop ──────────────────────────────────────────────────────────────────

    btnStop.addEventListener('click', async () => {
        if (state.status !== 'recording') return;
        btnStop.disabled     = true;
        statusEl.textContent = 'Stopping…';
        try {
            await api.stopRecording();
        } catch (err) {
            statusEl.textContent = `Error: ${err.message}`;
            btnRecord.disabled   = false;
            modeSelect.disabled  = false;
            nameInput.disabled   = false;
        }
    });

    // ── RECORD_STOP ───────────────────────────────────────────────────────────

    window.addEventListener(SGA_RECORDER.RECORD_STOP, (e) => {
        clearInterval(timerInterval);
        timerInterval    = null;
        btnStop.disabled = true;
        btnRecord.disabled   = false;
        btnPreview.disabled  = false;
        modeSelect.disabled  = false;
        nameInput.disabled   = false;
        _enableOptions(true);

        const { durationMs, sizeBytes } = e.detail;
        statusEl.textContent = `Done — ${_formatMs(durationMs)}, ${_formatBytes(sizeBytes)}. Start new recording or review the tab.`;
    });

    // ── RESET ─────────────────────────────────────────────────────────────────

    window.addEventListener(SGA_RECORDER.RESET, () => {
        clearInterval(timerInterval);
        timerInterval = null;

        btnRecord.disabled     = false;
        btnPreview.disabled    = false;
        btnStop.disabled       = true;
        modeSelect.disabled    = false;
        nameInput.disabled     = false;
        _enableOptions(true);
        timerEl.textContent    = '0s';
        statusEl.textContent   = 'Ready';
        btnPreview.textContent = '👁 Preview';
        btnPreview.onclick     = null;
        _updatePreviewBtn(config.mode);
        if (recSize?.reset) recSize.reset();
    });

    // ── Live size update ──────────────────────────────────────────────────────

    window.addEventListener(SGA_RECORDER.RECORD_PROGRESS, (e) => {
        if (recSize?.update) recSize.update(e.detail.totalBytes);
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
