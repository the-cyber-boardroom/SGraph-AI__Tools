/**
 * sg-audio-recorder.js
 * Web Component for recording audio in segments.
 * v0.1.0 — start/stop/pause, segment timer, waveform visualiser.
 *
 * Usage:
 *   <sg-audio-recorder id="recorder"></sg-audio-recorder>
 *
 * Events emitted:
 *   sg-recorder:segment   — { index, blob, mimeType, startTimeMs, durationMs }
 *   sg-recorder:started   — recording begun
 *   sg-recorder:stopped   — recording ended (final segment already delivered)
 *   sg-recorder:error     — { message }
 *
 * @module sg-audio-recorder
 */

import { startRecording, stopRecording, isMediaRecorderSupported, getBestMimeType }
    from '/core/sg-audio/v0/v0.1/v0.1.0/sg-audio.js';

// ─────────────────────────────────────────────────────────────────────────────
// Event name constants
// ─────────────────────────────────────────────────────────────────────────────

export const SGR_EVENTS = Object.freeze({
    SEGMENT: 'sg-recorder:segment',
    STARTED: 'sg-recorder:started',
    STOPPED: 'sg-recorder:stopped',
    ERROR:   'sg-recorder:error',
});

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE = `
<style>
  :host {
    display: block;
    font-family: 'Fira Mono', monospace;
    color: var(--sg-text, #ccd6f6);
  }
  .rec-wrap {
    display: flex; flex-direction: column; gap: 0.5rem;
    padding: 0.5rem;
  }
  .controls {
    display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  }
  .btn-rec {
    padding: 0.35rem 0.9rem; border-radius: 9999px;
    border: 2px solid var(--sg-accent, #4ecdc4);
    background: rgba(78,205,196,0.1); color: var(--sg-accent, #4ecdc4);
    font-size: 0.75rem; font-weight: 700; cursor: pointer;
    transition: background 150ms;
  }
  .btn-rec:hover { background: rgba(78,205,196,0.2); }
  .btn-rec:disabled { opacity: 0.4; cursor: default; }
  .btn-rec.recording {
    border-color: #e94560; color: #e94560;
    background: rgba(233,69,96,0.1);
    animation: pulse-border 1.2s ease-in-out infinite;
  }
  @keyframes pulse-border {
    0%,100% { box-shadow: 0 0 0 0 rgba(233,69,96,0); }
    50%      { box-shadow: 0 0 0 4px rgba(233,69,96,0.3); }
  }
  .status-row {
    display: flex; align-items: center; gap: 0.5rem;
    font-size: 0.68rem; color: var(--sg-text-muted, #8892b0);
  }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--sg-text-muted, #8892b0); flex-shrink: 0;
  }
  .dot.active { background: #e94560; animation: blink 1s step-start infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .timer { font-variant-numeric: tabular-nums; }
  .seg-count { color: #a78bfa; }
  canvas.waveform {
    width: 100%; height: 48px; border-radius: 4px;
    background: rgba(13,27,42,0.8);
    display: none;
  }
  canvas.waveform.active { display: block; }
  .seg-list {
    font-size: 0.62rem; color: var(--sg-text-muted, #8892b0);
    max-height: 4rem; overflow-y: auto;
  }
  .seg-item {
    display: flex; justify-content: space-between; padding: 0.1rem 0;
    border-bottom: 1px solid rgba(42,58,92,0.4);
  }
  .seg-item span { color: #6ee7b7; }
</style>
<div class="rec-wrap">
  <div class="controls">
    <button class="btn-rec" id="btn-start">🎙 Start Recording</button>
    <button class="btn-rec" id="btn-stop" disabled>⏹ Stop</button>
  </div>
  <div class="status-row">
    <div class="dot" id="dot"></div>
    <span class="timer" id="timer">00:00</span>
    <span class="seg-count" id="seg-count"></span>
    <span id="mime-label"></span>
  </div>
  <canvas class="waveform" id="waveform" width="512" height="48"></canvas>
  <div class="seg-list" id="seg-list"></div>
</div>
`;

