/**
 * sg-tts.js
 * Browser-based text-to-speech via Kokoro 82M ONNX (WebGPU/WASM).
 * Runs Kokoro in a pool of Web Workers so the main thread stays responsive.
 *
 * Key findings from probe (2026-04-15):
 *  - esm.sh/kokoro-js rewrites all bare specifiers; jsdelivr needs importmap
 *  - Audio shape: { audio: Float32Array, sampling_rate: 24000 }
 *  - WASM speed: ~0.14–0.45× realtime per worker; 8 workers gives ~0.85× aggregate
 *  - Wall clock ≈ longest individual sentence; split aggressively for best throughput
 *
 * @module sg-tts
 * @version 0.1.0
 */

// CDN for kokoro-js — esm.sh rewrites all transitive bare specifiers automatically
const KOKORO_CDN = 'https://esm.sh/kokoro-js';

// Worker script co-located with this module
const WORKER_URL = new URL('./sg-tts-worker.js', import.meta.url).href;

// Kokoro 82M sample rate
const SAMPLE_RATE = 24_000;

// ─── Module state ─────────────────────────────────────────────────────────────

/** @type {Array<{worker: Worker, ready: boolean, index: number}>} */
let _pool = [];
let _poolSize = 4;
let _cdnUrl = KOKORO_CDN;
let _defaultVoice = 'af_bella';
let _loaded = false;
/** @type {string[]} */
let _voices = [];

// ─────────────────────────────────────────────────────────────────────────────
// Pool management (internal)
// ─────────────────────────────────────────────────────────────────────────────

function _getPool() {
    while (_pool.length < _poolSize) {
        const index = _pool.length;
        const worker = new Worker(WORKER_URL, { type: 'module' });
        worker.addEventListener('error', (e) => console.error(`[sg-tts] Worker[${index}] error:`, e.message));
        _pool.push({ worker, ready: false, index });
    }
    return _pool;
}

/**
 * Load model on a single pool entry. Resolves when the worker fires 'ready'.
 * @param {{ worker: Worker, ready: boolean, index: number }} entry
 * @param {string} cdnUrl
 * @param {function} [onMessage]  Called with each 'loading' message string
 * @returns {Promise<void>}
 */
function _loadWorker(entry, cdnUrl, onMessage) {
    if (entry.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const handler = (e) => {
            if (e.data.type === 'loading') {
                onMessage?.(e.data.message);
            } else if (e.data.type === 'ready') {
                entry.worker.removeEventListener('message', handler);
                entry.ready = true;
                if (e.data.voices?.length) _voices = e.data.voices;
                resolve();
            } else if (e.data.type === 'error' && !e.data.id) {
                entry.worker.removeEventListener('message', handler);
                reject(new Error(e.data.message));
            }
        };
        entry.worker.addEventListener('message', handler);
        entry.worker.postMessage({ type: 'load', cdnUrl });
    });
}

/**
 * Generate one sentence on a pool entry. Resolves with { samples, sampleRate }.
 * Uses a unique id so multiple workers can run simultaneously without message collision.
 * @param {{ worker: Worker, ready: boolean, index: number }} entry
 * @param {string} sentence
 * @param {string} voice
 * @param {number} speed
 * @returns {Promise<{ samples: Float32Array, sampleRate: number }>}
 */
