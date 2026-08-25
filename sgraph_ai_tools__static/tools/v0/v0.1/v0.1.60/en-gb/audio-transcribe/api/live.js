/**
 * live — Live (near-realtime) transcription session.
 *
 * VAD-segmented: instead of cutting on a fixed clock (which split words and made
 * the model hallucinate), it captures PCM, runs energy Voice Activity Detection
 * (live-vad.js), and sends each COMPLETE utterance (a phrase between pauses) as a
 * clean WAV — so each clip transcribes well and gluing the clips ≈ the speech.
 * The live transcript is the utterances reassembled BY SEQUENCE NUMBER
 * (contiguous prefix), so out-of-order responses don't jump ahead. On stop, one
 * full-quality pass over the continuous webm take produces the clean saved
 * transcript. See team/explorer/architect/v0.2.73 for the design.
 *
 * Dependencies are injected so the orchestration is unit-testable:
 *   - `transcribe` (the LLM path), `encodeWav` (Float32 PCM → WAV Blob),
 *   - `makeCapture` (browser PCM capture; defaults to ./live-capture).
 *
 * @module audio-transcribe/live
 */

import { createVad } from './live-vad.js';
import { createCapture } from './live-capture.js';

function extOf(m) { return /mp4/.test(m) ? 'm4a' : (/ogg/.test(m) ? 'opus' : 'webm'); }

/** Default VAD tuning (energy-based). Overridable per session. */
export const VAD_DEFAULTS = Object.freeze({
    frameMs: 20, speechThreshold: 0.02, silenceThreshold: 0.01,
    endpointMs: 600, preRollMs: 300, minSpeechMs: 250, maxUtteranceMs: 15000,
});

/**
 * @param {object} ctx
 * @param {(req: { blob: Blob, name: string, model: string }) => Promise<object>} ctx.transcribe
 * @param {() => string} ctx.getModel
 * @param {(pcm: Float32Array, sampleRate: number) => Blob} ctx.encodeWav
 * @param {Function} [ctx.makeCapture]  defaults to createCapture (browser)
 * @param {(s: object) => void} [ctx.onSegment]   detail carries the sent WAV `blob`
 * @param {(u: object) => void} [ctx.onUpdate]
 * @param {(err: Error) => void} [ctx.onError]
 * @param {(rms: number) => void} [ctx.onLevel]   per-frame loudness (for the viz)
 * @returns {{ start, stop, getStream, getLevel, getThreshold, isRunning }}
 */
export function createLiveSession({ transcribe, getModel, encodeWav, makeCapture = createCapture, onSegment, onUpdate, onError, onLevel }) {
    let capture = null, vad = null, running = false;
    let seq = 0, startedAt = 0, lastRms = 0, sampleRate = 16000, takeMime = 'audio/webm';
    let conf = { ...VAD_DEFAULTS };
    const deltaText = new Map();   // seq → completed utterance text ('' on fail)
    const pending = new Set();

    function buildLiveText() {
        const out = [];
        for (let i = 1; i <= seq; i++) {
            if (!deltaText.has(i)) break; // an earlier utterance still in flight → wait
            const t = deltaText.get(i);
            if (t) out.push(t);
        }
        return out.join(' ');
    }

    async function transcribeClip(n, wav, meta) {
        const t0 = Date.now();
        try {
            const r = await transcribe({ blob: wav, name: `live.wav`, model: getModel && getModel() });
            deltaText.set(n, (r.text || '').trim());
            if (onUpdate) onUpdate({ text: buildLiveText(), elapsedMs: Date.now() - startedAt, final: false });
            if (onSegment) onSegment({
                seq: n, sizeBytes: wav.size, blob: wav, elapsedMs: meta.startMs, latencyMs: Date.now() - t0,
                text: (r.text || '').trim(), delta: true, final: false, ok: true,
                generationId: r.generationId, costUsd: r.costUsd, promptTokens: r.promptTokens, completionTokens: r.completionTokens,
            });
        } catch (err) {
            deltaText.set(n, ''); // keep the ordering chain intact past a failed clip
            if (onError) onError(err);
            if (onSegment) onSegment({ seq: n, sizeBytes: wav.size, blob: wav, elapsedMs: meta.startMs, latencyMs: Date.now() - t0, delta: true, final: false, ok: false, error: err.message, code: err.code });
        }
    }

    /** A VAD utterance closed → encode + transcribe it. */
    function onUtterance(pcm, meta) {
        if (!encodeWav || !pcm.length) return;
        const wav = encodeWav(pcm, sampleRate);
        const n = ++seq;
        const pr = transcribeClip(n, wav, meta);
        pending.add(pr); pr.finally(() => pending.delete(pr));
    }

    /** One full-quality pass over the WHOLE continuous take — the saved transcript. */
    async function runFinal(fullBlob, durationMs) {
        const n = ++seq; const t0 = Date.now();
        try {
            const r = await transcribe({ blob: fullBlob, name: `live.${extOf(takeMime)}`, model: getModel && getModel() });
            const text = (r.text || '').trim() || buildLiveText();
            if (onUpdate) onUpdate({ text, elapsedMs: durationMs, final: true });
            if (onSegment) onSegment({ seq: n, sizeBytes: fullBlob.size, blob: fullBlob, elapsedMs: durationMs, latencyMs: Date.now() - t0, text, delta: false, final: true, ok: true, generationId: r.generationId, costUsd: r.costUsd, promptTokens: r.promptTokens, completionTokens: r.completionTokens });
            return text;
        } catch (err) {
            if (onError) onError(err);
            if (onSegment) onSegment({ seq: n, sizeBytes: fullBlob.size, blob: fullBlob, elapsedMs: durationMs, latencyMs: Date.now() - t0, delta: false, final: true, ok: false, error: err.message, code: err.code });
            return buildLiveText();
        }
    }

    async function start(opts = {}) {
        conf = { ...VAD_DEFAULTS, ...(opts.vad || {}) };
        seq = 0; deltaText.clear(); pending.clear(); lastRms = 0;
        vad = createVad({ ...conf, onUtterance });
        // makeCapture throws { code:'mic-unavailable' } in a sandboxed/headless frame.
        capture = await makeCapture({
            frameMs: conf.frameMs,
            onFrame: (rms, frame) => { lastRms = rms; if (onLevel) onLevel(rms); vad.pushFrame(rms, frame); },
        });
        sampleRate = capture.sampleRate || sampleRate;
        takeMime = capture.mimeType || takeMime;
        running = true; startedAt = Date.now();
        return { mimeType: takeMime, sampleRate, vad: conf };
    }

    async function stop(finalPass = true) {
        running = false;
        const take = capture ? await capture.stop() : { blob: new Blob([], { type: takeMime }), mimeType: takeMime };
        if (vad) vad.flush(); // emit the last buffered utterance (all frames already delivered)
        await Promise.allSettled([...pending]);
        const blob = take.blob;
        const durationMs = Date.now() - startedAt;
        let text;
        if (finalPass && blob.size) {
            text = await runFinal(blob, durationMs);
        } else {
            text = buildLiveText();
            if (onUpdate) onUpdate({ text, elapsedMs: durationMs, final: true });
        }
        const name = `live-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${extOf(take.mimeType || takeMime)}`;
        capture = null; vad = null;
        return { blob, mimeType: take.mimeType || takeMime, durationMs, text, name };
    }

    return {
        start, stop,
        getStream: () => (capture ? capture.getStream() : null),
        getLevel: () => lastRms,
        getThreshold: () => ({ speech: conf.speechThreshold, silence: conf.silenceThreshold }),
        isRunning: () => running,
    };
}
