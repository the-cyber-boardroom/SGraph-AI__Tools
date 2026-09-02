/**
 * sg-tts-shim-openrouter.js — a drop-in replacement for core/sg-tts served in
 * place of it by Playwright (page.route on /core/sg-tts/…/sg-tts.js), so that
 * video-creator narrates through OpenRouter (openai/gpt-audio) instead of
 * Kokoro without any change to the tool. Same exports, same shapes:
 * generateAudio(text, {voice, speed}) → { data: Float32Array, sampleRate, durationSecs }.
 *
 * The key is read from window.__OPENROUTER_KEY, injected by the render script
 * for the life of the page only. Every generation id is kept in
 * window.__ttsGenerations so the caller can price the run exactly.
 *
 * @module sg-tts-shim-openrouter
 */
import { synthesizeOpenRouter, TTS_OPENROUTER_VOICES, OPENROUTER_TTS_SAMPLE_RATE }
    from '/core/sg-tts-openrouter/v0/v0.1/v0.1.0/sg-tts-openrouter.js';

let _defaultVoice = 'onyx';
let _model = 'openai/gpt-audio';
window.__ttsGenerations = window.__ttsGenerations || [];

export async function loadTTS(options = {}) {
    if (options.voice) _defaultVoice = options.voice;
    if (options.model) _model = options.model;
    options.onProgress?.({ workerIndex: 0, message: `OpenRouter TTS: ${_model} / ${_defaultVoice}` });
}

/** WAV (16-bit PCM mono) → Float32Array, no AudioContext needed. */
async function wavToFloat32(blob) {
    const buf = await blob.arrayBuffer();
    const dv = new DataView(buf);
    const sampleRate = dv.getUint32(24, true);
    const n = (buf.byteLength - 44) / 2;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = dv.getInt16(44 + i * 2, true) / 0x8000;
    return { data: out, sampleRate };
}

export async function generateAudio(text, options = {}) {
    const voice = TTS_OPENROUTER_VOICES.includes(options.voice) ? options.voice : _defaultVoice;
    const t0 = performance.now();
    const r = await synthesizeOpenRouter(text, { apiKey: window.__OPENROUTER_KEY, voice, model: _model });
    const { data, sampleRate } = await wavToFloat32(r.blob);
    window.__ttsGenerations.push({ id: r.generationId, ms: Math.round(performance.now() - t0), durationMs: r.durationMs, text, transcript: r.transcript, voice });
    return { data, sampleRate: sampleRate || OPENROUTER_TTS_SAMPLE_RATE, durationSecs: data.length / (sampleRate || OPENROUTER_TTS_SAMPLE_RATE) };
}

export async function* streamAudio(textChunks, options = {}) {
    for (let i = 0; i < textChunks.length; i++) { const r = await generateAudio(textChunks[i], options); yield { text: textChunks[i], ...r, index: i }; }
}
export function listVoices() { return [...TTS_OPENROUTER_VOICES]; }
export function isSupported() { return typeof fetch !== 'undefined'; }
export async function runHealthCheck() { const r = await generateAudio('Hello.'); return { ok: r.data.length > 0, steps: [{ name: 'OpenRouter test generation', ok: r.data.length > 0, message: `${r.durationSecs.toFixed(2)}s`, ms: 0 }] }; }
