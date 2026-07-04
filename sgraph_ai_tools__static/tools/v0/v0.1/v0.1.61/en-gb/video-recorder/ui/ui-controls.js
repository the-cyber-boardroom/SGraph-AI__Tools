/**
 * ui-controls.js
 * 3-panel mode builder (Screen | Audio | Camera/Viz), recording name input,
 * record/stop buttons, timer, recording-size display, and advanced options.
 *
 * Mode is derived from three independent toggles:
 *   useScreen  — bool
 *   audioSource — 'none'|'mic'|'screen'
 *   camViz     — 'none' | 'camera' | 'viz'
 *
 * Post-recording downloads/share live in ui-recording-tab.js.
 * @module ui-controls
 */

import { isCameraSupported, isScreenSupported } from '/core/sg-capture/v0/v0.1/v0.1.1/sg-capture.js';
import { SGA_RECORDER } from '../api/recorder-events.js';

// ── Mode derivation ───────────────────────────────────────────────────────────

function _deriveMode(useScreen, audioSource, camViz) {
    const useAudio = audioSource !== 'none';
    if (camViz === 'viz')    return useScreen ? 'screen+viz+audio' : 'viz+audio';
    if (useScreen && camViz === 'camera' && useAudio) return 'camera+screen+audio';
    if (useScreen && camViz === 'camera')             return 'camera+screen';
    if (useScreen && useAudio)                        return 'screen+audio';
    if (useScreen)                                    return 'screen';
    if (camViz === 'camera' && useAudio)              return 'camera+audio';
    if (camViz === 'camera')                          return 'camera';
    if (useAudio)                                     return 'audio';
    return 'audio'; // fallback — must record something
}

