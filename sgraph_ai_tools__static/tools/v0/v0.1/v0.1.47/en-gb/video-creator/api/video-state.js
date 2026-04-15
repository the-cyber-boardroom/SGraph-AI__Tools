/**
 * video-state.js
 * PipelineState — pure data container, no DOM, no events.
 * All pipeline logic lives in video-pipeline.js; all UI reads from this state.
 *
 * @module video-state
 */

/** @typedef {'idle'|'loading-model'|'ready'|'generating-audio'|'recording'|'converting'|'done'|'error'} PipelineStatus */

/**
 * @typedef {Object} SlideInfo
 * @property {number} index
 * @property {string} name        Original filename
 * @property {string} dataUrl     Base64 data URL for canvas/img preview
 */

/**
 * @typedef {Object} VideoConfig
 * @property {string} voice
 * @property {number} speed
 * @property {number} fps
 * @property {number} bitrateKbps
 * @property {number} width       Canvas width in pixels
 * @property {number} height      Canvas height in pixels
 */

export const DEFAULT_CONFIG = Object.freeze({
    voice:       'af_bella',
    speed:       1.0,
    fps:         30,
    bitrateKbps: 2500,
    width:       1280,
    height:      720,
});

export class PipelineState {
    constructor() {
        /** @type {SlideInfo[]} */
        this.slides = [];
        /** @type {string[]} Narration text per slide (parallel array) */
        this.narrations = [];
        /** @type {Float32Array|null[]} Generated audio per slide */
        this.audioData = [];
        /** @type {number[]} Audio duration in seconds per slide */
        this.audioDurations = [];
        /** @type {number} Sample rate of generated audio (always 24000 for Kokoro) */
        this.sampleRate = 24_000;
        /** @type {VideoConfig} */
        this.config = { ...DEFAULT_CONFIG };
        /** @type {PipelineStatus} */
        this.status = 'idle';
        /** @type {string|null} */
        this.lastError = null;
        /** @type {Blob|null} Last recorded WebM blob */
        this.webmBlob = null;
        /** @type {number|null} Selected slide index (for narration editor) */
        this.selectedSlide = null;
    }

    /**
     * Set the full slide list. Extends narrations/audio arrays to match.
     * @param {SlideInfo[]} slides
     */
    setSlides(slides) {
        this.slides = slides;
        while (this.narrations.length < slides.length)   this.narrations.push('');
        this.audioDurations = new Array(slides.length).fill(0);
        this.audioData      = new Array(slides.length).fill(null);
        if (this.selectedSlide === null && slides.length > 0) this.selectedSlide = 0;
    }

    /**
     * Set narration text for one slide.
     * @param {number} index
     * @param {string} text
     */
    setNarration(index, text) {
        if (index < 0 || index >= this.slides.length) throw new Error(`Slide index ${index} out of range`);
        this.narrations[index] = text;
    }

    /**
     * Store generated audio for one slide.
     * @param {number}      index
     * @param {Float32Array} data
     * @param {number}      sampleRate
     */
    setAudio(index, data, sampleRate) {
        this.audioData[index]      = data;
        this.audioDurations[index] = data.length / sampleRate;
        this.sampleRate            = sampleRate;
    }

    /** @param {PipelineStatus} status  @param {string|null} [error] */
    setStatus(status, error = null) {
        this.status    = status;
        this.lastError = error;
    }

    /** @returns {object} Serialisable snapshot (no ArrayBuffers) */
    toSnapshot() {
        return {
            slideCount:     this.slides.length,
            narrationCount: this.narrations.filter(Boolean).length,
            audioDurations: [...this.audioDurations],
            config:         { ...this.config },
            status:         this.status,
            lastError:      this.lastError,
            hasWebm:        !!this.webmBlob,
        };
    }
}
