/**
 * ui-rec-indicator.js
 * Prominent recording-state badge — tells the user WHEN it is safe to start
 * talking. Users were speaking during the acquisition/warm-up window (screen
 * picker, getUserMedia, camera auto-exposure gate) before the recorders had
 * actually started, losing the first seconds of narration.
 *
 * States (the data-state attribute drives all styling in controls.css):
 *   idle      — hidden
 *   preparing — amber pulsing dot + "PREPARING — WAIT" (from the moment
 *               startRecording begins until the recorders are live)
 *   live      — red ● REC badge; a one-shot "GO" flash animation fires on the
 *               transition so it registers in peripheral vision
 *   paused    — amber ⏸ PAUSED badge
 *
 * Purely event-driven off SGA_RECORDER events. Animations are CSS-only and
 * cosmetic — hidden-tab throttling can pause the pulse but the shown state is
 * attribute-driven and always correct.
 *
 * @module ui-rec-indicator
 */

import { SGA_RECORDER } from '../api/recorder-events.js';

/**
 * Mount the recording-state badge as the first element of `mount` and wire it
 * to the recorder event bus.
 * @param {HTMLElement} mount  Row the badge is prepended to (the status row).
 * @returns {HTMLElement} the badge element (exposed for tests).
 */
export function initRecIndicator(mount) {
    const el = document.createElement('span');
    el.id            = 'rec-indicator';
    el.className     = 'rec-indicator';
    el.dataset.state = 'idle';
    el.innerHTML     =
        '<span class="rec-indicator__dot"></span>' +
        '<span class="rec-indicator__label"></span>';
    mount.prepend(el);

    const label = el.querySelector('.rec-indicator__label');

    function setState(stateName, text) {
        el.dataset.state  = stateName;
        label.textContent = text;
        if (stateName !== 'live') el.classList.remove('rec-indicator--go');
    }

    /** Restart the one-shot GO flash (remove → reflow → re-add). */
    function flashGo() {
        el.classList.remove('rec-indicator--go');
        void el.offsetWidth;
        el.classList.add('rec-indicator--go');
    }

    window.addEventListener(SGA_RECORDER.RECORD_ARMED,  () => setState('preparing', 'PREPARING — WAIT'));
    window.addEventListener(SGA_RECORDER.RECORD_START,  () => { setState('live', 'REC'); flashGo(); });
    window.addEventListener(SGA_RECORDER.RECORD_RESUME, () => { setState('live', 'REC'); flashGo(); });
    window.addEventListener(SGA_RECORDER.RECORD_PAUSE,  () => setState('paused', 'PAUSED'));
    window.addEventListener(SGA_RECORDER.RECORD_STOP,   () => setState('idle', ''));
    window.addEventListener(SGA_RECORDER.RESET,         () => setState('idle', ''));

    // Acquisition failed (permission denied, picker cancelled, …) — recording
    // never went live, so drop the preparing badge. Errors while live keep the
    // badge: the pipeline auto-stops and RECORD_STOP clears it.
    window.addEventListener(SGA_RECORDER.ERROR, () => {
        if (el.dataset.state === 'preparing') setState('idle', '');
    });

    return el;
}
