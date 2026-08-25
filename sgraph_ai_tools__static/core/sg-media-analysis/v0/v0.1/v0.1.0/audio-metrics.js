/**
 * audio-metrics — framewise measurement of a recording's audio.
 *
 * Three quantities per frame, and each answers a question a single RMS number
 * cannot:
 *
 *   rms       how loud
 *   dbfs      how loud, on the scale everyone else uses (silencedetect, ebur128)
 *   flatness  how BROADBAND — the one that distinguishes "quiet but noisy" from
 *             "quiet and empty". Mains hum and room tone are narrow-band (low
 *             flatness); speech is broadband (high). A recording whose floor is
 *             loud but narrow-band is exactly the case that defeated an absolute
 *             RMS threshold in narrated-review v0.1.4.
 *
 * Nothing here decides anything. Thresholds, gaps and strategies are downstream
 * (see distributions.js, plan.js) so that the measurement stays separable from
 * the judgement.
 *
 * @module sg-media-analysis/audio-metrics
 * @version 0.1.0
 */

import { decodeToPcm } from '/core/sg-audio-decode/v0/v0.1/v0.1.0/sg-audio-decode.js';

/** Spectral flatness needs a power-of-two window; 512 @ 48k ≈ 10.7 ms. */
const FFT_SIZE = 512;

/**
 * Decode any media blob to one mono Float32 track.
 *
 * `decodeToPcm` handles a video container directly on every browser that can
 * decode its audio codec, so the common case costs no WASM at all.
 *
 * @param {Blob} blob
 * @param {{ hintName?: string }} [opts]
 * @returns {Promise<{ mono: Float32Array, sampleRate: number, channels: number }>}
 */
export async function decodeMono(blob, opts = {}) {
    const { channelData, sampleRate } = await decodeToPcm(blob, opts);
    if (!channelData || !channelData.length) {
        throw Object.assign(new Error('No audio track could be decoded'), { code: 'not-audio' });
    }
    const n = channelData[0].length;
    const mono = new Float32Array(n);
    for (const ch of channelData) {
        for (let i = 0; i < n; i++) mono[i] += ch[i] / channelData.length;
    }
    return { mono, sampleRate, channels: channelData.length };
}

/** Linear amplitude → dBFS. Silence floors at -100 rather than -Infinity. */
export function toDbfs(v) {
    return v > 1e-5 ? 20 * Math.log10(v) : -100;
}

/**
 * Spectral flatness = geometric mean / arithmetic mean of the power spectrum.
 * 0 → a pure tone, 1 → white noise. Speech sits high, hum sits very low.
 *
 * Uses a plain O(n²) DFT on a 512-point window because it runs on a small
 * fraction of frames (see `framewise`), and a real FFT would be the only thing
 * in this module needing a dependency.
 */
export function spectralFlatness(samples, from, size) {
    const N = Math.min(size, samples.length - from);
    if (N < 32) return 0;
    let logSum = 0, sum = 0, bins = 0;
    // Half the spectrum is enough (real input ⇒ symmetric).
    const step = Math.max(1, Math.floor(N / 64));       // 32 bins is plenty for a ratio
    for (let k = step; k < N / 2; k += step) {
        let re = 0, im = 0;
        for (let n = 0; n < N; n++) {
            const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1));   // Hann
            const a = -2 * Math.PI * k * n / N;
            const s = samples[from + n] * w;
            re += s * Math.cos(a);
            im += s * Math.sin(a);
        }
        const power = (re * re + im * im) / N + 1e-12;
        logSum += Math.log(power);
        sum += power;
        bins += 1;
    }
    if (!bins) return 0;
    return Math.exp(logSum / bins) / (sum / bins);
}

/**
 * Framewise metrics over a mono track.
 *
 * @param {Float32Array} mono
 * @param {number} sampleRate
 * @param {{ frameMs?: number, flatnessEvery?: number }} [opts]
 *   `frameMs` 20 matches narrated-review's PCM store, so the numbers here are
 *   directly comparable to what the pipeline actually sees.
 *   `flatnessEvery` computes flatness on 1-in-N frames (it is the expensive one).
 * @returns {{ frameMs, frames, rms: Float32Array, dbfs: Float32Array, flatness: Float32Array }}
 */
export function framewise(mono, sampleRate, opts = {}) {
    const frameMs = opts.frameMs || 20;
    const every = opts.flatnessEvery || 5;
    const per = Math.max(1, Math.round(frameMs * sampleRate / 1000));
    const frames = Math.floor(mono.length / per) || (mono.length ? 1 : 0);
    const rms = new Float32Array(frames);
    const dbfs = new Float32Array(frames);
    const flatness = new Float32Array(frames);

    let lastFlat = 0;
    for (let f = 0; f < frames; f++) {
        const from = f * per;
        const to = Math.min(from + per, mono.length);
        let acc = 0;
        for (let i = from; i < to; i++) acc += mono[i] * mono[i];
        const v = Math.sqrt(acc / Math.max(1, to - from));
        rms[f] = v;
        dbfs[f] = toDbfs(v);
        if (f % every === 0) lastFlat = spectralFlatness(mono, from, FFT_SIZE);
        flatness[f] = lastFlat;                       // held between computations
    }
    return { frameMs, frames, rms, dbfs, flatness };
}

/**
 * Everything the audio lane produces, ready for distributions.js.
 * @param {Blob} blob
 * @param {{ frameMs?: number, hintName?: string }} [opts]
 */
export async function analyseAudio(blob, opts = {}) {
    const { mono, sampleRate, channels } = await decodeMono(blob, opts);
    const fw = framewise(mono, sampleRate, opts);
    return { ...fw, sampleRate, channels, durationMs: Math.round(1000 * mono.length / sampleRate) };
}
