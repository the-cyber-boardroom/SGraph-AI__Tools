// preview-transport.js — transport bar builder for sg-preview-canvas (v0.1.0)

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
 * @returns {{back: HTMLButtonElement, play: HTMLButtonElement, fwd: HTMLButtonElement, time: HTMLElement}}
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
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = '00:00 / 00:00';
    parent.appendChild(back);
    parent.appendChild(play);
    parent.appendChild(fwd);
    parent.appendChild(time);
    return { back, play, fwd, time };
}

/**
 * Wire transport buttons to a composer handle.
 * @param {{back: HTMLButtonElement, play: HTMLButtonElement, fwd: HTMLButtonElement}} els
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
    els.back.addEventListener('click', onBack);
    els.fwd.addEventListener('click', onFwd);
    els.play.addEventListener('click', onPlay);
    return () => {
        els.back.removeEventListener('click', onBack);
        els.fwd.removeEventListener('click', onFwd);
        els.play.removeEventListener('click', onPlay);
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
 * Set enable/disable on the three transport buttons together.
 * @param {{back: HTMLButtonElement, play: HTMLButtonElement, fwd: HTMLButtonElement}} els
 * @param {boolean} enabled
 */
export function setTransportEnabled(els, enabled) {
    if (!els) return;
    els.back.disabled = !enabled;
    els.play.disabled = !enabled;
    els.fwd.disabled = !enabled;
}
