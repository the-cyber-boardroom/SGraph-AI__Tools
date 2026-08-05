/**
 * audio-router.js
 * Decision-2 route tree — get a transcription-ready audio blob from the job:
 *
 *   route 1 'native' — the recorder's separate audio stream (opus/webm), free.
 *   route 2 'remux'  — FFmpeg WASM stream-copy to .m4a (AAC-in-MP4 sources).
 *   route 3 'decode' — decodeAudioData → 16-bit WAV (WebM/Opus fallback).
 *
 * Routes are tried in order; each failure falls through to the next.
 * @module audio-router
 */

import { blobToWav } from '/core/sg-audio-decode/v0/v0.1/v0.1.0/sg-audio-decode.js';

/** Same soft cap as audio-transcribe ingest — base64 inflates requests ~33%. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const SG_VIDEO_PATH = '/core/video/v1/v1.0/v1.0.2/sg-video.js';

/**
 * @param {{ videoBlob: Blob, audioBlob?: Blob|null, filename?: string }} job
 * @param {{ onProgress?: (info: { stage: string }) => void }} [opts]
 * @returns {Promise<{ blob: Blob, route: 'native'|'remux'|'decode', mime: string, name: string, attempts: string[] }>}
 * @throws {Error & { code: 'no-audio-stream'|'too-large' }}
 */
export async function routeAudio(job, { onProgress } = {}) {
    const attempts = [];
    const base = (job.filename || 'recording').replace(/\.[^.]+$/, '');

    // Route 1 — native separate audio stream from the recorder.
    if (job.audioBlob && job.audioBlob.size > 0) {
        attempts.push('native');
        return _capped({
            blob: job.audioBlob, route: 'native',
            mime: job.audioBlob.type || 'audio/webm',
            name: `${base}_audio.webm`, attempts,
        });
    }

    // Route 2 — FFmpeg stream-copy remux (no re-encode). Fails on codecs that
    // can't live in an m4a container (e.g. WebM/Opus) — fall through.
    attempts.push('remux');
    try {
        onProgress?.({ stage: 'loading-ffmpeg' });
        const { loadFFmpeg, extractAudio } = await import(SG_VIDEO_PATH);
        const ffmpeg = await loadFFmpeg();
        onProgress?.({ stage: 'remuxing' });
        const r = await extractAudio(ffmpeg, _asFile(job.videoBlob, job.filename));
        return _capped({ blob: r.blob, route: 'remux', mime: 'audio/mp4', name: r.filename, attempts });
    } catch (_e) { /* fall through to decode */ }

    // Route 3 — decode the container's audio track to 16-bit WAV in-browser.
    attempts.push('decode');
    try {
        onProgress?.({ stage: 'decoding' });
        const wavBlob = await blobToWav(job.videoBlob);
        return _capped({ blob: wavBlob, route: 'decode', mime: 'audio/wav', name: `${base}_audio.wav`, attempts });
    } catch (err) {
        throw Object.assign(
            new Error(`No audio could be extracted (tried: ${attempts.join(' → ')}). ${err.message}`),
            { code: 'no-audio-stream' },
        );
    }
}

function _capped(result) {
    if (result.blob.size > MAX_AUDIO_BYTES) {
        const mb = (result.blob.size / (1024 * 1024)).toFixed(1);
        throw Object.assign(
            new Error(`Extracted audio is ${mb} MB — over the ${MAX_AUDIO_BYTES / (1024 * 1024)} MB transcription cap. Segmented transcription is not in v0.1.`),
            { code: 'too-large', route: result.route },
        );
    }
    return result;
}

function _asFile(blob, filename) {
    if (blob instanceof File && blob.name) return blob;
    const ext  = (blob.type || '').includes('mp4') ? '.mp4' : '.webm';
    const name = (filename || `recording${ext}`);
    return new File([blob], name, { type: blob.type || 'video/webm' });
}
