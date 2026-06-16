/**
 * live — Live (near-realtime) transcription session.
 *
 * Captures the mic continuously and, every `intervalMs`, transcribes ONLY THE
 * NEW audio since the last poll (a delta), so cost grows ~linearly with how long
 * you speak (not quadratically — the old "growing window" re-sent the whole take
 * each poll). The live transcript is the deltas reassembled BY SEQUENCE NUMBER
 * (contiguous prefix), so it stays correct even when shorter intervals make
 * requests overlap and OpenRouter answers them OUT OF ORDER. On stop, one
 * full-quality pass over the whole take produces the clean saved transcript.
 *
 * Chunking is TIME-based (the interval), not silence/VAD — a smart silence-aware
 * mode is a future option. `intervalMs` is settable per session (start({intervalMs}))
 * so the UI can trade responsiveness/cost against accuracy. Concurrency is bounded
 * by `maxInFlight` (backpressure: a tick coalesces into the next delta when full).
 *
 * Decodable deltas: MediaRecorder puts the webm/ogg init segment (header) only in
 * the first chunk, so each delta is `[headerChunk, ...newChunks]` — a valid clip
 * of just the new audio. The continuous recording is kept intact for the final
 * pass + the saved file (no gaps).
 *
 * @module audio-transcribe/live
 */

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
function bestMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    for (const m of PREFERRED) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) { /* */ } }
    return '';
}
function extOf(m) { return m.includes('mp4') ? 'm4a' : (m.includes('ogg') ? 'opus' : 'webm'); }

/**
 * @param {object} ctx
 * @param {(req: { blob: Blob, name: string, model: string }) => Promise<{ text: string }>} ctx.transcribe
 * @param {() => string} ctx.getModel
 * @param {(u: { text: string, elapsedMs: number, final: boolean }) => void} [ctx.onUpdate]
 * @param {(err: Error) => void} [ctx.onError]
 * @param {(s: object) => void} [ctx.onSegment]
 * @param {number} [ctx.intervalMs=2500]  default poll interval (overridable per start)
 * @param {number} [ctx.maxInFlight=4]    max concurrent delta requests
 * @returns {{ start: Function, stop: Function, getStream: () => MediaStream|null, isRunning: () => boolean }}
 */
