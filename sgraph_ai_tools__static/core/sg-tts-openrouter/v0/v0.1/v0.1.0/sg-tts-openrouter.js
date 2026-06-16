/**
 * sg-tts-openrouter — OpenRouter (cloud) text-to-speech, as a versioned core
 * module so consumers (incl. vault-powered websites) import it by a stable,
 * CORS-enabled `/core/` URL — the same contract as sg-audio-decode.
 *
 * Audio output REQUIRES `stream:true`, and when streaming the only supported
 * `audio.format` is `pcm16` (NOT `wav`, which 400s) — the audio arrives as
 * incremental base64 `delta.audio.data` PCM16 chunks, which we concatenate (as
 * bytes, per chunk — base64 strings can't be safely joined) and wrap in a WAV
 * header ourselves. `fetchImpl` is injectable so this is unit-testable in Node.
 *
 * @module core/sg-tts-openrouter
 */

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
/** OpenAI gpt-audio streams 16-bit PCM at 24 kHz, mono. */
export const OPENROUTER_TTS_SAMPLE_RATE = 24000;
/** OpenAI voices available on the OpenRouter audio path. */
export const TTS_OPENROUTER_VOICES = Object.freeze(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
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

/** base64 → bytes. */
export function base64ToBytes(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
}

/** base64 → Blob. */
export function base64ToBlob(b64, mime = 'audio/wav') {
    return new Blob([base64ToBytes(b64)], { type: mime });
}

/** Wrap raw little-endian 16-bit mono PCM bytes in a WAV container. */
export function pcm16ToWav(pcmBytes, sampleRate = OPENROUTER_TTS_SAMPLE_RATE) {
    const dataLen = pcmBytes.length;
    const buf = new ArrayBuffer(44 + dataLen);
    const dv = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE');
    ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, dataLen, true);
    new Uint8Array(buf, 44).set(pcmBytes);
    return new Blob([buf], { type: 'audio/wav' });
}

/**
 * OpenRouter audio-output synthesis → WAV.
 * @param {string} text
 * @param {{ apiKey: string, voice?: string, model?: string, fetchImpl?: Function }} opts
 * @returns {Promise<{ blob: Blob, durationMs: number, mode: 'openrouter', generationId?: string, transcript: string }>}
 */
export async function synthesizeOpenRouter(text, opts = {}) {
    const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) throw Object.assign(new Error('fetch unavailable'), { code: 'no-fetch' });
    if (!opts.apiKey) throw Object.assign(new Error('OpenRouter key required for cloud TTS'), { code: 'no-key' });
    const res = await fetchImpl(OPENROUTER, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
            model: opts.model || TTS_OPENROUTER_DEFAULT_MODEL,
            modalities: ['text', 'audio'],
            // 'pcm16' is the only streamable format ('wav' → HTTP 400 when stream=true).
            audio: { voice: opts.voice || TTS_OPENROUTER_VOICES[0], format: 'pcm16' },
            stream: true, // audio output requires streaming
            messages: [{ role: 'user', content: `Read this text aloud, verbatim, with no preamble:\n\n${text}` }],
        }),
    });
    if (!res || !res.ok) {
        let detail = ''; try { detail = (await res.text()).slice(0, 200); } catch (_) { /* */ }
        throw Object.assign(new Error(`Cloud TTS failed (HTTP ${res && res.status})${detail ? ': ' + detail : ''}`), { code: 'tts-http' });
    }
    if (!res.body || !res.body.getReader) throw Object.assign(new Error('Streaming not supported here'), { code: 'tts-no-stream' });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const pcmParts = []; let total = 0;
    let buf = '', transcript = '', generationId;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let obj; try { obj = JSON.parse(payload); } catch (_) { continue; }
            generationId = generationId || obj.id;
            const a = obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.audio;
            if (a) {
                if (a.data) { const b = base64ToBytes(a.data); pcmParts.push(b); total += b.length; }
                if (a.transcript) transcript += a.transcript;
            }
        }
    }
    if (!total) throw Object.assign(new Error('No audio in the model response'), { code: 'tts-no-audio' });
    const pcm = new Uint8Array(total); let off = 0;
    for (const p of pcmParts) { pcm.set(p, off); off += p.length; }
    const durationMs = Math.round((total / 2) / OPENROUTER_TTS_SAMPLE_RATE * 1000);
    return { blob: pcm16ToWav(pcm, OPENROUTER_TTS_SAMPLE_RATE), durationMs, mode: 'openrouter', generationId, transcript };
}
