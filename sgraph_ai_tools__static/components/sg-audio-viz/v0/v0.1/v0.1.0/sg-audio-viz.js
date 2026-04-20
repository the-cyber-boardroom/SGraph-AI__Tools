/**
 * sg-audio-viz.js
 * Audio-reactive canvas animation Web Component.
 * Rendering is delegated to sg-audio-viz-draw.js.
 *
 * Modes: waveform · bars · mirror-bars · mirror-wave · circular-wave ·
 *        circular-bars · blob · eq-bands · mirror-eq · smooth-eq
 *
 * Sources: MediaStream · HTMLMediaElement · Blob · URL string
 *
 * The canvas can be captured as a MediaStream via captureStream(fps),
 * making it a drop-in camera-replacement track for MediaRecorder.
 *
 * @module sg-audio-viz
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';
import {
    AUDIO_VIZ_MODES, AUDIO_VIZ_EVENTS,
    drawIdle, drawWaveform, drawBars, drawMirrorWave,
    drawCircularWave, drawCircularBars, drawBlob,
    drawEqBands, drawSmoothEq,
} from './sg-audio-viz-draw.js';

export { AUDIO_VIZ_MODES, AUDIO_VIZ_EVENTS };

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
    #rafIsTimer = false;   // true when #rafId is a setTimeout handle (background tab)
    #visHandler = null;    // visibilitychange listener (registered while running)

    #audioCtx       = null;   // AudioContext
    #analyser       = null;   // AnalyserNode
    #keepAliveDest  = null;   // MediaStreamDestination — keeps AudioContext graph active
    #silentSrc      = null;   // BufferSourceNode (silence) → destination — exempts page from Chrome background-tab timer throttling
    #sourceNode     = null;   // MediaStreamSourceNode | MediaElementSourceNode
    #sourceEl   = null;   // Audio element created for Blob/URL sources

    #canvas     = null;   // HTMLCanvasElement (shadow DOM)
    #canvasCtx  = null;   // CanvasRenderingContext2D
    #resizeObs  = null;   // ResizeObserver

    #freqData   = null;   // Uint8Array — FFT frequency bins
    #timeData   = null;   // Uint8Array — time-domain waveform
    #sampleRate = 48000;  // AudioContext.sampleRate (for bin↔Hz mapping)

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

    cleanup() { this.destroy(); super.cleanup(); }

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
     * @param {string} mode  one of AUDIO_VIZ_MODES
     */
    setMode(mode) {
        if (!AUDIO_VIZ_MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);
        this.#mode = mode;
        this.emit(AUDIO_VIZ_EVENTS.MODE_CHANGED, { mode });
    }

    /**
     * Update rendering colours without stopping the animation.
     * @param {{ primary?: string, secondary?: string }} colors
     */
    setColors({ primary, secondary } = {}) {
        if (primary)   this.#colorPrimary = primary;
        if (secondary) this.#colorSec     = secondary;
    }

    /** Start (or resume) the render loop. */
    start() {
        if (this.#running) return;
        this.#running = true;
        this.#audioCtx?.resume().catch(() => {});
        // Resume AudioContext if the browser suspended it while the tab was hidden.
        this.#visHandler = () => {
            if (!document.hidden) this.#audioCtx?.resume().catch(() => {});
        };
        document.addEventListener('visibilitychange', this.#visHandler);
        this.#loop();
    }

    /** Pause the render loop; canvas freezes on the last frame. */
    stop() {
        this.#running = false;
        if (this.#rafId !== null) {
            if (this.#rafIsTimer) clearTimeout(this.#rafId);
            else cancelAnimationFrame(this.#rafId);
            this.#rafId = null;
        }
        if (this.#visHandler) {
            document.removeEventListener('visibilitychange', this.#visHandler);
            this.#visHandler = null;
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
     * Return the raw AnalyserNode for advanced use (meter, beat detection, etc.).
     * @returns {AnalyserNode|null}
     */
    getAnalyser() { return this.#analyser; }

    /** Stop animation, close AudioContext, disconnect ResizeObserver. */
    destroy() {
        this.stop();
        this.#teardownSource();
        if (this.#audioCtx) {
            try { this.#silentSrc?.stop(); } catch (_) {}
            this.#silentSrc = null;
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

        this.#audioCtx   = new AudioContext();
        this.#sampleRate = this.#audioCtx.sampleRate;
        this.#analyser   = this.#audioCtx.createAnalyser();
        this.#analyser.fftSize               = this.#fftSize;
        this.#analyser.smoothingTimeConstant = SMOOTHING;
        this.#analyser.minDecibels           = MIN_DB;
        this.#analyser.maxDecibels           = MAX_DB;

        const bins     = this.#analyser.frequencyBinCount;
        this.#freqData = new Uint8Array(bins);
        this.#timeData = new Uint8Array(this.#analyser.fftSize);

        // Two-part background-tab strategy:
        //
        // 1. analyser → MediaStreamDestination  keeps the audio graph active so
        //    the AudioContext doesn't suspend. Audio goes to a local stream buffer,
        //    NOT to the speakers (mic → speakers was causing Chrome AEC to suppress
        //    the mic after ~2 s and break recording).
        //
        // 2. silentBuffer → audioCtx.destination  routes all-zero audio to the real
        //    output so Chrome sees "active audio" and exempts this page from
        //    background-tab setTimeout throttling (~1 s → infinity without this).
        //    The buffer is silence, so there is no feedback path for AEC.
        this.#keepAliveDest = this.#audioCtx.createMediaStreamDestination();
        this.#analyser.connect(this.#keepAliveDest);

        const sr = this.#audioCtx.sampleRate;
        this.#silentSrc = this.#audioCtx.createBufferSource();
        this.#silentSrc.buffer = this.#audioCtx.createBuffer(1, sr, sr); // 1 s silence (all zeros)
        this.#silentSrc.loop = true;
        this.#silentSrc.connect(this.#audioCtx.destination);
        this.#silentSrc.start();
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
        if (w === 0 || h === 0) return; // element hidden — preserve canvas size for captureStream
        if (this.#canvas.width !== w || this.#canvas.height !== h) {
            this.#canvas.width  = w;
            this.#canvas.height = h;
        }
    }

    // ── Private: render loop ──────────────────────────────────────────────────

    #loop() {
        if (!this.#running) return;
        // When the page is hidden (background tab), rAF is throttled to ~1 fps.
        // Use setTimeout instead — Chrome exempts tabs with active media streams
        // from aggressive timer throttling, so this fires at near-normal rates.
        // Same pattern used by mergeAsPiP in sg-capture.js for screen recording.
        if (document.hidden) {
            this.#rafIsTimer = true;
            this.#rafId = setTimeout(() => this.#loop(), 1000 / 30);
        } else {
            this.#rafIsTimer = false;
            this.#rafId = requestAnimationFrame(() => this.#loop());
        }
        this.#draw();
    }

    #draw() {
        const ctx = this.#canvasCtx;
        const W   = this.#canvas.width;
        const H   = this.#canvas.height;

        ctx.clearRect(0, 0, W, H);

        if (!this.#analyser) {
            drawIdle(ctx, W, H, { primary: this.#colorPrimary });
            return;
        }

        this.#analyser.getByteFrequencyData(this.#freqData);
        this.#analyser.getByteTimeDomainData(this.#timeData);

        const colors = { primary: this.#colorPrimary, secondary: this.#colorSec };
        const freq   = { ...colors, freqData: this.#freqData };
        const time   = { ...colors, timeData: this.#timeData };
        const both   = { ...colors, freqData: this.#freqData, timeData: this.#timeData };
        const eq     = { ...freq, sampleRate: this.#sampleRate, fftSize: this.#analyser.fftSize };

        switch (this.#mode) {
            case 'waveform':      drawWaveform    (ctx, W, H, time);                       break;
            case 'bars':          drawBars        (ctx, W, H, { ...freq, mirror: false }); break;
            case 'mirror-bars':   drawBars        (ctx, W, H, { ...freq, mirror: true  }); break;
            case 'mirror-wave':   drawMirrorWave  (ctx, W, H, time);                       break;
            case 'circular-wave': drawCircularWave(ctx, W, H, time);                       break;
            case 'circular-bars': drawCircularBars(ctx, W, H, freq);                       break;
            case 'blob':          drawBlob        (ctx, W, H, both);                       break;
            case 'eq-bands':      drawEqBands     (ctx, W, H, { ...eq, mirror: false });   break;
            case 'mirror-eq':     drawEqBands     (ctx, W, H, { ...eq, mirror: true  });   break;
            case 'smooth-eq':     drawSmoothEq    (ctx, W, H, eq);                         break;
        }
    }
}

// ── Registration ──────────────────────────────────────────────────────────────

customElements.define('sg-audio-viz', SgAudioViz);
