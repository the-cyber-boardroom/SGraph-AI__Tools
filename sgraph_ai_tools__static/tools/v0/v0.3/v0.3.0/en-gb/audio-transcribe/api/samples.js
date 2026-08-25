/**
 * samples — one-click sample audio for easy testing (simulates a drop).
 *
 * Two kinds:
 *   - 'tone'  : synthesised in-browser (no network) — instantly populates the
 *               queue to exercise the player / panel / queue / cost flow offline.
 *               (A pure tone won't transcribe to words — it's for pipeline/UX.)
 *   - 'url'   : fetched from a CORS-enabled host — use for REAL speech samples to
 *               test transcription accuracy. Add entries here as they're sourced.
 *
 * `buildSampleFile(sample)` returns a File so it flows through the normal
 * addFiles() ingest path exactly like a dropped file.
 *
 * @module audio-transcribe/samples
 */

/** @typedef {{ id: string, label: string, kind: 'tone'|'url', name: string, seconds?: number, freq?: number, url?: string, mime?: string }} Sample */

/** @type {ReadonlyArray<Sample>} */
export const SAMPLES = Object.freeze([
    { id: 'tone-a', label: '🔊 Test tone A (440 Hz · 2s)', kind: 'tone', name: 'sample-tone-a.wav', seconds: 2, freq: 440 },
    { id: 'tone-b', label: '🔊 Test tone B (660 Hz · 3s)', kind: 'tone', name: 'sample-tone-b.wav', seconds: 3, freq: 660 },
    // Real-speech samples (for transcription testing) go here once a reliable
    // CORS-enabled source is confirmed, e.g.:
    // { id: 'speech-en', label: '🗣 Spoken sample (EN)', kind: 'url', name: 'speech-en.mp3', url: 'https://…', mime: 'audio/mpeg' },
]);

/**
 * Encode mono Float32 PCM as a 16-bit PCM WAV Blob.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Blob}
 */
function encodeWav(samples, sampleRate) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    const ws = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
    ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, n * 2, true);
    let off = 44;
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); dv.setInt16(off, s * 0x7fff, true); off += 2; }
    return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Synthesise a short tone (with a tiny fade to avoid clicks) as a WAV Blob.
 * @param {{ seconds?: number, freq?: number, sampleRate?: number }} [opts]
 * @returns {Blob}
 */
export function makeToneWav(opts = {}) {
    const sampleRate = opts.sampleRate || 16000;
    const seconds = opts.seconds || 2;
    const freq = opts.freq || 440;
    const n = Math.floor(sampleRate * seconds);
    const out = new Float32Array(n);
    const fade = Math.min(800, Math.floor(n / 8));
    for (let i = 0; i < n; i++) {
        let a = 0.3 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
        if (i < fade) a *= i / fade;
        else if (i > n - fade) a *= (n - i) / fade;
        out[i] = a;
    }
    return encodeWav(out, sampleRate);
}

/**
 * Build a File for a sample id (so it drops through addFiles()).
 * @param {string} id
 * @param {{ fetchImpl?: Function }} [deps]
 * @returns {Promise<File>}
 */
export async function buildSampleFile(id, deps = {}) {
    const s = SAMPLES.find((x) => x.id === id);
    if (!s) throw Object.assign(new Error(`Unknown sample: ${id}`), { code: 'unknown-sample' });
    if (s.kind === 'tone') {
        const blob = makeToneWav({ seconds: s.seconds, freq: s.freq });
        return new File([blob], s.name, { type: 'audio/wav' });
    }
    const fetchImpl = deps.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) throw Object.assign(new Error('fetch unavailable'), { code: 'no-fetch' });
    const res = await fetchImpl(s.url);
    if (!res || !res.ok) throw Object.assign(new Error(`Could not fetch sample (${res && res.status})`), { code: 'sample-fetch' });
    const blob = await res.blob();
    return new File([blob], s.name, { type: s.mime || blob.type || 'audio/mpeg' });
}
