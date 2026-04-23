/**
 * video-api.js
 * Entry point — registers the SgToolApi, calls activate() before init(),
 * then hands off to ui-shell.js.
 *
 * JS-API-first rule: activate() is always called before any UI init.
 * All 10 window methods are live as soon as tool:ready fires.
 *
 * @module video-api
 */

import { SgToolApi }       from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { PipelineState }   from './video-state.js';
import { SGA_VIDEO }       from './video-events.js';
import {
    loadModel,
    generateAllAudio,
    recordSlideshow,
    downloadBlob,
} from './video-pipeline.js';
import { init as initShell } from '../ui/ui-shell.js';

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const state = new PipelineState();

// ─────────────────────────────────────────────────────────────────────────────
// API instance
// ─────────────────────────────────────────────────────────────────────────────

const api = new SgToolApi({
    name:     'video-creator',
    version:  { api: '0.1.0', ui: '0.1.47', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './skills/SKILL-human.md',
        browser: './skills/SKILL-browser.md',
        api:     './skills/SKILL-api.md',
    },
});

/** Emit a SGA_VIDEO event via the api's _emit */
function emit(eventName, detail = {}) {
    api._emit(eventName, detail);
}

// ─────────────────────────────────────────────────────────────────────────────
// Method implementations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * No-op connect — kept for API surface parity. No API key needed (all local).
 * Reserved for future hybrid mode (e.g. ElevenLabs API key).
 */
async function connect(_params) {
    return { ok: true };
}

/**
 * Load slides from File[] array. Reads each file as a data URL and stores in state.
 * @param {{ files: File[] }} params
 * @returns {Promise<{ count: number, slides: SlideInfo[] }>}
 */
async function loadSlides({ files }) {
    if (!files || files.length === 0) throw new Error('No files provided');

    const slides = await Promise.all(
        Array.from(files).map((file, index) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => resolve({ index, name: file.name, dataUrl: reader.result });
            reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
            reader.readAsDataURL(file);
        }))
    );

    state.setSlides(slides);
    emit(SGA_VIDEO.SLIDES_LOADED, { count: slides.length, slides });
    return { count: slides.length, slides };
}

/**
 * Set or override narration text for a single slide.
 * @param {{ slideIndex: number, text: string }} params
 */
function setNarration({ slideIndex, text }) {
    state.setNarration(slideIndex, text ?? '');
}

/**
 * Run TTS for all slides. Emits tool:audio:progress per slide.
 * @param {{ voice?: string, speed?: number }} params
 * @returns {Promise<{ durations: number[] }>}
 */
async function generateAudio({ voice, speed } = {}) {
    if (voice) state.config.voice = voice;
    if (speed) state.config.speed = speed;
    const durations = await generateAllAudio(state, emit);
    return { durations };
}

/**
 * Start the canvas+audio MediaRecorder pipeline.
 * @param {{ fps?: number, bitrateKbps?: number }} params
 * @returns {Promise<{ webmBlob: Blob }>}
 */
async function record({ fps, bitrateKbps } = {}) {
    if (fps)         state.config.fps         = fps;
    if (bitrateKbps) state.config.bitrateKbps = bitrateKbps;
    const webmBlob = await recordSlideshow(state, emit);
    return { webmBlob };
}

/**
 * Stop an in-progress recording (if needed — recordSlideshow() auto-stops).
 * @returns {{ webmBlob: Blob|null }}
 */
function stopRecording() {
    return { webmBlob: state.webmBlob };
}

/**
 * Trigger browser download of a blob.
 * @param {{ blob: Blob, filename: string }} params
 */
function download({ blob, filename }) {
    downloadBlob(blob, filename);
}

/**
 * Return current pipeline status snapshot.
 * @returns {object}
 */
function getStatus() {
    return state.toSnapshot();
}

/** @returns {VideoConfig} */
function getConfig() {
    return { ...state.config };
}

/** @param {Partial<VideoConfig>} params */
function setConfig(params) {
    Object.assign(state.config, params);
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration + activation (JS-API-first: activate() before UI init)
// ─────────────────────────────────────────────────────────────────────────────

api
    .register('connect',       connect,       { async: true })
    .register('loadSlides',    loadSlides,    { async: true, events: [SGA_VIDEO.SLIDES_LOADED] })
    .register('setNarration',  setNarration,  { async: false })
    .register('generateAudio', generateAudio, { async: true, events: [SGA_VIDEO.AUDIO_PROGRESS, SGA_VIDEO.AUDIO_COMPLETE] })
    .register('record',        record,        { async: true, events: [SGA_VIDEO.RECORD_START, SGA_VIDEO.RECORD_STOP] })
    .register('stopRecording', stopRecording, { async: false })
    .register('download',      download,      { async: false })
    .register('getStatus',     getStatus,     { async: false })
    .register('getConfig',     getConfig,     { async: false })
    .register('setConfig',     setConfig,     { async: false });

// Activate before UI — window.__tool is live from this point
api.activate();

// Hand off to UI shell
initShell(state, api, emit);
