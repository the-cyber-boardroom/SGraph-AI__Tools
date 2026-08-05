/**
 * ui-steps.js
 * The pipeline spine — four step rows with live status, cost, and a re-run
 * affordance. Clicking a row focuses its tab on the right.
 * @module ui-steps
 */

import { VP_EVENTS } from '../api/publisher-events.js';

const STEPS = [
    { key: 'audio',      label: '① Audio',      tab: null },
    { key: 'transcript', label: '② Transcript', tab: 't-transcript' },
    { key: 'metadata',   label: '③ Metadata',   tab: 't-metadata' },
    { key: 'publish',    label: '④ Publish',    tab: 't-publish' },
];
const ICONS = { idle: '○', running: '◐', done: '✓', error: '✗' };

export function initStepsPanel(container, state, api, emit, layout) {
    if (!container) return;
    container.innerHTML = `
      <div class="vp-steps">
        ${STEPS.map(s => `
          <div class="vp-step" data-step="${s.key}" ${s.tab ? `data-tab="${s.tab}"` : ''}>
            <span class="vp-step__icon" data-icon>○</span>
            <span class="vp-step__label">${s.label}</span>
            <span class="vp-step__info vp-muted" data-info></span>
            <button class="vp-btn vp-btn--mini" data-rerun hidden title="Re-run">↺</button>
          </div>`).join('')}
        <div id="vp-steps-note" class="vp-muted"></div>
      </div>`;

    const note = container.querySelector('#vp-steps-note');
    const rows = {};
    for (const el of container.querySelectorAll('.vp-step')) rows[el.dataset.step] = el;

    function render(step) {
        const el = rows[step];
        if (!el) return;
        const s = state.steps[step] || { status: 'idle' };
        el.querySelector('[data-icon]').textContent = ICONS[s.status] || '○';
        el.dataset.status = s.status;
        const info = el.querySelector('[data-info]');
        if (s.status === 'error') info.textContent = s.error || 'failed';
        else if (step === 'audio' && s.info)      info.textContent = `route: ${s.info.route}`;
        else if (step === 'transcript' && s.info) info.textContent = s.info.costUsd != null ? `$${s.info.costUsd.toFixed(4)}` : (s.info.model || '');
        else if (step === 'metadata' && s.info)   info.textContent = s.info.costUsd != null ? `$${s.info.costUsd.toFixed(4)}` : '';
        else if (step === 'publish' && s.info)    info.textContent = 'uploaded';
        else info.textContent = '';
        el.querySelector('[data-rerun]').hidden = !(s.status === 'done' || s.status === 'error') || step === 'publish';
    }

    container.addEventListener('click', e => {
        const rerun = e.target.closest('[data-rerun]');
        const row   = e.target.closest('.vp-step');
        if (rerun && row) {
            const step = row.dataset.step;
            if (step === 'audio')      api.extractAudio().catch(() => {});
            else if (step === 'transcript') api.transcribe().catch(() => {});
            else if (step === 'metadata')   api.generateMetadata().catch(() => {});
            return;
        }
        if (row?.dataset.tab && layout) layout.focusPanel(row.dataset.tab);
    });

    window.addEventListener(VP_EVENTS.STEP_CHANGED, e => render(e.detail?.step));
    window.addEventListener(VP_EVENTS.JOB_LOADED, () => {
        STEPS.forEach(s => render(s.key));
        note.textContent = state.autoRun
            ? 'Running: audio → transcript → metadata. Publish stays manual.'
            : 'Auto-run off — drive each step from its tab.';
    });
    window.addEventListener(VP_EVENTS.JOB_RESET, () => { STEPS.forEach(s => render(s.key)); note.textContent = ''; });
    window.addEventListener(VP_EVENTS.METADATA_COMPLETE, () => {
        note.textContent = 'Ready to publish — review Metadata, then Upload from the Publish tab.';
    });
    window.addEventListener(VP_EVENTS.UPLOAD_COMPLETE, e => {
        note.textContent = `Published: ${e.detail?.url || ''}`;
        render('publish');
    });
    STEPS.forEach(s => render(s.key));
}