export class SgAudioRecorder extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = TEMPLATE;

        this._session      = null;
        this._timerHandle  = null;
        this._startTime    = 0;
        this._segCount     = 0;
        this._analyser     = null;
        this._animFrame    = null;
        this._audioCtx     = null;
        this._source       = null;
    }

    connectedCallback() {
        this.shadowRoot.getElementById('btn-start').addEventListener('click', () => this._startRecording());
        this.shadowRoot.getElementById('btn-stop').addEventListener('click',  () => this._stopRecording());
    }

    disconnectedCallback() {
        this._cleanup();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Programmatically start recording */
    async start() { await this._startRecording(); }

    /** Programmatically stop recording */
    async stop()  { await this._stopRecording(); }

    /** Whether recording is currently active */
    get isRecording() { return !!this._session && !this._session.stopped; }

    // ── Private ───────────────────────────────────────────────────────────────

    async _startRecording() {
        const btnStart = this.shadowRoot.getElementById('btn-start');
        const btnStop  = this.shadowRoot.getElementById('btn-stop');
        btnStart.disabled = true;
        btnStart.textContent = 'Starting…';

        try {
            const segDuration = parseInt(this.getAttribute('segment-duration') ?? '30000', 10);

            this._session = await startRecording({
                segmentDurationMs: segDuration,
                onSegment: (evt) => this._onSegment(evt),
                onError:   (err) => this._onError(err),
            });

            this._segCount = 0;
            this._startTime = Date.now();
            this._updateTimer();
            this._timerHandle = setInterval(() => this._updateTimer(), 500);

            // Waveform via AnalyserNode
            this._startWaveform(this._session.stream);

            btnStart.classList.add('recording');
            btnStart.textContent = '🔴 Recording';
            btnStop.disabled = false;
            this.shadowRoot.getElementById('dot').classList.add('active');
            this.shadowRoot.getElementById('mime-label').textContent = this._session.mimeType;

            this.dispatchEvent(new CustomEvent(SGR_EVENTS.STARTED, {
                bubbles: true, composed: true,
                detail: { sessionId: this._session.sessionId, mimeType: this._session.mimeType },
            }));

        } catch (err) {
            btnStart.disabled = false;
            btnStart.textContent = '🎙 Start Recording';
            this._onError(err);
        }
    }

    async _stopRecording() {
        if (!this._session) return;
        const btnStop  = this.shadowRoot.getElementById('btn-stop');
        const btnStart = this.shadowRoot.getElementById('btn-start');
        btnStop.disabled = true;
        btnStop.textContent = 'Stopping…';

        await stopRecording(this._session);
        this._cleanup();

        btnStart.classList.remove('recording');
        btnStart.textContent = '🎙 Start Recording';
        btnStart.disabled = false;
        btnStop.textContent = '⏹ Stop';
        this.shadowRoot.getElementById('dot').classList.remove('active');

        this.dispatchEvent(new CustomEvent(SGR_EVENTS.STOPPED, {
            bubbles: true, composed: true,
            detail: { sessionId: this._session?.sessionId, segmentCount: this._segCount },
        }));
    }

    _onSegment(evt) {
        this._segCount = evt.index;
        this.shadowRoot.getElementById('seg-count').textContent = `seg ${evt.index}`;

        const item = document.createElement('div');
        item.className = 'seg-item';
        const kb = (evt.blob.size / 1024).toFixed(1);
        const s  = (evt.durationMs / 1000).toFixed(1);
        item.innerHTML = `<span>segment-${String(evt.index).padStart(3,'0')}.webm</span><span>${s}s · ${kb} KB</span>`;
        const list = this.shadowRoot.getElementById('seg-list');
        list.insertBefore(item, list.firstChild);

        this.dispatchEvent(new CustomEvent(SGR_EVENTS.SEGMENT, {
            bubbles: true, composed: true, detail: evt,
        }));
    }

    _onError(err) {
        this.dispatchEvent(new CustomEvent(SGR_EVENTS.ERROR, {
            bubbles: true, composed: true, detail: { message: err.message },
        }));
    }

    _updateTimer() {
        const elapsed = Date.now() - this._startTime;
        const s = Math.floor(elapsed / 1000);
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        this.shadowRoot.getElementById('timer').textContent = `${mm}:${ss}`;
    }

    _startWaveform(stream) {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this._audioCtx = new AudioCtx();
            this._analyser = this._audioCtx.createAnalyser();
            this._analyser.fftSize = 256;
            this._source   = this._audioCtx.createMediaStreamSource(stream);
            this._source.connect(this._analyser);

            const canvas = this.shadowRoot.getElementById('waveform');
            canvas.classList.add('active');
            const ctx   = canvas.getContext('2d');
            const data  = new Uint8Array(this._analyser.frequencyBinCount);

            const draw = () => {
                if (!this._analyser) return;
                this._animFrame = requestAnimationFrame(draw);
                this._analyser.getByteFrequencyData(data);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const barW = canvas.width / data.length;
                data.forEach((v, i) => {
                    const h = (v / 255) * canvas.height;
                    ctx.fillStyle = `rgba(78,205,196,${0.3 + (v/255)*0.7})`;
                    ctx.fillRect(i * barW, canvas.height - h, barW - 1, h);
                });
            };
            draw();
        } catch (_) { /* waveform is non-critical */ }
    }

    _cleanup() {
        if (this._timerHandle) { clearInterval(this._timerHandle); this._timerHandle = null; }
        if (this._animFrame)   { cancelAnimationFrame(this._animFrame); this._animFrame = null; }
        if (this._source)      { try { this._source.disconnect(); } catch (_) {} this._source = null; }
        if (this._audioCtx)    { try { this._audioCtx.close(); }    catch (_) {} this._audioCtx = null; }
        this._analyser = null;
        const canvas = this.shadowRoot.getElementById('waveform');
        if (canvas) canvas.classList.remove('active');
    }
}

customElements.define('sg-audio-recorder', SgAudioRecorder);
