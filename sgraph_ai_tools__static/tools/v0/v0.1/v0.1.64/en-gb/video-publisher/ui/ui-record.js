/**
 * ui-record.js
 * Thin Record panel over core/sg-recorder — defaults to the publishing sweet
 * spot (screen + camera PiP + mic, 2.5 Mbps, landscape, combined+separate so
 * route-1 audio is free) with an "advanced" disclosure for the other modes.
 * @module ui-record
 */

import { SGA_RECORDER } from '/core/sg-recorder/v0/v0.1/v0.1.0/recorder-events.js';
import { VP_EVENTS } from '../api/publisher-events.js';
import { recState } from '../api/publisher-pipeline.js';

const MODES = [
    ['camera+screen+audio', 'Screen + camera + mic (default)'],
    ['screen+audio',        'Screen + mic'],
    ['camera+audio',        'Camera + mic'],
    ['screen',              'Screen only'],
];
const QUALITIES = [[1_000_000, '1 Mbps'], [2_500_000, '2.5 Mbps'], [5_000_000, '5 Mbps']];
const LAYOUTS   = [['landscape', 'Landscape'], ['shorts', 'Vertical (Shorts 9:16)'], ['infographic', 'Infographic (tall tab)']];

export function initRecordTab(container, state, api, emit) {
    if (!container) return;
    container.innerHTML = `
      <div class="vp-record">
        <input id="vp-rec-name" class="vp-input" type="text" placeholder="Recording name" aria-label="Recording name">
        <div class="vp-row">
          <button id="vp-rec-start" class="vp-btn vp-btn--primary">● Start recording</button>
          <button id="vp-rec-pause" class="vp-btn" hidden>⏸ Pause</button>
          <button id="vp-rec-stop"  class="vp-btn vp-btn--danger" disabled>■ Stop</button>
        </div>
        <div id="vp-rec-status" class="vp-muted">Screen + camera + mic · 2.5 Mbps · landscape · separate audio stream kept for free transcription</div>
        <video id="vp-rec-preview" class="vp-preview" autoplay muted playsinline hidden></video>
        <details class="vp-advanced"><summary>Advanced</summary>
          <label>Mode <select id="vp-rec-mode" class="vp-input">${MODES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label>Quality <select id="vp-rec-quality" class="vp-input">${QUALITIES.map(([v, l]) => `<option value="${v}" ${v === 2_500_000 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Layout <select id="vp-rec-layout" class="vp-input">${LAYOUTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        </details>
      </div>`;

    const $ = sel => container.querySelector(sel);
    const startBtn = $('#vp-rec-start'), stopBtn = $('#vp-rec-stop'), pauseBtn = $('#vp-rec-pause');
    const statusEl = $('#vp-rec-status'), previewEl = $('#vp-rec-preview'), nameEl = $('#vp-rec-name');

    // Publishing sweet spot defaults (Decision 4 / part 3 of the brief).
    api.setRecordConfig({ mode: 'camera+screen+audio', quality: 2_500_000, layout: 'landscape', recordingMode: 'combined+separate' });

    let timer = null, startedAt = null, bytes = 0, paused = false;
    const fmtTime = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    const fmtMB   = b  => `${(b / (1024 * 1024)).toFixed(1)} MB`;
    function tick() { if (startedAt) statusEl.textContent = `REC ${fmtTime(Date.now() - startedAt)} · ${fmtMB(bytes)}`; }

    startBtn.addEventListener('click', async () => {
        await api.setRecordConfig({
            mode: $('#vp-rec-mode').value, quality: Number($('#vp-rec-quality').value),
            layout: $('#vp-rec-layout').value, recordingMode: 'combined+separate',
            recordingName: nameEl.value.trim(),
        });
        startBtn.disabled = true;
        statusEl.textContent = 'Preparing — pick the screen/tab to share…';
        try { await api.startRecording(); }
        catch (err) { startBtn.disabled = false; statusEl.textContent = `Could not start: ${err.message}`; }
    });

    stopBtn.addEventListener('click', () => { stopBtn.disabled = true; api.stopRecording(); });
    pauseBtn.addEventListener('click', () => {
        paused = !paused;
        if (paused) { api.pauseRecording(); pauseBtn.textContent = '▶ Resume'; }
        else        { api.resumeRecording(); pauseBtn.textContent = '⏸ Pause'; }
    });

    window.addEventListener(SGA_RECORDER.RECORD_ARMED, () => { statusEl.textContent = 'Preparing… (camera warming up)'; });
    window.addEventListener(SGA_RECORDER.RECORD_START, () => {
        startedAt = Date.now(); bytes = 0; paused = false;
        stopBtn.disabled = false; pauseBtn.hidden = false; pauseBtn.textContent = '⏸ Pause';
        timer = setInterval(tick, 500); tick();
        if (recState.stream) { previewEl.srcObject = recState.stream; previewEl.hidden = false; }
    });
    window.addEventListener(SGA_RECORDER.RECORD_PROGRESS, e => { bytes = e.detail?.totalBytes ?? bytes; });
    window.addEventListener(SGA_RECORDER.RECORD_STOP, e => {
        clearInterval(timer); timer = null;
        const d = e.detail || {};
        statusEl.textContent = `Done — ${fmtTime(d.durationMs || 0)}, ${fmtMB(d.sizeBytes || bytes)}. Pipeline running…`;
        startedAt = null;
        startBtn.disabled = false; stopBtn.disabled = true; pauseBtn.hidden = true;
        previewEl.hidden = true; previewEl.srcObject = null;
    });
    window.addEventListener(SGA_RECORDER.ERROR, e => {
        if (timer) return; // mid-recording errors also fire RECORD_STOP
        statusEl.textContent = `Recorder: ${e.detail?.message || 'error'}`;
        startBtn.disabled = false;
    });
    window.addEventListener(VP_EVENTS.JOB_LOADED, e => {
        if (e.detail?.source === 'record' && !nameEl.value.trim() && e.detail.filename) {
            nameEl.value = e.detail.filename.replace(/\.[^.]+$/, '');
        }
    });
}
