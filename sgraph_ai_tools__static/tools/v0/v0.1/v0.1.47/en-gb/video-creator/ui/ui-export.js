/**
 * ui-export.js
 * Record / Generate Audio / Download controls and status display.
 *
 * @module ui-export
 */

/**
 * @param {PipelineState} state
 * @param {SgToolApi}     api
 * @param {function}      emit
 */
export function initExport(state, api, emit) {
    const panel = document.getElementById('vc-export-panel');
    panel.innerHTML = `
        <div class="vc-section-header"><span>Export</span></div>

        <div class="vc-export-controls">
            <div class="vc-config-row">
                <label for="vc-voice-select">Voice</label>
                <select id="vc-voice-select"></select>
            </div>
            <div class="vc-config-row">
                <label for="vc-speed-range">Speed <span id="vc-speed-val">1.0×</span></label>
                <input type="range" id="vc-speed-range" min="0.5" max="2.0" step="0.1" value="1.0">
            </div>
            <div class="vc-config-row">
                <label for="vc-fps-select">FPS</label>
                <select id="vc-fps-select">
                    <option value="24">24 fps</option>
                    <option value="30" selected>30 fps</option>
                    <option value="60">60 fps</option>
                </select>
            </div>
        </div>

        <div class="vc-action-buttons">
            <button id="btn-load-model"  class="btn-secondary">Load TTS Model</button>
            <button id="btn-gen-audio"   class="btn-primary"   disabled>Generate Audio</button>
            <button id="btn-record"      class="btn-primary"   disabled>Record Video</button>
            <button id="btn-download"    class="btn-success"   disabled>Download WebM</button>
        </div>

        <div id="vc-export-log" class="vc-export-log"></div>
    `;

    const btnLoad     = document.getElementById('btn-load-model');
    const btnGenAudio = document.getElementById('btn-gen-audio');
    const btnRecord   = document.getElementById('btn-record');
    const btnDownload = document.getElementById('btn-download');
    const voiceSelect = document.getElementById('vc-voice-select');
    const speedRange  = document.getElementById('vc-speed-range');
    const speedVal    = document.getElementById('vc-speed-val');
    const fpsSelect   = document.getElementById('vc-fps-select');

    // Populate voices (may update after model loads)
    _populateVoices(voiceSelect, state.config.voice);

    speedRange.addEventListener('input', () => {
        const v = parseFloat(speedRange.value).toFixed(1);
        speedVal.textContent = `${v}×`;
        api.setConfig({ speed: parseFloat(v) });
    });

    voiceSelect.addEventListener('change', () => api.setConfig({ voice: voiceSelect.value }));
    fpsSelect.addEventListener('change', () => api.setConfig({ fps: parseInt(fpsSelect.value, 10) }));

    // Load model
    btnLoad.addEventListener('click', async () => {
        btnLoad.disabled = true;
        btnLoad.textContent = 'Loading model…';
        _log('Loading Kokoro TTS model (first load ~160 MB)…');
        try {
            const { loadTTS, listVoices } = await import('/core/sg-tts/v0/v0.1/v0.1.0/sg-tts.js');
            await loadTTS({ voice: state.config.voice, poolSize: 4,
                onProgress: ({ workerIndex, message }) => _log(`Worker[${workerIndex}]: ${message}`) });
            _populateVoices(voiceSelect, state.config.voice, listVoices());
            btnGenAudio.disabled = state.slides.length === 0;
            btnLoad.textContent = 'Model loaded ✓';
            _log('Model ready.');
        } catch (e) {
            btnLoad.disabled = false;
            btnLoad.textContent = 'Load TTS Model';
            _log(`Error: ${e.message}`, true);
        }
    });

    // Generate audio
    btnGenAudio.addEventListener('click', async () => {
        _setAllDisabled(true);
        _log('Generating audio for all slides…');
        try {
            const { durations } = await api.generateAudio({
                voice: voiceSelect.value,
                speed: parseFloat(speedRange.value),
            });
            const total = durations.reduce((s, d) => s + d, 0).toFixed(1);
            _log(`Audio ready: ${durations.length} slides, ${total}s total.`);
            btnRecord.disabled = false;
        } catch (e) {
            _log(`Error: ${e.message}`, true);
        } finally {
            btnLoad.disabled     = false;
            btnGenAudio.disabled = false;
        }
    });

    // Record
    btnRecord.addEventListener('click', async () => {
        _setAllDisabled(true);
        _log('Recording slideshow…');
        try {
            const { webmBlob } = await api.record({
                fps:         parseInt(fpsSelect.value, 10),
                bitrateKbps: state.config.bitrateKbps,
            });
            const mb = (webmBlob.size / 1024 / 1024).toFixed(1);
            _log(`Recording done. ${mb} MB WebM ready.`);
            btnDownload.disabled = false;
            btnDownload.dataset.url = URL.createObjectURL(webmBlob);
        } catch (e) {
            _log(`Error: ${e.message}`, true);
        } finally {
            _setAllDisabled(false);
            btnDownload.disabled = !state.webmBlob;
        }
    });

    // Download
    btnDownload.addEventListener('click', () => {
        if (!state.webmBlob) return;
        api.download({ blob: state.webmBlob, filename: 'narrated-slideshow.webm' });
        _log('Download triggered.');
    });

    // Enable generate once slides loaded
    window.addEventListener('tool:slides:loaded', () => {
        // Only enable if model is loaded (load button says loaded)
        if (btnLoad.textContent.includes('✓')) btnGenAudio.disabled = false;
    });
}

function _populateVoices(select, currentVoice, voices) {
    const list = voices ?? [
        'af_heart','af_bella','af_nova','af_sky','af_sarah',
        'am_adam','am_echo','am_liam','am_michael',
        'bf_emma','bf_isabella','bm_george','bm_lewis',
    ];
    select.innerHTML = list.map(v =>
        `<option value="${v}" ${v === currentVoice ? 'selected' : ''}>${v}</option>`
    ).join('');
}

function _setAllDisabled(disabled) {
    ['btn-load-model','btn-gen-audio','btn-record','btn-download']
        .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = disabled; });
}

function _log(msg, isError = false) {
    const log = document.getElementById('vc-export-log');
    if (!log) return;
    const line = document.createElement('div');
    line.className = isError ? 'vc-log-err' : 'vc-log-line';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}
