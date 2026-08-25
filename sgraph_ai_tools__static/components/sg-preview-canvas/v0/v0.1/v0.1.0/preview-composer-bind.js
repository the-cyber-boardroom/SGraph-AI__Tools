// preview-composer-bind.js — wires a composer handle to the transport bar (v0.1.0)

import { wireTransport, updateTime, setTransportEnabled } from './preview-transport.js';

/**
 * Bind a composer to the transport elements + canvas event surface. The
 * returned object exposes `detach()` and `updateIcon()` so the host
 * component can call them without owning the wiring details.
 *
 * @param {{
 *   composer: object,
 *   els: {back: HTMLButtonElement, play: HTMLButtonElement, fwd: HTMLButtonElement, time: HTMLElement},
 *   canvas: HTMLCanvasElement,
 * }} cfg
 * @returns {{detach: () => void, updateIcon: () => void, getDuration: () => number}}
 */
export function bindComposer(cfg) {
    const { composer, els, canvas } = cfg;
    const unwire = wireTransport(els, composer);
    const duration = composer.getDuration ? composer.getDuration() : 0;
    updateTime(els, composer.getCurrentTime ? composer.getCurrentTime() : 0, duration);

    function updateIcon() {
        if (!composer || !els) return;
        els.play.textContent = composer.isPlaying() ? '⏸' : '▶';
    }
    const onPlayhead = (e) => {
        const t = (e && e.detail && Number.isFinite(e.detail.time)) ? e.detail.time : 0;
        updateTime(els, t, duration);
    };
    const onState = () => updateIcon();
    canvas.addEventListener('composer:playhead-changed', onPlayhead);
    canvas.addEventListener('composer:state-changed', onState);
    canvas.addEventListener('composer:ended', onState);
    setTransportEnabled(els, true);
    updateIcon();

    function detach() {
        try { unwire(); } catch (_) {}
        canvas.removeEventListener('composer:playhead-changed', onPlayhead);
        canvas.removeEventListener('composer:state-changed', onState);
        canvas.removeEventListener('composer:ended', onState);
        updateTime(els, 0, 0);
        if (els.scrubber) { els.scrubber.value = '0'; els._scrubDragging = false; }
        setTransportEnabled(els, false);
        els.play.textContent = '▶';
    }

    return { detach, updateIcon, getDuration: () => duration };
}
