// preview-transport.js — transport bar builder for sg-preview-canvas (v0.1.0)

import { mountModeButtons } from '/components/sg-timeline/v0/v0.1/v0.1.0/timeline-mode-buttons.js';

/**
 * Format seconds as mm:ss.
 * @param {number} t
 * @returns {string}
 */
export function fmtMmss(t) {
    if (!Number.isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60);
    const s = Math.floor(t - m * 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Build the transport bar DOM into a parent.
 * @param {HTMLElement} parent
 * @returns {{back: HTMLButtonElement, play: HTMLButtonElement, fwd: HTMLButtonElement, redraw: HTMLButtonElement, time: HTMLElement}}
 */
export function buildTransport(parent) {
    parent.innerHTML = '';
    const back = document.createElement('button');
    back.type = 'button';
    back.title = 'Skip to start';
    back.textContent = '⏮';
    const play = document.createElement('button');
    play.type = 'button';
    play.title = 'Play / Pause';
    play.textContent = '▶';
    const fwd = document.createElement('button');
    fwd.type = 'button';
    fwd.title = 'Skip to end';
    fwd.textContent = '⏭';
    // Redraw / refresh — escape hatch when the preview gets out of sync
    // (e.g. after a transform tweak or any edge case the auto-refresh misses).
    // Cheap operation: just re-paints the current frame, no re-decode.
    const redraw = document.createElement('button');
    redraw.type = 'button';
    redraw.title = 'Redraw current frame';
    redraw.textContent = '↻'; // ↻
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = '00:00 / 00:00';
    parent.appendChild(back);
    parent.appendChild(play);
    parent.appendChild(fwd);
    parent.appendChild(redraw);
    parent.appendChild(time);
    return { back, play, fwd, redraw, time };
}

/**
 * Wire transport buttons to a composer handle.
 * @param {{back: HTMLButtonElement, play: HTMLButtonElement, fwd: HTMLButtonElement, redraw?: HTMLButtonElement}} els
 * @param {object} composer
 * @returns {() => void} dispose
 */
export function wireTransport(els, composer) {
    const onBack = () => composer.seek(0);
    const onFwd = () => composer.seek(composer.getDuration());
    const onPlay = () => {
        const wasPlaying = composer.isPlaying();
        if (wasPlaying) composer.pause();
        else composer.play();
        els.play.textContent = wasPlaying ? '▶' : '⏸';
    };
    // Redraw force-repaints the current frame. Prefer composer.refresh() but
    // gracefully fall back to a no-op-ish seek if older composers are in play.
    const onRedraw = () => {
        if (!composer) return;
        if (typeof composer.refresh === 'function') composer.refresh();
        else if (typeof composer.seek === 'function' && typeof composer.getCurrentTime === 'function') {
            composer.seek(composer.getCurrentTime());
        }
    };
    els.back.addEventListener('click', onBack);
    els.fwd.addEventListener('click', onFwd);
    els.play.addEventListener('click', onPlay);
    if (els.redraw) els.redraw.addEventListener('click', onRedraw);
    return () => {
        els.back.removeEventListener('click', onBack);
        els.fwd.removeEventListener('click', onFwd);
        els.play.removeEventListener('click', onPlay);
        if (els.redraw) els.redraw.removeEventListener('click', onRedraw);
    };
}

/**
 * Update the time-readout span.
 * @param {{time: HTMLElement}} els
 * @param {number} cur
 * @param {number} dur
 */
export function updateTime(els, cur, dur) {
    if (els && els.time) els.time.textContent = `${fmtMmss(cur)} / ${fmtMmss(dur)}`;
}

/**
 * Set enable/disable on the three playback transport buttons together.
 * The redraw button (if present) is intentionally left enabled at all times
 * — it's a cheap no-op when no composer is attached.
 * @param {{back: HTMLButtonElement, play: HTMLButtonElement, fwd: HTMLButtonElement, redraw?: HTMLButtonElement}} els
 * @param {boolean} enabled
 */
export function setTransportEnabled(els, enabled) {
    if (!els) return;
    els.back.disabled = !enabled;
    els.play.disabled = !enabled;
    els.fwd.disabled = !enabled;
    if (els.redraw) els.redraw.disabled = false;
}

/**
 * Append a vertical separator and the Select / Move / Crop mode buttons
 * to the transport bar. The buttons re-use the timeline component's
 * `mountModeButtons` helper and dispatch via the supplied callback.
 * @param {HTMLElement} parent
 * @param {{getMode: () => string, dispatch: (name: string, detail: object) => void}} cfg
 * @returns {{root: HTMLElement, refresh: () => void, dispose: () => void}}
 */
export function mountTransportModeButtons(parent, cfg) {
    const sep = document.createElement('span');
    sep.className = 'transport-sep';
    parent.appendChild(sep);
    const handle = mountModeButtons(cfg);
    parent.appendChild(handle.root);
    return {
        root: handle.root,
        refresh: handle.refresh,
        dispose() { handle.dispose(); sep.remove(); },
    };
}