export function createLiveSession({ transcribe, getModel, onUpdate, onError, onSegment, intervalMs = 2500, maxInFlight = 4 }) {
    let stream = null, recorder = null, chunks = [], timer = null, startedAt = 0, mime = '';
    let seq = 0, sentIndex = 0, headerChunk = null, inFlight = 0, curInterval = intervalMs;
    /** seq → completed delta text (empty string on a failed/empty delta). */
    const deltaText = new Map();
    /** in-flight delta promises (so stop() can drain before assembling/saving). */
    const pending = new Set();

    /** Live preview = the CONTIGUOUS prefix of completed deltas, in seq order.
     *  Stopping at the first gap keeps the text ordered even if a later delta
     *  (e.g. a faster, shorter request) finishes before an earlier one. */
    function buildLiveText() {
        const out = [];
        for (let i = 1; i <= seq; i++) {
            if (!deltaText.has(i)) break; // a still-in-flight earlier delta → wait
            const t = deltaText.get(i);
            if (t) out.push(t);
        }
        return out.join(' ');
    }

    async function transcribeDelta(n, blob, sizeBytes) {
        const t0 = Date.now();
        try {
            const r = await transcribe({ blob, name: `live.${extOf(mime)}`, model: getModel && getModel() });
            deltaText.set(n, (r.text || '').trim());
            if (onUpdate) onUpdate({ text: buildLiveText(), elapsedMs: Date.now() - startedAt, final: false });
            if (onSegment) onSegment({
                seq: n, sizeBytes, elapsedMs: Date.now() - startedAt, latencyMs: Date.now() - t0,
                text: (r.text || '').trim(), delta: true, final: false, ok: true,
                generationId: r.generationId, costUsd: r.costUsd, promptTokens: r.promptTokens, completionTokens: r.completionTokens,
            });
        } catch (err) {
            deltaText.set(n, ''); // keep the ordering chain intact past a failed delta
            if (onError) onError(err);
            if (onSegment) onSegment({ seq: n, sizeBytes, elapsedMs: Date.now() - startedAt, latencyMs: Date.now() - t0, delta: true, final: false, ok: false, error: err.message, code: err.code });
        } finally { inFlight -= 1; }
    }

    /** One full-quality pass over the WHOLE take — the clean saved transcript. */
    async function runFinal(fullBlob, durationMs) {
        const n = ++seq; const t0 = Date.now();
        try {
            const r = await transcribe({ blob: fullBlob, name: `live.${extOf(mime)}`, model: getModel && getModel() });
            const text = (r.text || '').trim() || buildLiveText();
            if (onUpdate) onUpdate({ text, elapsedMs: durationMs, final: true });
            if (onSegment) onSegment({ seq: n, sizeBytes: fullBlob.size, elapsedMs: durationMs, latencyMs: Date.now() - t0, text, delta: false, final: true, ok: true, generationId: r.generationId, costUsd: r.costUsd, promptTokens: r.promptTokens, completionTokens: r.completionTokens });
            return text;
        } catch (err) {
            if (onError) onError(err);
            if (onSegment) onSegment({ seq: n, sizeBytes: fullBlob.size, elapsedMs: durationMs, latencyMs: Date.now() - t0, delta: false, final: true, ok: false, error: err.message, code: err.code });
            return buildLiveText();
        }
    }

    /** Fire a delta for the new audio since the last tick (non-blocking, bounded). */
    function tick() {
        if (!chunks.length) return;
        if (!headerChunk) headerChunk = chunks[0];
        const fresh = chunks.slice(sentIndex);
        if (!fresh.length) return;
        if (inFlight >= maxInFlight) return; // backpressure → coalesces into the next delta
        const from = sentIndex;
        sentIndex = chunks.length;
        const parts = from === 0 ? fresh : [headerChunk, ...fresh];
        const blob = new Blob(parts, { type: mime });
        const n = ++seq;
        inFlight += 1;
        const pr = transcribeDelta(n, blob, blob.size);
        pending.add(pr); pr.finally(() => pending.delete(pr));
    }

    async function start(opts = {}) {
        // Graceful in an embedded/sandboxed (null-origin) vault frame: there
        // navigator.mediaDevices is undefined, so guard instead of bare-throwing.
        if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw Object.assign(new Error('Microphone unavailable in this context — an embedded/sandboxed frame blocks it unless the host grants allow="microphone" on a secure (https) context. Try the standalone tool, or drop an audio file instead.'), { code: 'mic-unavailable' });
        }
        if (typeof MediaRecorder === 'undefined') {
            throw Object.assign(new Error('Audio recording is unavailable in this browser/context (MediaRecorder missing). Drop an audio file instead.'), { code: 'mic-unavailable' });
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        mime = bestMime();
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        mime = recorder.mimeType || mime;
        chunks = [];
        seq = 0; sentIndex = 0; headerChunk = null; inFlight = 0;
        deltaText.clear(); pending.clear();
        curInterval = opts.intervalMs || curInterval;
        recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
        // Chunk cadence ≤ the interval so each delta window has fresh data.
        recorder.start(Math.min(1000, curInterval));
        startedAt = Date.now();
        timer = setInterval(tick, curInterval);
        return { mimeType: mime, intervalMs: curInterval };
    }

    async function stop(finalPass = true) {
        if (timer) { clearInterval(timer); timer = null; }
        if (recorder && recorder.state !== 'inactive') {
            await new Promise((res) => {
                recorder.addEventListener('stop', res, { once: true });
                try { recorder.requestData(); } catch (_) { /* */ }
                recorder.stop();
            });
        }
        if (stream) stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mime }); // the full, continuous take
        const durationMs = Date.now() - startedAt;
        let text;
        if (finalPass && blob.size) {
            await Promise.allSettled([...pending]); // let interim deltas settle (the final pass overrides anyway)
            text = await runFinal(blob, durationMs);
        } else {
            tick(); // capture the tail window as a last delta
            await Promise.allSettled([...pending]);
            text = buildLiveText();
            if (onUpdate) onUpdate({ text, elapsedMs: durationMs, final: true });
        }
        const name = `live-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${extOf(mime)}`;
        return { blob, mimeType: mime, durationMs, text, name };
    }

    return { start, stop, getStream: () => stream, isRunning: () => !!timer };
}
