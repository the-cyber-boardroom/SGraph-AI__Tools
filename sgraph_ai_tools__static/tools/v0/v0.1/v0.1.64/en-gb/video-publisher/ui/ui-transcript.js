/**
 * ui-transcript.js
 * Transcript tab — read the transcript, pick a model, re-transcribe.
 * @module ui-transcript
 */

import { VP_EVENTS } from '../api/publisher-events.js';
import { listModels } from '../api/publisher-pipeline.js';

export function initTranscriptTab(container, state, api, emit) {
    if (!container) return;
    const models = listModels().filter(m => m.available !== false);
    container.innerHTML = `
      <div class="vp-transcript">
        <div class="vp-row">
          <select id="vp-tr-model" class="vp-input">
            ${models.map(m => `<option value="${m.id}">${m.label || m.id}</option>`).join('')}
          </select>
          <button id="vp-tr-run" class="vp-btn">Transcribe</button>
          <span id="vp-tr-cost" class="vp-muted"></span>
        </div>
        <div id="vp-tr-status" class="vp-muted"></div>
        <pre id="vp-tr-text" class="vp-text" aria-label="Transcript"></pre>
      </div>`;

    const $ = s => container.querySelector(s);
    const textEl = $('#vp-tr-text'), statusEl = $('#vp-tr-status'), costEl = $('#vp-tr-cost');

    $('#vp-tr-run').addEventListener('click', () => {
        api.transcribe({ model: $('#vp-tr-model').value }).catch(() => {});
    });

    window.addEventListener(VP_EVENTS.TRANSCRIBE_START, e => {
        statusEl.textContent = `Transcribing with ${e.detail?.model}…`;
    });
    window.addEventListener(VP_EVENTS.TRANSCRIBE_COMPLETE, e => {
        statusEl.textContent = '';
        textEl.textContent = state.transcript || '';
        costEl.textContent = e.detail?.costUsd != null ? `$${e.detail.costUsd.toFixed(4)}` : '';
    });
    window.addEventListener(VP_EVENTS.STEP_ERROR, e => {
        if (e.detail?.step === 'transcript') statusEl.textContent = `Failed: ${e.detail.message}`;
    });
    window.addEventListener(VP_EVENTS.JOB_RESET, () => { textEl.textContent = ''; statusEl.textContent = ''; costEl.textContent = ''; });
}