function _workerGenerate(entry, sentence, voice, speed) {
    const id = `${entry.index}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
        const handler = (e) => {
            if (e.data.id !== id) return;
            if (e.data.type === 'chunk') {
                entry.worker.removeEventListener('message', handler);
                resolve({ samples: e.data.samples, sampleRate: e.data.sampleRate });
            } else if (e.data.type === 'error') {
                entry.worker.removeEventListener('message', handler);
                reject(new Error(e.data.message));
            }
        };
        entry.worker.addEventListener('message', handler);
        entry.worker.postMessage({ type: 'generate', id, sentences: [sentence], voice, speed });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentence splitting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split text into sentences for parallel dispatch.
 * Splits at .!? boundaries. Long clauses (>80 chars) are split at commas
 * to keep per-sentence compute time bounded.
 * @param {string} text
 * @returns {string[]}
 */
function _splitSentences(text) {
    const raw = text.match(/[^.!?]+[.!?]+/g) || [text];
    const out = [];
    for (const s of raw) {
        if (s.length > 80 && s.includes(',')) {
            const parts = s.split(/,\s+/);
            for (let i = 0; i < parts.length; i++) {
                out.push(i < parts.length - 1 ? parts[i] + ',' : parts[i]);
            }
        } else {
            out.push(s);
        }
    }
    return out.map(s => s.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lazily loads the Kokoro TTS model from CDN across a pool of Web Workers.
 * Must be called (or awaited internally) before generateAudio() / streamAudio().
 *
 * @param {object} [options]
 * @param {string}   [options.voice='af_bella']  Default voice for subsequent calls
 * @param {string}   [options.cdnUrl]            Override CDN URL (default: esm.sh/kokoro-js)
 * @param {number}   [options.poolSize=4]        Number of parallel workers (1–8)
 * @param {function} [options.onProgress]        Called with { workerIndex, message }
 * @returns {Promise<void>}
 */
export async function loadTTS(options = {}) {
    const {
        voice    = 'af_bella',
        cdnUrl   = KOKORO_CDN,
        poolSize = 4,
        onProgress,
    } = options;

    _defaultVoice = voice;
    _cdnUrl       = cdnUrl;
    _poolSize     = Math.max(1, Math.min(poolSize, 8));

    const pool = _getPool();
    await Promise.all(pool.map((entry) =>
        _loadWorker(entry, _cdnUrl, (msg) => onProgress?.({ workerIndex: entry.index, message: msg }))
    ));

    _loaded = true;
}

/**
 * Generates audio for a text string. Splits into sentences and runs them
 * in parallel across the worker pool for maximum throughput.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.voice]  Override default voice
 * @param {number} [options.speed=1.0]
 * @returns {Promise<{ data: Float32Array, sampleRate: number, durationSecs: number }>}
 */
export async function generateAudio(text, options = {}) {
    const { voice = _defaultVoice, speed = 1.0 } = options;
    if (!_loaded) await loadTTS();

    const sentences = _splitSentences(text);
    const pool = _getPool();

    // Dispatch all sentences in parallel — round-robin across pool
    const results = await Promise.all(
        sentences.map((sentence, i) => _workerGenerate(pool[i % _poolSize], sentence, voice, speed))
    );

    const totalSamples = results.reduce((n, r) => n + r.samples.length, 0);
    const sampleRate   = results[0]?.sampleRate ?? SAMPLE_RATE;
    const data         = new Float32Array(totalSamples);
    let offset = 0;
    for (const r of results) { data.set(r.samples, offset); offset += r.samples.length; }

    return { data, sampleRate, durationSecs: totalSamples / sampleRate };
}

/**
 * Streams audio for an array of text chunks. Yields each chunk as soon as
 * its worker finishes — allows playback/recording to start before all chunks are ready.
 * Chunks are yielded in the order they appear in textChunks (not completion order).
 *
 * @param {string[]} textChunks
 * @param {object} [options]
 * @param {string} [options.voice]
 * @param {number} [options.speed=1.0]
 * @yields {{ text: string, data: Float32Array, sampleRate: number, index: number }}
 */
export async function* streamAudio(textChunks, options = {}) {
    const { voice = _defaultVoice, speed = 1.0 } = options;
    if (!_loaded) await loadTTS();

    const pool = _getPool();

    // Start all worker jobs simultaneously
    const promises = textChunks.map((text, i) => {
        const entry = pool[i % _poolSize];
        return _workerGenerate(entry, text, voice, speed).then(r => ({ text, ...r, index: i }));
    });

    // Yield in order — each await resolves as soon as that index is ready
    for (const promise of promises) {
        const { text, samples, sampleRate, index } = await promise;
        yield { text, data: samples, sampleRate, index };
    }
}

/**
 * Returns available voice IDs from the loaded model.
 * Falls back to the known 28-voice list if the model API returns empty.
 * @returns {string[]}
 */
export function listVoices() {
    if (_voices.length > 0) return [..._voices];
    // Known voices from Kokoro 82M v1.0-ONNX (as of 2026-04)
    return [
        'af_heart','af_alloy','af_aoede','af_bella','af_jessica','af_kore',
        'af_nicole','af_nova','af_river','af_sarah','af_sky',
        'am_adam','am_echo','am_eric','am_fenrir','am_liam','am_michael',
        'am_onyx','am_puck','am_santa',
        'bf_emma','bf_isabella','bf_alice','bf_lily',
        'bm_george','bm_lewis','bm_daniel','bm_fable',
    ];
}

/**
 * Returns true if the runtime supports running Kokoro (WebAssembly + AudioContext).
 * @returns {boolean}
 */
export function isSupported() {
    return (
        typeof WebAssembly === 'object' &&
        (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') &&
        typeof Worker !== 'undefined'
    );
}

/**
 * Runs a 7-step health check: WASM, AudioContext, CDN reachable,
 * module import, model load across all pool workers, voice list, test generation.
 *
 * @param {object} [options]
 * @param {number} [options.poolSize=2]  Workers to warm during health check
 * @param {string} [options.testVoice='af_heart']
 * @returns {Promise<{ ok: boolean, steps: Array<{ name: string, ok: boolean, message: string, ms: number }> }>}
 */
export async function runHealthCheck(options = {}) {
    const { poolSize = 2, testVoice = 'af_heart' } = options;
    const steps = [];

    async function step(name, fn) {
        const t0 = Date.now();
        try {
            const message = await fn();
            steps.push({ name, ok: true, message: message ?? 'OK', ms: Date.now() - t0 });
            return true;
        } catch (e) {
            steps.push({ name, ok: false, message: e.message, ms: Date.now() - t0 });
            return false;
        }
    }

    let ok = true;

    ok = ok && await step('WebAssembly', async () => {
        if (typeof WebAssembly !== 'object') throw new Error('Not available');
        return 'Available';
    });

    ok = ok && await step('AudioContext', async () => {
        const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Ctx) throw new Error('Not available');
        return 'Available';
    });

    ok = ok && await step('CDN reachable', async () => {
        const r = await fetch(_cdnUrl, { method: 'HEAD' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return `HTTP ${r.status}`;
    });

    ok = ok && await step('Module import', async () => {
        const mod = await import(_cdnUrl);
        const KokoroTTS = mod.KokoroTTS ?? mod.default?.KokoroTTS;
        if (!KokoroTTS) throw new Error('KokoroTTS not found in module exports');
        return `KokoroTTS found (${typeof KokoroTTS})`;
    });

    ok = ok && await step('Model load', async () => {
        await loadTTS({ poolSize, cdnUrl: _cdnUrl });
        return `${_pool.filter(e => e.ready).length} worker(s) ready`;
    });

    ok = ok && await step('Voice list', async () => {
        const v = listVoices();
        if (v.length === 0) throw new Error('No voices returned');
        return `${v.length} voices`;
    });

    ok = ok && await step('Test generation', async () => {
        const result = await generateAudio('Hello.', { voice: testVoice });
        if (!result.data || result.data.length === 0) throw new Error('Empty audio returned');
        return `${result.durationSecs.toFixed(2)}s audio`;
    });

    return { ok, steps };
}