/** Parse config.mode into screen + camera/viz toggle state. audioSource is read directly from config. */
function _parseModeState(mode) {
    return {
        useScreen: mode.includes('screen') && !mode.startsWith('viz'),
        camViz:    mode.includes('camera') ? 'camera' : (mode.includes('viz') ? 'viz' : 'none'),
    };
}

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
                <label class="ctrl-label">Mode</label>
                <div class="mode-builder" id="mode-builder">

                    <div class="mode-col" id="col-screen">
                        <div class="mode-col__hd">
                            <span class="mode-col__icon">🖥</span>
                            <span class="mode-col__name">Screen</span>
                        </div>
                        <button class="mode-col__toggle" id="toggle-screen"
                                ${!screenOk ? 'disabled title="Screen capture unsupported"' : ''}>Off</button>
                    </div>

                    <div class="mode-col" id="col-audio">
                        <div class="mode-col__hd">
                            <span class="mode-col__icon">🎙</span>
                            <span class="mode-col__name">Audio</span>
                        </div>
                        <div class="mode-col__opts" id="audio-opts">
                            <button class="mode-col__opt" data-audio="none">Off</button>
                            <button class="mode-col__opt" data-audio="mic">Mic</button>
                            <button class="mode-col__opt" data-audio="screen" id="audio-opt-screen"
                                    title="Captures audio from the tab or screen you share. Works best when sharing a browser tab — tick 'Share tab audio' in the picker.">Tab</button>
                        </div>
                    </div>

                    <div class="mode-col mode-col--cam" id="col-cam">
                        <div class="mode-col__hd">
                            <span class="mode-col__icon">📷</span>
                            <span class="mode-col__name">Camera / Viz</span>
                        </div>
                        <div class="mode-col__opts" id="cam-opts">
                            <button class="mode-col__opt" data-cam="none">Off</button>
                            <button class="mode-col__opt" data-cam="camera"
                                    ${!cameraOk ? 'disabled title="Camera unsupported"' : ''}>Camera</button>
                            <button class="mode-col__opt" data-cam="viz">Viz</button>
                        </div>
                    </div>

                </div>
            </div>

            <div class="ctrl-row" id="row-viz-style" style="display:none">
                <label class="ctrl-label" for="viz-style-select">Viz style</label>
                <select id="viz-style-select" class="ctrl-select">
                    <option value="smooth-eq">Smooth EQ (filled spectrum)</option>
                    <option value="mirror-eq">Mirror EQ</option>
                    <option value="mirror-wave">Mirror Wave (ribbon)</option>
                    <option value="mirror-bars">Mirror Bars</option>
                    <option value="circular-bars">Circular Bars</option>
                    <option value="circular-wave">Circular Wave</option>
                    <option value="blob">Blob</option>
                    <option value="waveform">Waveform</option>
                </select>
            </div>

            <div class="ctrl-row ctrl-row--actions" id="row-actions">
                <button id="btn-preview" class="ctrl-btn ctrl-btn--preview" style="display:none">
                    👁 Preview
                </button>
                <button id="btn-record" class="ctrl-btn ctrl-btn--record">
                    ● Start Recording
                </button>
                <button id="btn-pause" class="ctrl-btn ctrl-btn--pause" style="display:none" disabled>
                    ⏸ Pause
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
                    <div class="ctrl-row" id="row-layout" style="display:none">
                        <label class="ctrl-label">Layout <span style="font-size:0.8em;color:#64748b">(screen+camera only)</span></label>
                        <div class="ctrl-toggle-group" id="layout-group">
                            <button class="ctrl-toggle" data-value="landscape">Landscape</button>
                            <button class="ctrl-toggle" data-value="shorts">Vertical (Shorts 9:16)</button>
                        </div>
                    </div>
                </div>
            </details>
        </section>
    `;

    // ── DOM refs ──────────────────────────────────────────────────────────────

    const nameInput      = container.querySelector('#rec-name');
    const toggleScreen   = container.querySelector('#toggle-screen');
    const audioOpts      = container.querySelector('#audio-opts');
    const audioOptScreen = container.querySelector('#audio-opt-screen');
    const camOpts        = container.querySelector('#cam-opts');
    const vizStyleRow    = container.querySelector('#row-viz-style');
    const vizStyleSelect = container.querySelector('#viz-style-select');
    const recModeGroup   = container.querySelector('#rec-mode-group');
    const qualityGroup   = container.querySelector('#quality-group');
    const layoutRow      = container.querySelector('#row-layout');
    const layoutGroup    = container.querySelector('#layout-group');
    const btnPreview     = container.querySelector('#btn-preview');
    const btnRecord      = container.querySelector('#btn-record');
    const btnPause       = container.querySelector('#btn-pause');
    const btnStop        = container.querySelector('#btn-stop');
    const timerEl        = container.querySelector('#rec-timer');
    const statusEl       = container.querySelector('#ctrl-status');
    const recSize        = container.querySelector('#rec-size');

    let timerInterval = null;

    // Render the elapsed timer from the wall clock (minus paused time) rather than by
    // counting ticks. A tick counter under-reports when the recorder tab is hidden —
    // Chrome throttles the interval to <=1Hz — which is what made the display read
    // 119s for a 233s recording. Reading state.startedAt each tick is always correct,
    // and snaps to the true value the moment the tab regains focus.
    function _renderTimer() {
        if (!state.startedAt) { timerEl.textContent = '0s'; return; }
        let paused = state.pausedDurationMs;
        if (state.status === 'paused' && state.lastPausedAt) {
            paused += Date.now() - state.lastPausedAt;
        }
        const s = Math.max(0, Math.floor((Date.now() - state.startedAt - paused) / 1000));
        timerEl.textContent = `${s}s`;
    }

    // ── Mode builder state ────────────────────────────────────────────────────

    let { useScreen, camViz } = _parseModeState(config.mode);
    let audioSource = config.audioSource ?? 'mic';

    function _applyModeState() {
        // Auto-revert Tab audio to Mic when Screen is turned off
        if (!useScreen && audioSource === 'screen') {
            audioSource        = 'mic';
            config.audioSource = 'mic';
        }

        config.mode        = _deriveMode(useScreen, audioSource, camViz);
        config.audioSource = audioSource;

        toggleScreen.textContent = useScreen ? 'On' : 'Off';
        toggleScreen.classList.toggle('mode-col__toggle--on', useScreen);

        // Audio 3-state: highlight active option; disable Tab when Screen is off
        audioOpts.querySelectorAll('.mode-col__opt').forEach(btn => {
            btn.classList.toggle('mode-col__opt--active', btn.dataset.audio === audioSource);
        });
        audioOptScreen.disabled = !useScreen;

        camOpts.querySelectorAll('.mode-col__opt').forEach(btn => {
            btn.classList.toggle('mode-col__opt--active', btn.dataset.cam === camViz);
        });

        vizStyleRow.style.display  = camViz === 'viz' ? '' : 'none';
        btnPreview.style.display   = camViz === 'camera' ? '' : 'none';

        // Layout toggle: only meaningful when both screen and camera are active
        const isScreenAndCamera = useScreen && camViz === 'camera';
        layoutRow.style.display = isScreenAndCamera ? '' : 'none';
        if (!isScreenAndCamera && config.layout !== 'landscape') {
            _setLayout('landscape');
        }
    }

    function _setLayout(value) {
        config.layout = value;
        layoutGroup.querySelectorAll('.ctrl-toggle').forEach(btn => {
            btn.classList.toggle('ctrl-toggle--active', btn.dataset.value === value);
        });
    }

    vizStyleSelect.value = config.vizMode;
    _applyModeState();

    toggleScreen.addEventListener('click', () => {
        if (toggleScreen.disabled) return;
        useScreen = !useScreen;
        _applyModeState();
    });

    audioOpts.addEventListener('click', (e) => {
        const btn = e.target.closest('.mode-col__opt');
        if (!btn || btn.disabled) return;
        audioSource = btn.dataset.audio;
        _applyModeState();
    });

    camOpts.addEventListener('click', (e) => {
        const btn = e.target.closest('.mode-col__opt');
        if (!btn || btn.disabled) return;
        camViz = btn.dataset.cam;
        _applyModeState();
    });

    vizStyleSelect.addEventListener('change', () => {
        config.vizMode = vizStyleSelect.value;
    });

    // ── Layout toggle (screen+camera only) ────────────────────────────────────

    layoutGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.ctrl-toggle');
        if (!btn) return;
        _setLayout(btn.dataset.value);
    });
    _setLayout(config.layout);

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

    // ── Quality toggle ────────────────────────────────────────────────────────

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

    function _enableOptions(enabled) {
        recModeGroup.querySelectorAll('.ctrl-toggle').forEach(b => { b.disabled = !enabled; });
        qualityGroup.querySelectorAll('.ctrl-toggle').forEach(b => { b.disabled = !enabled; });
    }

    function _lockModeBuilder(locked) {
        toggleScreen.disabled = locked || !screenOk;
        audioOpts.querySelectorAll('.mode-col__opt').forEach(b => {
            // Tab button has an extra disabled condition (Screen must be on) — preserve that when unlocking
            b.disabled = locked || (b.dataset.audio === 'screen' && !useScreen);
        });
        camOpts.querySelectorAll('.mode-col__opt').forEach(b => {
            b.disabled = locked || (b.dataset.cam === 'camera' && !cameraOk);
        });
    }

    // ── Preview ───────────────────────────────────────────────────────────────
    //
    // Single addEventListener; _previewActive boolean tracks state.
    // The old pattern mixed onclick assignment with addEventListener which caused
    // both handlers to fire on every click.

    let _previewActive = false;

    function _resetPreviewBtn() {
        _previewActive         = false;
        btnPreview.textContent = '👁 Preview';
        btnPreview.disabled    = false;
    }

    btnPreview.addEventListener('click', async () => {
        if (_previewActive) {
            api.stopPreview();
            _resetPreviewBtn();
            btnRecord.disabled   = false;
            _lockModeBuilder(false);
            statusEl.textContent = 'Ready';
            return;
        }

        _previewActive       = true;
        btnPreview.disabled  = true;
        btnRecord.disabled   = true;
        _lockModeBuilder(true);
        statusEl.textContent = 'Requesting permissions…';

        try {
            await api.startPreview();
            btnPreview.textContent = '✕ Stop Preview';
            btnPreview.disabled    = false;
            btnRecord.disabled     = false;
            statusEl.textContent   = 'Preview active — click Start Recording';
        } catch (err) {
            _resetPreviewBtn();
            btnRecord.disabled   = false;
            _lockModeBuilder(false);
            statusEl.textContent = `Error: ${err.message}`;
        }
    });

    // ── Record ────────────────────────────────────────────────────────────────

    btnRecord.addEventListener('click', async () => {
        if (state.status === 'stopped') api.newRecording();

        btnRecord.disabled     = true;
        btnPreview.disabled    = true;
        btnStop.disabled       = false;
        _lockModeBuilder(true);
        nameInput.disabled     = true;
        _enableOptions(false);
        statusEl.textContent   = 'Starting…';
        _resetPreviewBtn();

        config.recordingName = nameInput.value.trim();

        try {
            await api.startRecording({ format: config.format });

            _renderTimer();
            timerInterval = setInterval(_renderTimer, 1000);

            btnPause.style.display = '';
            btnPause.disabled      = false;
            btnPause.textContent   = '⏸ Pause';
            btnPause.classList.remove('is-paused');

            if (recSize?.reset) recSize.reset();
            statusEl.textContent = 'Recording…';
        } catch (err) {
            btnRecord.disabled   = false;
            btnPreview.disabled  = false;
            btnStop.disabled     = true;
            _lockModeBuilder(false);
            nameInput.disabled   = false;
            _enableOptions(true);
            statusEl.textContent = `Error: ${err.message}`;
        }
    });

    // ── Stop ──────────────────────────────────────────────────────────────────

    btnStop.addEventListener('click', async () => {
        if (state.status !== 'recording' && state.status !== 'paused') return;
        btnStop.disabled     = true;
        btnPause.disabled    = true;
        statusEl.textContent = 'Stopping…';
        try {
            await api.stopRecording();
        } catch (err) {
            statusEl.textContent = `Error: ${err.message}`;
            btnRecord.disabled   = false;
            nameInput.disabled   = false;
        }
    });

    // ── Pause / Resume ────────────────────────────────────────────────────────

    btnPause.addEventListener('click', () => {
        if (state.status === 'recording') {
            api.pauseRecording();
        } else if (state.status === 'paused') {
            api.resumeRecording();
        }
    });

    window.addEventListener(SGA_RECORDER.RECORD_PAUSE, () => {
        clearInterval(timerInterval);
        timerInterval        = null;
        _renderTimer();  // freeze the display at the correct paused value
        btnPause.textContent = '▶ Resume';
        btnPause.classList.add('is-paused');
        statusEl.style.color = '#d97706';
        statusEl.textContent = 'Paused';
    });

    window.addEventListener(SGA_RECORDER.RECORD_RESUME, () => {
        timerInterval = setInterval(_renderTimer, 1000);
        btnPause.textContent = '⏸ Pause';
        btnPause.classList.remove('is-paused');
        statusEl.style.color = '';
        statusEl.textContent = 'Recording…';
    });

    // ── TRACK_LOST — show immediate warning banner ────────────────────────────

    window.addEventListener(SGA_RECORDER.TRACK_LOST, (e) => {
        const { source, kind } = e.detail;
        if (kind === 'video') {
            // Video loss is fatal — pipeline will auto-stop; warn the user now
            // so they're not confused by the recording ending unexpectedly.
            statusEl.style.color = '#f87171';
            statusEl.textContent =
                `⚠ ${source} video stopped unexpectedly — recording is saving now.`;
        } else {
            // Audio loss: recording continues but user should know
            statusEl.style.color = '#fbbf24';
            statusEl.textContent =
                `⚠ ${source} audio track lost — recording continues without audio.`;
        }
    });

    // ── ERROR — show immediate banner; pipeline will auto-stop ────────────────

    window.addEventListener(SGA_RECORDER.ERROR, (e) => {
        if (state.status !== 'recording') return;
        const { step, message } = e.detail;
        statusEl.style.color = '#f87171';
        statusEl.textContent = `⚠ Recorder error (${step}): ${message} — saving what was captured.`;
    });

    // ── RECORD_STOP ───────────────────────────────────────────────────────────

    window.addEventListener(SGA_RECORDER.RECORD_STOP, (e) => {
        clearInterval(timerInterval);
        timerInterval          = null;
        btnStop.disabled       = true;
        btnPause.style.display = 'none';
        btnPause.disabled      = true;
        btnPause.textContent   = '⏸ Pause';
        btnPause.classList.remove('is-paused');
        btnRecord.disabled = false;
        _lockModeBuilder(false);
        nameInput.disabled = false;
        _enableOptions(true);
        _applyModeState();
        const { durationMs, sizeBytes } = e.detail;
        statusEl.style.color = '';
        statusEl.textContent = `Done — ${_formatMs(durationMs)}, ${_formatBytes(sizeBytes)}. Start new recording or review the tab.`;
    });

    // ── RESET ─────────────────────────────────────────────────────────────────

    window.addEventListener(SGA_RECORDER.RESET, () => {
        clearInterval(timerInterval);
        timerInterval          = null;
        btnRecord.disabled     = false;
        btnStop.disabled       = true;
        btnPause.style.display = 'none';
        btnPause.disabled      = true;
        btnPause.textContent   = '⏸ Pause';
        btnPause.classList.remove('is-paused');
        nameInput.disabled     = false;
        _lockModeBuilder(false);
        _enableOptions(true);
        timerEl.textContent  = '0s';
        statusEl.style.color = '';
        statusEl.textContent = 'Ready';
        _resetPreviewBtn();
        _applyModeState();
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
