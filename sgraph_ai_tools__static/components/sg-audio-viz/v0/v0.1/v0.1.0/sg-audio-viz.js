/**
 * sg-audio-viz.js
 * Audio-reactive canvas animation component.
 * Zero external dependencies — Web Audio API + Canvas 2D only.
 *
 * Modes: waveform · bars · mirror-bars · circular-wave · circular-bars · blob
 * Sources: MediaStream · HTMLMediaElement · Blob · URL string
 *
 * The canvas can be captured as a MediaStream via captureStream(fps), making
 * it a drop-in camera-replacement track for MediaRecorder.
 *
 * @module sg-audio-viz
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';

// ── Public constants ──────────────────────────────────────────────────────────

export const AUDIO_VIZ_MODES = Object.freeze([
    'waveform', 'bars', 'mirror-bars', 'circular-wave', 'circular-bars', 'blob',
]);

export const AUDIO_VIZ_EVENTS = Object.freeze({
    SOURCE_SET:   'sg-audio-viz:source-set',
    MODE_CHANGED: 'sg-audio-viz:mode-changed',
    ERROR:        'sg-audio-viz:error',
});

// ── Defaults & tuning ─────────────────────────────────────────────────────────

const DEFAULT_MODE    = 'waveform';
const DEFAULT_PRIMARY = '#6366f1';
const DEFAULT_SECOND  = '#a78bfa';
const DEFAULT_FFT     = 2048;
const SMOOTHING       = 0.8;
const MIN_DB          = -90;
const MAX_DB          = -10;

// ── Component ─────────────────────────────────────────────────────────────────

export class SgAudioViz extends SgComponent {
    static jsUrl = import.meta.url;

    static get observedAttributes() {
        return ['mode', 'color-primary', 'color-secondary', 'fft-size'];
    }

    // ── Private state ─────────────────────────────────────────────────────────

    #mode         = DEFAULT_MODE;
    #colorPrimary = DEFAULT_PRIMARY;
    #colorSec     = DEFAULT_SECOND;
    #fftSize      = DEFAULT_FFT;

    #running    = false;
    #rafId      = null;

    #audioCtx   = null;   // AudioContext
    #analyser   = null;   // AnalyserNode
    #sourceNode = null;   // MediaStreamSourceNode | MediaElementSourceNode
    #sourceEl   = null;   // Audio element (created for Blob/URL sources)

    #canvas     = null;   // HTMLCanvasElement (shadow DOM)
    #canvasCtx  = null;   // CanvasRenderingContext2D
    #resizeObs  = null;   // ResizeObserver

    #freqData   = null;   // Uint8Array — FFT frequency bins
    #timeData   = null;   // Uint8Array — time-domain waveform

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    get resourceName() { return 'sg-audio-viz'; }

    attributeChangedCallback(name, _old, val) {
        switch (name) {
            case 'mode':
                if (AUDIO_VIZ_MODES.includes(val)) this.#mode = val;
                break;
            case 'color-primary':   this.#colorPrimary = val; break;
            case 'color-secondary': this.#colorSec      = val; break;
            case 'fft-size': {
                const n = parseInt(val, 10);
                if (!isNaN(n)) this.#fftSize = n;
                break;
            }
        }
    }

    onReady() {
        this.#canvas    = this.$('canvas');
        this.#canvasCtx = this.#canvas.getContext('2d');

        this.#resizeObs = new ResizeObserver(() => this.#syncSize());
        this.#resizeObs.observe(this.#canvas);
        this.#syncSize();
    }

    cleanup() {
        this.destroy();
        super.cleanup();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Connect an audio source and prepare the analyser.
     * Must be called from (or after) a user gesture — AudioContext requires one.
     * @param {MediaStream|HTMLMediaElement|Blob|string} source
     * @returns {Promise<void>}
     */
    async setSource(source) {
        this.#teardownSource();
        await this.#ensureAudioCtx();

        try {
            if (source instanceof MediaStream) {
                this.#sourceNode = this.#audioCtx.createMediaStreamSource(source);
                // Not connected to destination — prevents mic feedback
                this.#sourceNode.connect(this.#analyser);
                this.emit(AUDIO_VIZ_EVENTS.SOURCE_SET, { type: 'stream' });

            } else if (source instanceof HTMLMediaElement) {
                this.#sourceNode = this.#audioCtx.createMediaElementSource(source);
                this.#sourceNode.connect(this.#analyser);
                this.#sourceNode.connect(this.#audioCtx.destination);
                this.emit(AUDIO_VIZ_EVENTS.SOURCE_SET, { type: 'element' });

            } else if (source instanceof Blob) {
                await this.#loadUrl(URL.createObjectURL(source), true);

            } else if (typeof source === 'string') {
                await this.#loadUrl(source, false);

            } else {
                throw new TypeError('setSource: unsupported source type');
            }
        } catch (err) {
            this.emit(AUDIO_VIZ_EVENTS.ERROR, { message: err.message });
            throw err;
        }
    }

    /**
     * Switch to a different visualization mode.
     * @param {'waveform'|'bars'|'mirror-bars'|'circular-wave'|'circular-bars'|'blob'} mode
     */
    setMode(mode) {
        if (!AUDIO_VIZ_MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);
        this.#mode = mode;
        this.emit(AUDIO_VIZ_EVENTS.MODE_CHANGED, { mode });
    }

    /**
     * Update rendering colors without stopping the animation.
     * @param {{ primary?: string, secondary?: string }} colors
     */
    setColors({ primary, secondary } = {}) {
        if (primary)   this.#colorPrimary = primary;
        if (secondary) this.#colorSec     = secondary;
    }

    /** Start (or resume) the requestAnimationFrame render loop. */
    start() {
        if (this.#running) return;
        this.#running = true;
        this.#audioCtx?.resume().catch(() => {});
        this.#loop();
    }

    /** Pause the render loop; canvas freezes on the last frame. */
    stop() {
        this.#running = false;
        if (this.#rafId !== null) {
            cancelAnimationFrame(this.#rafId);
            this.#rafId = null;
        }
    }

    /**
     * Capture the animated canvas as a live video MediaStream.
     * Combine with an audio track to use as a camera-replacement in MediaRecorder.
     * @param {number} [fps=30]
     * @returns {MediaStream}
     */
    captureStream(fps = 30) {
        if (!this.#canvas) throw new Error('Component not ready — await whenReady() first');
        return this.#canvas.captureStream(fps);
    }

    /**
     * Return the raw AnalyserNode for advanced use (e.g. meter, beat detection).
     * @returns {AnalyserNode|null}
     */
    getAnalyser() {
        return this.#analyser;
    }

    /** Stop animation, close AudioContext, disconnect ResizeObserver. */
    destroy() {
        this.stop();
        this.#teardownSource();
        if (this.#audioCtx) {
            this.#audioCtx.close().catch(() => {});
            this.#audioCtx = null;
            this.#analyser  = null;
        }
        this.#resizeObs?.disconnect();
        this.#resizeObs = null;
    }

    // ── Private: audio pipeline ───────────────────────────────────────────────

    async #ensureAudioCtx() {
        if (this.#audioCtx && this.#audioCtx.state !== 'closed') return;

        this.#audioCtx = new AudioContext();
        this.#analyser = this.#audioCtx.createAnalyser();
        this.#analyser.fftSize               = this.#fftSize;
        this.#analyser.smoothingTimeConstant = SMOOTHING;
        this.#analyser.minDecibels           = MIN_DB;
        this.#analyser.maxDecibels           = MAX_DB;

        const bins     = this.#analyser.frequencyBinCount;
        this.#freqData = new Uint8Array(bins);
        this.#timeData = new Uint8Array(this.#analyser.fftSize);
    }

    async #loadUrl(url, revokeOnEnd) {
        const el       = new Audio();
        el.crossOrigin = 'anonymous';
        el.src         = url;
        this.#sourceEl = el;

        this.#sourceNode = this.#audioCtx.createMediaElementSource(el);
        this.#sourceNode.connect(this.#analyser);
        this.#sourceNode.connect(this.#audioCtx.destination);

        if (revokeOnEnd) {
            el.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        }
        this.emit(AUDIO_VIZ_EVENTS.SOURCE_SET, { type: revokeOnEnd ? 'blob' : 'url' });
    }

    #teardownSource() {
        if (this.#sourceNode) {
            try { this.#sourceNode.disconnect(); } catch (_) {}
            this.#sourceNode = null;
        }
        if (this.#sourceEl) {
            this.#sourceEl.pause();
            this.#sourceEl.src = '';
            this.#sourceEl     = null;
        }
    }

    // ── Private: canvas sizing ────────────────────────────────────────────────

    #syncSize() {
        if (!this.#canvas) return;
        const dpr = devicePixelRatio || 1;
        const w   = Math.round(this.#canvas.clientWidth  * dpr);
        const h   = Math.round(this.#canvas.clientHeight * dpr);
        if (this.#canvas.width !== w || this.#canvas.height !== h) {
            this.#canvas.width  = w;
            this.#canvas.height = h;
        }
    }

    // ── Private: render loop ──────────────────────────────────────────────────

    #loop() {
        if (!this.#running) return;
        this.#rafId = requestAnimationFrame(() => this.#loop());
        this.#draw();
    }

    #draw() {
        const ctx = this.#canvasCtx;
        const W   = this.#canvas.width;
        const H   = this.#canvas.height;

        ctx.clearRect(0, 0, W, H);

        if (!this.#analyser) {
            this.#drawIdle(ctx, W, H);
            return;
        }

        this.#analyser.getByteFrequencyData(this.#freqData);
        this.#analyser.getByteTimeDomainData(this.#timeData);

        switch (this.#mode) {
            case 'waveform':      this.#drawWaveform(ctx, W, H);      break;
            case 'bars':          this.#drawBars(ctx, W, H, false);   break;
            case 'mirror-bars':   this.#drawBars(ctx, W, H, true);    break;
            case 'circular-wave': this.#drawCircularWave(ctx, W, H);  break;
            case 'circular-bars': this.#drawCircularBars(ctx, W, H);  break;
            case 'blob':          this.#drawBlob(ctx, W, H);          break;
        }
    }

    // ── Visualization modes ───────────────────────────────────────────────────

    /** Pulsing ring shown while no source is connected. */
    #drawIdle(ctx, W, H) {
        const t = performance.now() / 1000;
        const r = Math.min(W, H) * 0.18 + Math.sin(t * 1.2) * Math.min(W, H) * 0.015;
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
        ctx.strokeStyle = this.#colorPrimary + '44';
        ctx.lineWidth   = 1.5 * (devicePixelRatio || 1);
        ctx.stroke();
    }

    /** Classic oscilloscope line — time-domain waveform, gradient-coloured. */
    #drawWaveform(ctx, W, H) {
        const data = this.#timeData;
        const dpr  = devicePixelRatio || 1;

        const grad = ctx.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0,   this.#colorPrimary);
        grad.addColorStop(0.5, this.#colorSec);
        grad.addColorStop(1,   this.#colorPrimary);

        ctx.beginPath();
        ctx.lineWidth   = 2 * dpr;
        ctx.strokeStyle = grad;
        ctx.lineJoin    = 'round';

        const sliceW = W / data.length;
        for (let i = 0; i < data.length; i++) {
            // data[i]: 0–255, centred at 128 (silence). Map to 0–H centred at H/2.
            const y = (data[i] / 128) * (H / 2);
            i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * sliceW, y);
        }
        ctx.stroke();
    }

    /** Vertical frequency bars. mirror=true reflects them symmetrically. */
    #drawBars(ctx, W, H, mirror) {
        const data  = this.#freqData;
        const dpr   = devicePixelRatio || 1;
        const count = Math.min(data.length, Math.floor(W / (3 * dpr)));
        const barW  = W / count;
        const gap   = Math.max(1, barW * 0.15);
        const step  = Math.floor(data.length / count);

        const grad = ctx.createLinearGradient(0, H, 0, 0);
        grad.addColorStop(0,   this.#colorPrimary);
        grad.addColorStop(0.6, this.#colorSec);
        grad.addColorStop(1,   '#ffffffcc');

        for (let i = 0; i < count; i++) {
            const v  = data[i * step] / 255;
            const bH = Math.max(2 * dpr, v * (mirror ? H / 2 : H));
            const x  = i * barW + gap / 2;
            ctx.fillStyle = grad;
            if (mirror) {
                ctx.fillRect(x, H / 2 - bH, barW - gap, bH);
                ctx.fillRect(x, H / 2,       barW - gap, bH);
            } else {
                ctx.fillRect(x, H - bH, barW - gap, bH);
            }
        }
    }

    /** Time-domain waveform mapped to a closed circle — voice bubble shape. */
    #drawCircularWave(ctx, W, H) {
        const data  = this.#timeData;
        const cx    = W / 2;
        const cy    = H / 2;
        const baseR = Math.min(W, H) * 0.28;
        const ampR  = Math.min(W, H) * 0.16;
        const dpr   = devicePixelRatio || 1;

        const grad = ctx.createRadialGradient(cx, cy, baseR * 0.5, cx, cy, baseR + ampR);
        grad.addColorStop(0, this.#colorPrimary);
        grad.addColorStop(1, this.#colorSec);

        ctx.beginPath();
        ctx.lineWidth   = 2 * dpr;
        ctx.strokeStyle = grad;

        for (let i = 0; i <= data.length; i++) {
            const v     = data[i % data.length] / 128 - 1;  // -1 to +1
            const angle = (i / data.length) * Math.PI * 2 - Math.PI / 2;
            const r     = baseR + v * ampR;
            const x     = cx + Math.cos(angle) * r;
            const y     = cy + Math.sin(angle) * r;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
    }

    /** 128 frequency bars radiating outward from a central disc. */
    #drawCircularBars(ctx, W, H) {
        const data    = this.#freqData;
        const cx      = W / 2;
        const cy      = H / 2;
        const innerR  = Math.min(W, H) * 0.18;
        const maxBarH = Math.min(W, H) * 0.30;
        const count   = 128;
        const dpr     = devicePixelRatio || 1;
        const step    = Math.floor(data.length / count);

        ctx.lineCap = 'round';

        for (let i = 0; i < count; i++) {
            const v     = data[i * step] / 255;
            const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
            const barH  = Math.max(2 * dpr, v * maxBarH);

            ctx.strokeStyle = _blend(this.#colorPrimary, this.#colorSec, v);
            ctx.lineWidth   = Math.max(dpr, (2 * Math.PI * innerR / count) * 0.65);

            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * innerR,          cy + Math.sin(angle) * innerR);
            ctx.lineTo(cx + Math.cos(angle) * (innerR + barH), cy + Math.sin(angle) * (innerR + barH));
            ctx.stroke();
        }

        // Centre fill disc
        ctx.beginPath();
        ctx.arc(cx, cy, innerR * 0.88, 0, Math.PI * 2);
        ctx.fillStyle = this.#colorPrimary + '22';
        ctx.fill();
    }

    /** Organic morphing shape — bass energy drives size, waveform drives outline. */
    #drawBlob(ctx, W, H) {
        const timeData = this.#timeData;
        const freqData = this.#freqData;
        const cx       = W / 2;
        const cy       = H / 2;
        const baseR    = Math.min(W, H) * 0.22;
        const PTS      = 64;

        const bass = _avg(freqData, 0, 8) / 255;
        const R    = baseR * (1 + bass * 0.38);

        // Sample time-domain data around the circle
        const pts = [];
        for (let i = 0; i < PTS; i++) {
            const idx   = Math.floor(i / PTS * timeData.length);
            const v     = timeData[idx] / 128 - 1;  // -1 to +1
            const angle = (i / PTS) * Math.PI * 2 - Math.PI / 2;
            const r     = Math.max(R * 0.4, R + v * R * 0.45);
            pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
        }

        // Smooth closed curve: quadratic bezier through midpoints between samples
        ctx.beginPath();
        for (let i = 0; i < PTS; i++) {
            const [x0, y0] = pts[i];
            const [x1, y1] = pts[(i + 1) % PTS];
            const mx = (x0 + x1) / 2;
            const my = (y0 + y1) / 2;
            i === 0 ? ctx.moveTo(mx, my) : ctx.quadraticCurveTo(x0, y0, mx, my);
        }
        ctx.closePath();

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.4);
        grad.addColorStop(0,   this.#colorSec     + 'dd');
        grad.addColorStop(0.6, this.#colorPrimary + 'aa');
        grad.addColorStop(1,   this.#colorPrimary + '11');

        ctx.fillStyle   = grad;
        ctx.fill();
        ctx.strokeStyle = this.#colorPrimary + 'bb';
        ctx.lineWidth   = 1.5 * (devicePixelRatio || 1);
        ctx.stroke();
    }
}

// ── Module-private helpers ────────────────────────────────────────────────────

/** Average a slice of a Uint8Array. */
function _avg(arr, start, end) {
    const n = Math.min(end, arr.length) - start;
    if (n <= 0) return 0;
    let sum = 0;
    for (let i = start; i < start + n; i++) sum += arr[i];
    return sum / n;
}

/** Linear interpolate between two hex colours. t = 0..1. */
function _blend(hex1, hex2, t) {
    const a = _parseHex(hex1);
    const b = _parseHex(hex2);
    if (!a || !b) return hex1;
    const r  = Math.round(a[0] + (b[0] - a[0]) * t);
    const g  = Math.round(a[1] + (b[1] - a[1]) * t);
    const bv = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r},${g},${bv})`;
}

function _parseHex(hex) {
    let h = (hex ?? '').trim().replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length !== 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ── Registration ──────────────────────────────────────────────────────────────

customElements.define('sg-audio-viz', SgAudioViz);
