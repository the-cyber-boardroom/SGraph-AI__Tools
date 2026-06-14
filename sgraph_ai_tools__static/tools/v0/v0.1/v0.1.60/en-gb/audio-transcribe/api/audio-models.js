/**
 * audio-models — curated OpenRouter audio-capable model list.
 *
 * Editing this file is the single point of model curation (mirrors the
 * infographic model-picker constants pattern: an id array + a metadata map).
 *
 * MVP transcription goes through the chat `input_audio` path via sg-llm-request,
 * so only chat audio-in models are `available: true`. The two dedicated-STT
 * Whisper/transcribe entries are listed but gated (`available: false`,
 * "STT — coming soon") until the optional Phase-2 `/audio/transcriptions`
 * module lands. Per the Reality-Document rule, do not present a gated model as
 * working.
 *
 * Model ids + pricing drift — `cost` is approximate and labelled as such.
 * The available chat-path ids were verified against OpenRouter's live model
 * catalogue (https://openrouter.ai/api/v1/models) on 2026-06-14. The two gated
 * STT ids are Phase-2 placeholders and are NOT yet verified — they go through a
 * dedicated `/audio/transcriptions` module that does not exist yet.
 *
 * @module audio-transcribe/audio-models
 */

/** Default model (cheapest fast audio-capable chat model on the chat path). */
export const DEFAULT_MODEL = 'google/gemini-3.5-flash';

/** Ordered list of curated model ids. */
export const AUDIO_MODEL_IDS = Object.freeze([
    'google/gemini-3.5-flash',
    'google/gemini-3.1-flash-lite',
    'google/gemini-3-pro-preview',
    'openai/gpt-audio',
    'openai/whisper-large-v3',
    'openai/gpt-4o-transcribe',
]);

/**
 * Per-model metadata. `path` is informational; `available:false` gates a model
 * behind the (not-yet-shipped) dedicated-STT module.
 * @type {Readonly<Record<string, { label: string, cost: string, speed: string, path: string, available: boolean }>>}
 */
export const MODEL_METADATA = Object.freeze({
    'google/gemini-3.5-flash':            { label: 'Gemini 3.5 Flash',      cost: 'low',    speed: 'fast',   path: 'chat input_audio',         available: true },
    'google/gemini-3.1-flash-lite':       { label: 'Gemini 3.1 Flash Lite', cost: 'low',    speed: 'fast',   path: 'chat input_audio',         available: true },
    'google/gemini-3-pro-preview':        { label: 'Gemini 3 Pro',          cost: 'high',   speed: 'medium', path: 'chat input_audio',         available: true },
    'openai/gpt-audio':                   { label: 'GPT Audio',             cost: 'high',   speed: 'medium', path: 'chat input_audio',         available: true },
    'openai/whisper-large-v3':            { label: 'Whisper Large v3 (STT — coming soon)',  cost: 'low',    speed: 'fast',   path: '/audio/transcriptions',    available: false },
    'openai/gpt-4o-transcribe':           { label: 'GPT-4o Transcribe (STT — coming soon)', cost: 'medium', speed: 'medium', path: '/audio/transcriptions',    available: false },
});

/**
 * Return the curated model list as serialisable rows.
 * @returns {Array<{ id: string, label: string, cost: string, speed: string, available: boolean, default: boolean }>}
 */
export function listModels() {
    return AUDIO_MODEL_IDS.map((id) => {
        const meta = MODEL_METADATA[id] || { label: id, cost: 'unknown', speed: 'unknown', available: false };
        return {
            id,
            label: meta.label,
            cost: meta.cost,
            speed: meta.speed,
            available: meta.available,
            default: id === DEFAULT_MODEL,
        };
    });
}

/**
 * Whether a model id is a curated, currently-available (chat-path) model.
 * @param {string} id
 * @returns {boolean}
 */
export function isAvailableModel(id) {
    const meta = MODEL_METADATA[id];
    return !!(meta && meta.available);
}
