/**
 * sg-whisper.js
 * WASM speech-to-text wrapper using HuggingFace transformers.js (ONNX Runtime Web).
 * v0.1.0 — initial implementation: load, transcribe, health check.
 *
 * Supports two-model strategy:
 *   • whisper-tiny.en  (~39 MB) — real-time captions during recording
 *   • whisper-base.en  (~74 MB) — cleanup pass after recording stops
 *
 * Works on iOS Safari 16.4+, Android Chrome, desktop Chrome/Firefox.
 * No SharedArrayBuffer required (transformers.js uses WASM without SAB on iOS).
 *
 * @module sg-whisper
 */

// ─────────────────────────────────────────────────────────────────────────────
// CDN URL for transformers.js
// Use ESM build from jsDelivr so it works as an ES module import.
// ─────────────────────────────────────────────────────────────────────────────

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/src/transformers.js';

/** @type {Object|null} Cached transformers.js module */
let _transformers = null;

/**
 * Lazy-load the transformers.js library from CDN.
 * Cached after first load.
 * @returns {Promise<Object>} transformers module
 */
async function getTransformers() {
    if (_transformers) return _transformers;
    _transformers = await import(TRANSFORMERS_CDN);
    // Disable local model cache check so models are fetched from HuggingFace CDN
    _transformers.env.allowLocalModels = false;
    return _transformers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model loading
// ─────────────────────────────────────────────────────────────────────────────

export const MODEL_TINY = 'Xenova/whisper-tiny.en';
export const MODEL_BASE = 'Xenova/whisper-base.en';

/**
 * @typedef {Object} WhisperModel
 * @property {string}   modelId    HuggingFace model ID
 * @property {Object}   pipeline   transformers.js pipeline instance
 * @property {number}   loadedAtMs Unix timestamp when loading completed
 */

/**
 * Load a Whisper model via transformers.js.
 * Results are cached in sessionStorage metadata so the caller can skip
 * re-downloading on page reload (the actual ONNX weights are cached by the
 * browser via Cache API / opfs internally by transformers.js).
 *
 * @param {string}   [modelId='Xenova/whisper-tiny.en']
 * @param {Function} [onProgress]  Called with { progress: 0–100, status, file }
 * @returns {Promise<WhisperModel>}
 */
export async function loadWhisperModel(modelId = MODEL_TINY, onProgress) {
    const { pipeline, env } = await getTransformers();
    env.allowLocalModels = false;

    const pipe = await pipeline('automatic-speech-recognition', modelId, {
        progress_callback: onProgress ? (p) => {
            onProgress({
                progress: Math.round((p.progress ?? 0)),
                status: p.status,
                file: p.file ?? '',
            });
        } : undefined,
    });

    return { modelId, pipeline: pipe, loadedAtMs: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Transcription
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TranscriptionResult
 * @property {string}  text        Full transcript text
 * @property {number}  latencyMs   Inference duration in ms
 * @property {string}  modelId     Model used
 * @property {Array}   [chunks]    Word/segment timestamps if requested
 */

/**
 * Transcribe an audio Blob or AudioBuffer using a loaded WhisperModel.
 *
 * For Blob input: converts to Float32Array via AudioContext decoding.
 * For Float32Array input: passes directly to pipeline.
 *
 * @param {WhisperModel} model
 * @param {Blob|Float32Array} audio
 * @param {Object}  [opts]
 * @param {boolean} [opts.timestamps=false]   Return word-level timestamps
 * @param {string}  [opts.language='english'] Force language
 * @returns {Promise<TranscriptionResult>}
 */
export async function transcribeBuffer(model, audio, opts = {}) {
    const { timestamps = false, language = 'english' } = opts;

    let audioData;

    if (audio instanceof Blob) {
        audioData = await blobToFloat32Array(audio);
    } else if (audio instanceof Float32Array) {
        audioData = audio;
    } else {
        throw new Error('audio must be a Blob or Float32Array');
    }

    const t0 = performance.now();

    const result = await model.pipeline(audioData, {
        return_timestamps: timestamps,
        language,
        task: 'transcribe',
    });

    return {
        text:      result.text?.trim() ?? '',
        latencyMs: Math.round(performance.now() - t0),
        modelId:   model.modelId,
        chunks:    result.chunks ?? [],
    };
}

/**
 * Decode an audio Blob to a 16 kHz Float32Array (the format Whisper expects).
 * @param {Blob} blob
 * @returns {Promise<Float32Array>}
 */
async function blobToFloat32Array(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const AudioCtx    = window.AudioContext || window.webkitAudioContext;
    const ctx         = new AudioCtx({ sampleRate: 16_000 });
    const decoded     = await ctx.decodeAudioData(arrayBuffer);
    ctx.close();
    // Mix down to mono channel 0
    return decoded.getChannelData(0);
}

/**
 * Generate a short silent+tone test buffer (2 s at 16 kHz).
 * Used by the health check to run a quick transcription benchmark
 * without needing a real microphone.
 * @returns {Float32Array}
 */
function makeSilentTestBuffer() {
    const sr      = 16_000;
    const seconds = 2;
    const buf     = new Float32Array(sr * seconds);
    // Add a tiny 440 Hz sine so decoders don't get confused by pure silence
    for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.sin(2 * Math.PI * 440 * i / sr) * 0.01;
    }
    return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_KEY = 'sg-whisper-health-v0.1.0';

/**
 * @typedef {Object} WhisperHealthResult
 * @property {boolean}  passed
 * @property {WhisperModel|null} tinyModel   Loaded tiny.en model (if passed)
 * @property {WhisperModel|null} baseModel   Loaded base.en model (if passed)
 * @property {Array<{label:string, status:string, detail:string, latencyMs:number}>} results
 */

/**
 * Run the full 10-step WASM + Whisper health check.
 * Mirrors the video-tool runHealthCheck pattern.
 *
 * Steps:
 *  1. WebAssembly support
 *  2. Web Worker support
 *  3. AudioContext support
 *  4. MediaRecorder support
 *  5. Microphone permission
 *  6. Load whisper-tiny.en
 *  7. Transcription test (tiny.en)
 *  8. Load whisper-base.en
 *  9. Transcription test (base.en)
 * 10. WebGPU acceleration check
 *
 * @param {Function} [onStep]  Called with { step, total, label, status, detail? }
 * @returns {Promise<WhisperHealthResult>}
 */
export async function runHealthCheck(onStep) {
    const results    = [];
    let anyFail      = false;
    let tinyModel    = null;
    let baseModel    = null;
    const TOTAL      = 10;

    async function check(label, fn) {
        const step = results.length;
        if (onStep) onStep({ step, total: TOTAL, label, status: 'pending' });
        const t0 = performance.now();
        let status = 'fail', detail = '';
        let value  = null;
        try {
            const r = await fn();
            status = r.status;
            detail = r.detail ?? '';
            value  = r.value  ?? null;
        } catch (err) {
            status = 'fail';
            detail = err.message;
        }
        const latencyMs = Math.round(performance.now() - t0);
        results.push({ label, status, detail, latencyMs });
        if (status === 'fail') anyFail = true;
        if (onStep) onStep({ step, total: TOTAL, label, status, detail });
        return value;
    }

    // 1. WebAssembly
    await check('WebAssembly support', async () => {
        const ok = typeof WebAssembly === 'object';
        return { status: ok ? 'pass' : 'fail', detail: ok ? 'Available' : 'Required for WASM transcription' };
    });

    // 2. Web Worker
    await check('Web Worker support', async () => {
        const ok = typeof Worker !== 'undefined';
        return { status: ok ? 'pass' : 'skip', detail: ok ? 'Available' : 'Not available (may affect performance)' };
    });

    // 3. AudioContext
    await check('AudioContext support', async () => {
        const ok = typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
        return { status: ok ? 'pass' : 'fail', detail: ok ? 'Available' : 'Required for audio decoding' };
    });

    // 4. MediaRecorder
    await check('MediaRecorder support', async () => {
        if (typeof MediaRecorder === 'undefined') return { status: 'fail', detail: 'Not available' };
        const mimes = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
        const supported = mimes.filter(m => MediaRecorder.isTypeSupported(m));
        if (supported.length === 0) return { status: 'fail', detail: 'No supported MIME types' };
        return { status: 'pass', detail: supported[0] };
    });

    // 5. Microphone permission
    await check('Microphone permission', async () => {
        if (!navigator.permissions) return { status: 'skip', detail: 'Permissions API not available' };
        try {
            const p = await navigator.permissions.query({ name: 'microphone' });
            if (p.state === 'denied') return { status: 'fail', detail: 'Denied in browser settings' };
            return { status: 'pass', detail: p.state === 'granted' ? 'Granted' : 'Will prompt on first record' };
        } catch (_) {
            return { status: 'skip', detail: 'Query not supported' };
        }
    });

    // 6. Load tiny.en
    tinyModel = await check('Load model: whisper-tiny.en (~39 MB)', async () => {
        let lastPct = 0;
        const model = await loadWhisperModel(MODEL_TINY, (p) => {
            if (onStep && p.progress > lastPct + 10) {
                lastPct = p.progress;
                onStep({ step: 5, total: TOTAL, label: `Load model: whisper-tiny.en (~39 MB) — ${p.progress}%`, status: 'pending' });
            }
        });
        return { status: 'pass', detail: 'Loaded & cached', value: model };
    });

    // 7. Transcription test (tiny.en)
    await check('Transcription test (tiny.en)', async () => {
        if (!tinyModel) return { status: 'skip', detail: 'Model not loaded' };
        const buf    = makeSilentTestBuffer();
        const result = await transcribeBuffer(tinyModel, buf);
        return { status: 'pass', detail: `${result.latencyMs} ms latency` };
    });

    // 8. Load base.en
    baseModel = await check('Load model: whisper-base.en (~74 MB)', async () => {
        let lastPct = 0;
        const model = await loadWhisperModel(MODEL_BASE, (p) => {
            if (onStep && p.progress > lastPct + 10) {
                lastPct = p.progress;
                onStep({ step: 7, total: TOTAL, label: `Load model: whisper-base.en (~74 MB) — ${p.progress}%`, status: 'pending' });
            }
        });
        return { status: 'pass', detail: 'Loaded & cached', value: model };
    });

    // 9. Transcription test (base.en)
    await check('Transcription test (base.en)', async () => {
        if (!baseModel) return { status: 'skip', detail: 'Model not loaded' };
        const buf    = makeSilentTestBuffer();
        const result = await transcribeBuffer(baseModel, buf);
        return { status: 'pass', detail: `${result.latencyMs} ms latency` };
    });

    // 10. WebGPU
    await check('WebGPU acceleration', async () => {
        if (!navigator.gpu) return { status: 'skip', detail: 'Not available — using WASM (CPU)' };
        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return { status: 'skip', detail: 'No GPU adapter found — using WASM (CPU)' };
            return { status: 'pass', detail: 'Available — transformers.js will prefer GPU inference' };
        } catch (_) {
            return { status: 'skip', detail: 'WebGPU error — using WASM (CPU)' };
        }
    });

    // Cache result in sessionStorage so UI can skip re-download on page reload
    try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ passed: !anyFail, ts: Date.now() }));
    } catch (_) { /* ignore quota errors */ }

    return { passed: !anyFail, tinyModel, baseModel, results };
}

/**
 * Check if a successful health check result is cached in sessionStorage.
 * @returns {boolean}
 */
export function isHealthCheckCached() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return false;
        const { passed, ts } = JSON.parse(raw);
        // Valid for 4 hours
        return passed && (Date.now() - ts) < 4 * 60 * 60 * 1000;
    } catch (_) {
        return false;
    }
}
