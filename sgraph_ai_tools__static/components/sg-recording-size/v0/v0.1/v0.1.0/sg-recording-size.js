/**
 * sg-recording-size.js
 * Real-time recording size display Web Component.
 *
 * Subscribes to MediaRecorder dataavailable events and accumulates byte counts,
 * displaying live formatted size with optional warn / limit thresholds.
 *
 * Usage:
 *   <sg-recording-size threshold-mb="500" warn-at-percent="80"></sg-recording-size>
 *   element.attach(mediaRecorder);
 *   element.reset();
 *
 * Events (composed, bubbling):
 *   sg-recording-size:warn   { bytes, mb, thresholdMb }  — at warn threshold %
 *   sg-recording-size:limit  { bytes, mb, thresholdMb }  — at 100% of threshold
 *
 * @module sg-recording-size
 * @version 0.1.0
 */

import { SgComponent, SgComponentPaths } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';

export class SgRecordingSize extends SgComponent {
    static jsUrl = import.meta.url;

    // ─── State ─────────────────────────────────────────────────────────────

    #bytes        = 0;
    #mediaRecorder = null;
    #onData       = null;
    #warnFired    = false;
    #limitFired   = false;

    // ─── Observed attributes ───────────────────────────────────────────────

    static get observedAttributes() {
        return ['threshold-mb', 'warn-at-percent', 'label'];
    }

    attributeChangedCallback() {
        if (this._isReady) this._render();
    }

    // ─── Accessors ─────────────────────────────────────────────────────────

    get bytes()         { return this.#bytes; }
    get formattedSize() { return _formatBytes(this.#bytes); }

    get _thresholdMb()    { return parseFloat(this.getAttribute('threshold-mb')    ?? '500'); }
    get _warnAtPercent()  { return parseFloat(this.getAttribute('warn-at-percent') ?? '80'); }
    get _label()          { return this.getAttribute('label') ?? 'Recording size'; }

    // ─── Public API ────────────────────────────────────────────────────────

    /**
     * Attach to an active MediaRecorder. Subscribes to dataavailable events.
     * Call before starting recording; safe to re-attach to a new recorder.
     * @param {MediaRecorder} mediaRecorder
     */
    attach(mediaRecorder) {
        this._detach();
        this.#mediaRecorder = mediaRecorder;
        this.#onData = (e) => {
            if (e.data && e.data.size > 0) {
                this.#bytes += e.data.size;
                this._render();
                this._checkThresholds();
            }
        };
        mediaRecorder.addEventListener('dataavailable', this.#onData);
    }

    /**
     * Reset the byte counter and threshold fire flags.
     */
    reset() {
        this._detach();
        this.#bytes       = 0;
        this.#warnFired   = false;
        this.#limitFired  = false;
        if (this._isReady) this._render();
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    onReady() {
        this._render();
    }

    cleanup() {
        this._detach();
        super.cleanup();
    }

    // ─── Internal ──────────────────────────────────────────────────────────

    _detach() {
        if (this.#mediaRecorder && this.#onData) {
            this.#mediaRecorder.removeEventListener('dataavailable', this.#onData);
        }
        this.#mediaRecorder = null;
        this.#onData        = null;
    }

    _render() {
        const sizeEl  = this.$('.sg-rs__value');
        const labelEl = this.$('.sg-rs__label');
        if (!sizeEl) return;

        const pct       = this._thresholdMb > 0
            ? (this.#bytes / (this._thresholdMb * 1024 * 1024)) * 100
            : 0;

        sizeEl.textContent = this.formattedSize;
        if (labelEl) labelEl.textContent = this._label;

        const el = this.$('.sg-rs');
        if (!el) return;
        el.classList.toggle('sg-rs--warn',  pct >= this._warnAtPercent);
        el.classList.toggle('sg-rs--limit', pct >= 100);
    }

    _checkThresholds() {
        const thresholdBytes = this._thresholdMb * 1024 * 1024;
        if (thresholdBytes <= 0) return;

        const pct = (this.#bytes / thresholdBytes) * 100;
        const detail = { bytes: this.#bytes, mb: this.#bytes / (1024 * 1024), thresholdMb: this._thresholdMb };

        if (!this.#warnFired && pct >= this._warnAtPercent) {
            this.#warnFired = true;
            this.emit('sg-recording-size:warn', detail);
        }
        if (!this.#limitFired && pct >= 100) {
            this.#limitFired = true;
            this.emit('sg-recording-size:limit', detail);
        }
    }
}

customElements.define('sg-recording-size', SgRecordingSize);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _formatBytes(bytes) {
    if (bytes < 1024)              return `${bytes} B`;
    if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
