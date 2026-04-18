/**
 * sg-video-compressor.js
 * Video compression / format conversion Web Component backed by FFmpeg WASM.
 *
 * Wraps sg-video.js (core/video v1.0.1) with a progress UI. The FFmpeg logic
 * lives in core; this component adds attribute-driven configuration and events.
 *
 * Usage (element):
 *   <sg-video-compressor resolution="720p" format="mp4" video-kbps="1500"></sg-video-compressor>
 *   const result = await element.compress(blob);
 *
 * Usage (headless, no DOM):
 *   import { compressVideo } from './sg-video-compressor.js';
 *   const out = await compressVideo(blob, { resolution: '720p', format: 'mp4', videoKbps: 1500 });
 *
 * Events (composed, bubbling):
 *   sg-video-compressor:start      { inputBytes, resolution, format, videoKbps }
 *   sg-video-compressor:progress   { percent, stage }
 *   sg-video-compressor:complete   { outputBlob, inputBytes, outputBytes, durationMs }
 *   sg-video-compressor:error      { message }
 *   sg-video-compressor:cancelled  {}
 *
 * @module sg-video-compressor
 * @version 0.1.0
 */

import { SgComponent, SgComponentPaths } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';
import { loadFFmpeg, convertToMp4 }      from '/core/video/v1/v1.0/v1.0.1/sg-video.js';

// ─── Resolution map ───────────────────────────────────────────────────────────

const RESOLUTIONS = {
    '1080p': { width: 1920, height: 1080 },
    '720p':  { width: 1280, height: 720  },
    '480p':  { width: 854,  height: 480  },
    '360p':  { width: 640,  height: 360  },
    'original': null,
};

// ─── Headless export ──────────────────────────────────────────────────────────

/**
 * Compress a video Blob without mounting the Web Component.
 * @param {Blob} blob
 * @param {{
 *   resolution?: 'original'|'1080p'|'720p'|'480p'|'360p',
 *   format?:     'mp4'|'webm'|'original',
 *   videoKbps?:  number,
 *   audioKbps?:  number,
 *   onProgress?: (percent: number) => void,
 * }} opts
 * @returns {Promise<Blob>}
 */
export async function compressVideo(blob, opts = {}) {
    const {
        resolution = '720p',
        format     = 'mp4',
        videoKbps  = 1500,
        audioKbps  = 128,
        onProgress = null,
    } = opts;

    return _runCompression(blob, { resolution, format, videoKbps, audioKbps, onProgress });
}

// ─── Web Component ────────────────────────────────────────────────────────────

export class SgVideoCompressor extends SgComponent {
    static jsUrl = import.meta.url;

    #busy        = false;
    #cancelled   = false;
    #startMs     = 0;

    // ─── Observed attributes ───────────────────────────────────────────────

    static get observedAttributes() {
        return ['resolution', 'format', 'video-kbps', 'audio-kbps'];
    }

    attributeChangedCallback() {
        if (this._isReady) this._syncControls();
    }

    // ─── Accessors ─────────────────────────────────────────────────────────

