/**
 * kokoro-worker.js
 * Runs KokoroTTS in a Web Worker so the main thread stays responsive.
 *
 * Messages IN (from main thread):
 *   { type: 'load',     cdnUrl }
 *   { type: 'generate', id, sentences: string[], voice, speed }
 *
 * Messages OUT (to main thread):
 *   { type: 'loading',  message }
 *   { type: 'ready',    voices: string[] }
 *   { type: 'progress', id, index, total, sentence }
 *   { type: 'chunk',    id, index, total, sentence, samples: Float32Array, sampleRate }
 *   { type: 'done',     id }
 *   { type: 'error',    id?, message }
 */

let tts = null;

// ─────────────────────────────────────────────────────────────────────────────
// Model loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadModel(cdnUrl) {
    self.postMessage({ type: 'loading', message: `Importing kokoro-js from ${cdnUrl}…` });

    const mod = await import(cdnUrl);
    const KokoroTTS = mod.KokoroTTS ?? mod.default?.KokoroTTS;
    if (!KokoroTTS) {
        throw new Error(`KokoroTTS not found in module. Exports: ${Object.keys(mod).join(', ')}`);
    }

    self.postMessage({ type: 'loading', message: 'Calling from_pretrained() — downloading model (~160MB on first run)…' });

    tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8' });

    // Detect voices
    let voices = [];
    if (typeof tts.list_voices === 'function') {
        voices = tts.list_voices();
    }
    if ((!voices || voices.length === 0) && tts.voices) {
        voices = Array.isArray(tts.voices) ? tts.voices : Object.keys(tts.voices);
    }

    self.postMessage({ type: 'ready', voices });
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio extraction — same multi-shape logic as the probe
// ─────────────────────────────────────────────────────────────────────────────

function extractAudio(audio) {
    let samples = null;
    let sampleRate = 24000;

    if (audio instanceof Float32Array) {
        samples = audio;
    } else if (audio?.audio instanceof Float32Array) {
        samples = audio.audio;
        sampleRate = audio.sampling_rate ?? sampleRate;
    } else if (audio?.data instanceof Float32Array) {
        samples = audio.data;
        sampleRate = audio.sampling_rate ?? sampleRate;
    } else if (Array.isArray(audio?.data)) {
        samples = new Float32Array(audio.data);
        sampleRate = audio.sampling_rate ?? sampleRate;
    } else if (audio?.[0] instanceof Float32Array) {
        samples = audio[0];
        sampleRate = typeof audio[1] === 'number' ? audio[1] : sampleRate;
    } else if (audio?.audio?.data instanceof Float32Array) {
        samples = audio.audio.data;
        sampleRate = audio.audio.sampling_rate ?? sampleRate;
    }

    if (!samples) {
        throw new Error(`Unknown audio shape. Keys: ${audio ? Object.keys(audio).join(', ') : typeof audio}`);
    }

    return { samples, sampleRate };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation — sentence by sentence
// ─────────────────────────────────────────────────────────────────────────────

async function generate({ id, sentences, voice, speed }) {
    if (!tts) {
        self.postMessage({ type: 'error', id, message: 'Model not loaded — send load message first' });
        return;
    }

    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i].trim();
        if (!sentence) continue;

        self.postMessage({ type: 'progress', id, index: i, total: sentences.length, sentence });

        const audio = await tts.generate(sentence, { voice, speed });
        const { samples, sampleRate } = extractAudio(audio);

        // Transfer the ArrayBuffer (zero-copy) — avoids cloning 300KB+ Float32Array
        self.postMessage(
            { type: 'chunk', id, index: i, total: sentences.length, sentence, samples, sampleRate },
            [samples.buffer]
        );
    }

    self.postMessage({ type: 'done', id });
}

// ─────────────────────────────────────────────────────────────────────────────
// Message router
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('message', async (e) => {
    const { type } = e.data;

    if (type === 'load') {
        try {
            await loadModel(e.data.cdnUrl);
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
        return;
    }

    if (type === 'generate') {
        try {
            await generate(e.data);
        } catch (err) {
            self.postMessage({ type: 'error', id: e.data.id, message: err.message });
        }
        return;
    }
});
