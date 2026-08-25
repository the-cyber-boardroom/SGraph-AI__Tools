/**
 * tts — text → speech dispatch (browser):
 *   - 'local'      : core/sg-tts (Kokoro 82M ONNX) — runs in the browser, free.
 *   - 'openrouter' : core/sg-tts-openrouter (versioned) — an OpenRouter audio model.
 *
 * The OpenRouter path + the WAV/PCM helpers live in the VERSIONED core module
 * `core/sg-tts-openrouter` (so vault pages import them by a stable `/core/` URL).
 * This file is the thin mode dispatch. The core modules are imported DYNAMICALLY
 * (runtime, browser) so this dispatch module stays importable under Node (the
 * headless mountShell test imports it transitively) — Node can't resolve a static
 * absolute `/core/…` specifier.
 *
 * @module audio-transcribe/tts
 */

const SG_TTS = '/core/sg-tts/v0/v0.1/v0.1.0/sg-tts.js';
const SG_TTS_OR = '/core/sg-tts-openrouter/v0/v0.1/v0.1.0/sg-tts-openrouter.js';

export const TTS_OPENROUTER_DEFAULT_MODEL = 'openai/gpt-audio';

/** Voices per mode (UI picker). Local = Kokoro; openrouter = OpenAI voices. */
export const TTS_VOICES = Object.freeze({
    local: ['af_heart', 'af_bella', 'am_michael', 'bf_emma', 'bm_george'],
    openrouter: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
});

/** Local synthesis via Kokoro (sg-tts). @returns {Promise<{blob,durationMs,mode}>} */
export async function synthesizeLocal(text, opts = {}) {
    const [tts, or] = await Promise.all([import(SG_TTS), import(SG_TTS_OR)]);
    // poolSize:1 — one worker downloads the ~90 MB model ONCE (the default of 4
    // makes 4 parallel downloads). We synthesise one short text, so 1 is plenty.
    await tts.loadTTS({ voice: opts.voice, poolSize: 1 });
    const { data, sampleRate, durationSecs } = await tts.generateAudio(text, { voice: opts.voice, speed: opts.speed });
    return { blob: or.encodeWav(data, sampleRate), durationMs: Math.round((durationSecs || 0) * 1000), mode: 'local' };
}

/** OpenRouter cloud synthesis — delegates to the versioned core module. */
export async function synthesizeOpenRouter(text, opts = {}) {
    const or = await import(SG_TTS_OR);
    return or.synthesizeOpenRouter(text, opts);
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