    get busy() { return this.#busy; }

    get _resolution() { return this.getAttribute('resolution') ?? '720p'; }
    get _format()     { return this.getAttribute('format')     ?? 'mp4'; }
    get _videoKbps()  { return parseInt(this.getAttribute('video-kbps') ?? '1500', 10); }
    get _audioKbps()  { return parseInt(this.getAttribute('audio-kbps') ?? '128',  10); }

    // ─── Public API ────────────────────────────────────────────────────────

    /**
     * Compress the provided Blob using current attribute settings.
     * @param {Blob} blob
     * @returns {Promise<Blob>}
     */
    async compress(blob) {
        if (this.#busy) throw new Error('Compression already in progress — call cancel() first');

        this.#busy      = true;
        this.#cancelled = false;
        this.#startMs   = Date.now();

        const resolution = this._getResolutionValue();
        const format     = this._format;
        const videoKbps  = this._videoKbps;
        const audioKbps  = this._audioKbps;

        this._setUiState('compressing');
        this.emit('sg-video-compressor:start', { inputBytes: blob.size, resolution: this._resolution, format, videoKbps });

        try {
            const result = await _runCompression(blob, {
                resolution: this._resolution,
                format,
                videoKbps,
                audioKbps,
                onProgress: (pct) => {
                    if (this.#cancelled) return;
                    this._setProgress(pct);
                    this.emit('sg-video-compressor:progress', { percent: pct, stage: 'transcoding' });
                },
            });

            if (this.#cancelled) {
                this.emit('sg-video-compressor:cancelled', {});
                this._setUiState('idle');
                this.#busy = false;
                throw new Error('Cancelled');
            }

            const durationMs = Date.now() - this.#startMs;
            this._setProgress(100);
            this._setUiState('done');
            this.emit('sg-video-compressor:complete', {
                outputBlob: result,
                inputBytes: blob.size,
                outputBytes: result.size,
                durationMs,
            });
            this.#busy = false;
            return result;

        } catch (err) {
            if (!this.#cancelled) {
                this._setUiState('error');
                this.emit('sg-video-compressor:error', { message: err.message });
            }
            this.#busy = false;
            throw err;
        }
    }

    /**
     * Abort in-flight compression (best-effort — FFmpeg WASM may not honour mid-frame).
     */
    cancel() {
        if (!this.#busy) return;
        this.#cancelled = true;
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    onReady() {
        this._syncControls();
        this._bindInputs();
        this._setUiState('idle');
    }

    // ─── Internal UI ──────────────────────────────────────────────────────

    _syncControls() {
        const resEl     = this.$('#vc-resolution');
        const fmtEl     = this.$('#vc-format');
        const videoKbps = this.$('#vc-video-kbps');
        const audioKbps = this.$('#vc-audio-kbps');
        if (resEl)     resEl.value     = this._resolution;
        if (fmtEl)     fmtEl.value     = this._format;
        if (videoKbps) videoKbps.value = this._videoKbps;
        if (audioKbps) audioKbps.value = this._audioKbps;
    }

    _bindInputs() {
        const resEl     = this.$('#vc-resolution');
        const fmtEl     = this.$('#vc-format');
        const videoKbps = this.$('#vc-video-kbps');
        const audioKbps = this.$('#vc-audio-kbps');

        if (resEl)     this.addTrackedListener(resEl,     'change', (e) => this.setAttribute('resolution', e.target.value));
        if (fmtEl)     this.addTrackedListener(fmtEl,     'change', (e) => this.setAttribute('format',     e.target.value));
        if (videoKbps) this.addTrackedListener(videoKbps, 'change', (e) => this.setAttribute('video-kbps', e.target.value));
        if (audioKbps) this.addTrackedListener(audioKbps, 'change', (e) => this.setAttribute('audio-kbps', e.target.value));
    }

    _setProgress(pct) {
        const bar = this.$('.vc-progress__bar');
        const lbl = this.$('.vc-progress__label');
        if (bar) bar.style.width = `${Math.min(100, pct)}%`;
        if (lbl) lbl.textContent = `${Math.round(pct)}%`;
    }

    _setUiState(state) {
        const el = this.$('.vc');
        if (!el) return;
        el.dataset.state = state;
        const progressEl = this.$('.vc-progress');
        if (progressEl) progressEl.hidden = (state === 'idle');
        const statusEl = this.$('.vc-status');
        if (statusEl) {
            statusEl.textContent = { idle: '', compressing: 'Compressing…', done: 'Done', error: 'Error' }[state] ?? '';
        }
    }

    _getResolutionValue() {
        return RESOLUTIONS[this._resolution] ?? null;
    }
}

customElements.define('sg-video-compressor', SgVideoCompressor);

// ─── Internal compression runner ──────────────────────────────────────────────

async function _runCompression(blob, { resolution, format, videoKbps, audioKbps, onProgress }) {
    const ffmpeg = await loadFFmpeg();

    const inputName  = 'input.webm';
    const outputExt  = format === 'mp4' || format === 'original' ? 'mp4' : 'webm';
    const outputName = `output.${outputExt}`;

    const inputData = new Uint8Array(await blob.arrayBuffer());
    ffmpeg.FS('writeFile', inputName, inputData);

    const vf = _buildVf(resolution);
    const args = [
        '-i', inputName,
        ...(vf ? ['-vf', vf] : []),
        '-c:v', outputExt === 'mp4' ? 'libx264' : 'libvpx-vp9',
        '-b:v', `${videoKbps}k`,
        '-c:a', outputExt === 'mp4' ? 'aac' : 'libopus',
        '-b:a', `${audioKbps}k`,
        ...(outputExt === 'mp4' ? ['-movflags', '+faststart'] : []),
        '-preset', 'fast',
        outputName,
    ];

    ffmpeg.setProgress(({ ratio }) => {
        if (onProgress) onProgress(Math.round(Math.max(0, ratio) * 100));
    });

    await ffmpeg.run(...args);

    const data = ffmpeg.FS('readFile', outputName);
    ffmpeg.FS('unlink', inputName);
    ffmpeg.FS('unlink', outputName);

    const mimeType = outputExt === 'mp4' ? 'video/mp4' : 'video/webm';
    return new Blob([data.buffer], { type: mimeType });
}

function _buildVf(resolution) {
    const dims = RESOLUTIONS[resolution];
    if (!dims) return null;
    return `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2`;
}
