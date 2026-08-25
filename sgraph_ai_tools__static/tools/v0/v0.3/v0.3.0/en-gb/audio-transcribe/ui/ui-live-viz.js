/**
 * ui-live-viz — a tiny canvas "VAD timeline" for live mode.
 *
 * Scrolls a loudness (RMS) trace right-to-left, draws the speech threshold as a
 * line, shades speech vs silence, and drops a bright marker each time a clip is
 * cut (an at:live:segment fires). It's the visual cue for *when* and *why* the
 * audio was split — and lets the user see/tune the threshold. Reads live values
 * via getLiveLevel()/getLiveThreshold() (no per-frame events).
 *
 * @module audio-transcribe/ui-live-viz
 */

import { AT_EVENTS } from '../api/audio-transcribe-events.js';

const SCALE_MAX = 0.25; // RMS that maps to full height (speech is ~0.05–0.3)

/**
 * @param {{ root: HTMLElement, getLiveLevel?: () => number, getLiveThreshold?: () => {speech:number,silence:number} }} opts
 * @returns {{ start: Function, stop: Function, reset: Function, destroy: Function }}
 */
export function mountLiveViz({ root, getLiveLevel, getLiveThreshold }) {
    root.innerHTML = '<canvas class="at-live__vadcanvas"></canvas>';
    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    let cols = [];           // ring of { rms, speech, cut } columns, one per frame
    let raf = null, w = 0, h = 0, pendingCut = false;

    function size() {
        const r = root.getBoundingClientRect();
        w = Math.max(64, Math.floor(r.width));
        h = Math.max(40, Math.floor(r.height || 90));
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr; canvas.height = h * dpr;
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
        const thr = (getLiveThreshold && getLiveThreshold()) || { speech: 0.02 };
        const rms = (getLiveLevel && getLiveLevel()) || 0;
        cols.push({ rms, speech: rms >= thr.speech, cut: pendingCut });
        pendingCut = false;
        if (cols.length > w) cols.shift();

        ctx.clearRect(0, 0, w, h);
        // threshold line
        const ty = h - Math.min(1, thr.speech / SCALE_MAX) * h;
        ctx.strokeStyle = '#fcd34d'; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(w, ty); ctx.stroke();
        ctx.globalAlpha = 1;
        // columns (oldest left)
        const x0 = w - cols.length;
        for (let i = 0; i < cols.length; i++) {
            const c = cols[i]; const x = x0 + i;
            const bh = Math.min(1, c.rms / SCALE_MAX) * h;
            ctx.fillStyle = c.speech ? '#818cf8' : '#334155';
            ctx.fillRect(x, h - bh, 1, bh);
            if (c.cut) { ctx.fillStyle = '#f87171'; ctx.fillRect(x, 0, 1, h); }
        }
        raf = requestAnimationFrame(draw);
    }

    function onSegment(e) { if (e && e.detail && e.detail.delta) pendingCut = true; }

    function start() { if (raf) return; size(); cols = []; window.addEventListener(AT_EVENTS.LIVE_SEGMENT, onSegment); raf = requestAnimationFrame(draw); }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } window.removeEventListener(AT_EVENTS.LIVE_SEGMENT, onSegment); }
    function reset() { cols = []; ctx.clearRect(0, 0, w, h); }

    return { start, stop, reset, destroy() { stop(); root.innerHTML = ''; } };
}
