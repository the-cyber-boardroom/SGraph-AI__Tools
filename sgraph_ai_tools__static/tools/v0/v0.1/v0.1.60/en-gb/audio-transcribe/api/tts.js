/**
 * tts — text → speech, in two modes:
 *   - 'local'      : core/sg-tts (Kokoro 82M ONNX, the same engine video-creator
 *                    uses) — runs entirely in the browser, free, no key. The
 *                    ~160 MB model lazy-loads on first use (cached after).
 *   - 'openrouter' : an OpenRouter audio-output model (e.g. openai/gpt-audio)
 *                    via chat completions with `modalities:['audio']` — costs
 *                    tokens, needs the key, but no model download.
 *
 * Both resolve to a WAV `{ blob, durationMs, mode }` so the result flows through
 * the normal addFiles() ingest path (round-trip: synth → transcribe → compare).
 *
 * `fetchImpl` + dynamic sg-tts import keep this module unit-testable in Node.
 *
 * @module audio-transcribe/tts
 */

const SG_TTS = '/core/sg-tts/v0/v0.1/v0.1.0/sg-tts.js';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

/** Voices per mode (UI picker). Local = Kokoro; openrouter = OpenAI voices. */
export const TTS_VOICES = Object.freeze({
    local: ['af_heart', 'af_bella', 'am_michael', 'bf_emma', 'bm_george'],
    openrouter: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
});
export const TTS_OPENROUTER_DEFAULT_MODEL = 'openai/gpt-audio';

/** Encode mono Float32 PCM (−1..1) as a 16-bit PCM WAV Blob. */
export function encodeWav(float32, sampleRate) {
    const n = float32.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
    ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, n * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, float32[i])); dv.setInt16(o, s * 0x7fff, true); o += 2; }
    return new Blob([buf], { type: 'audio/wav' });
}

/** base64 → Blob. */
export function base64ToBlob(b64, mime = 'audio/wav') {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: mime });
}

/** Local synthesis via Kokoro (sg-tts). @returns {Promise<{blob,durationMs,mode}>} */
export async function synthesizeLocal(text, opts = {}) {
    const tts = await import(SG_TTS);
    await tts.loadTTS({ voice: opts.voice });
    const { data, sampleRate, durationSecs } = await tts.generateAudio(text, { voice: opts.voice, speed: opts.speed });
    return { blob: encodeWav(data, sampleRate), durationMs: Math.round((durationSecs || 0) * 1000), mode: 'local' };
}

/** OpenRouter audio-output synthesis. @returns {Promise<{blob,durationMs,mode,generationId}>} */
export async function synthesizeOpenRouter(text, opts = {}) {
    const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) throw Object.assign(new Error('fetch unavailable'), { code: 'no-fetch' });
    if (!opts.apiKey) throw Object.assign(new Error('OpenRouter key required for cloud TTS'), { code: 'no-key' });
    const res = await fetchImpl(OPENROUTER, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: opts.model || TTS_OPENROUTER_DEFAULT_MODEL,
            modalities: ['text', 'audio'],
            audio: { voice: opts.voice || TTS_VOICES.openrouter[0], format: 'wav' },
            messages: [{ role: 'user', content: `Read this text aloud, verbatim, with no preamble:\n\n${text}` }],
        }),
    });
    if (!res || !res.ok) throw Object.assign(new Error(`Cloud TTS failed (HTTP ${res && res.status})`), { code: 'tts-http' });
    const json = await res.json();
    const audio = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.audio;
    const b64 = audio && (audio.data || audio.b64_json);
    if (!b64) throw Object.assign(new Error('No audio in the model response'), { code: 'tts-no-audio' });
    return { blob: base64ToBlob(b64, 'audio/wav'), durationMs: 0, mode: 'openrouter', generationId: json.id };
}

/**
 * Synthesise speech in the requested mode.
 * @param {{ text: string, mode?: 'local'|'openrouter', voice?: string, model?: string, apiKey?: string, speed?: number, fetchImpl?: Function }} params
 * @returns {Promise<{ blob: Blob, durationMs: number, mode: string, generationId?: string }>}
 */
export async function synthesize(params = {}) {
    const text = (params.text || '').trim();
    if (!text) throw Object.assign(new Error('Enter some text to synthesise'), { code: 'no-text' });
    return params.mode === 'openrouter'
        ? synthesizeOpenRouter(text, params)
        : synthesizeLocal(text, params);
}
