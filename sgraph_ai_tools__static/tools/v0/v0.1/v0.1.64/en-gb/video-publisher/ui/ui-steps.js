/**
 * ui-steps.js
 * Thin adapter between the job state / vp:* events and the generic
 * <sg-pipeline-steps> component: maps step transitions to setStatus calls,
 * formats tool-specific info strings (routes, costs), and turns the
 * component's intents into API calls / tab focus.
 * @module ui-steps
 */

import { VP_EVENTS } from '../api/publisher-events.js';

const STEPS = [
    { key: 'audio',      label: '① Audio',      tab: null,           rerunnable: true },
    { key: 'transcript', label: '② Transcript', tab: 't-transcript', rerunnable: true },
    { key: 'metadata',   label: '③ Metadata',   tab: 't-metadata',   rerunnable: true },
    { key: 'publish',    label: '④ Publish',    tab: 't-publish',    rerunnable: false },
];

function infoFor(step, s) {
    if (!s.info) return '';
    if (step === 'audio')      return `route: ${s.info.route}`;
    if (step === 'publish')    return 'uploaded';
    if (s.info.costUsd != null) return `$${s.info.costUsd.toFixed(4)}`;
    return s.info.model || '';
}

export function initStepsPanel(container, state, api, emit, layout) {
    if (!container) return;
    const steps = document.createElement('sg-pipeline-steps');
    container.appendChild(steps);
    steps.whenReady().then(() => steps.setSteps(STEPS)).catch(() => {});

    function render(step) {
        if (!step || !state.steps[step]) return;
        const s = state.steps[step];
        steps.setStatus(step, { status: s.status, error: s.error, info: infoFor(step, s) });
    }

    steps.addEventListener('sg-pipeline-steps:step-selected', e => {
        if (e.detail?.tab && layout) layout.focusPanel(e.detail.tab);
    });
    steps.addEventListener('sg-pipeline-steps:step-rerun', e => {
        const step = e.detail?.key;
        if (step === 'audio')           api.extractAudio().catch(() => {});
        else if (step === 'transcript') api.transcribe().catch(() => {});
        else if (step === 'metadata')   api.generateMetadata().catch(() => {});
    });

    window.addEventListener(VP_EVENTS.STEP_CHANGED, e => render(e.detail?.step));
    window.addEventListener(VP_EVENTS.JOB_LOADED, () => {
        STEPS.forEach(s => render(s.key));
        steps.setNote(state.autoRun
            ? 'Running: audio → transcript → metadata. Publish stays manual.'
            : 'Auto-run off — drive each step from its tab.');
    });
    window.addEventListener(VP_EVENTS.JOB_RESET, () => { steps.resetStatuses(); steps.setNote(''); });
    window.addEventListener(VP_EVENTS.METADATA_COMPLETE, () => {
        steps.setNote('Ready to publish — review Metadata, then Upload from the Publish tab.');
    });
    window.addEventListener(VP_EVENTS.UPLOAD_COMPLETE, e => {
        steps.setNote(`Published: ${e.detail?.url || ''}`);
        render('publish');
    });
    window.addEventListener(VP_EVENTS.AUTOPUBLISH_COUNTDOWN, e => {
        const s = e.detail?.secondsLeft ?? 0;
        steps.setNote(s > 0 ? `🚀 Auto-publishing in ${s}s — Cancel (Record tab) to stop.` : 'Uploading…');
    });
    window.addEventListener(VP_EVENTS.RUN_CANCELLED, () => {
        STEPS.forEach(s => render(s.key));
        steps.setNote('Cancelled — nothing was published.');
    });
}
