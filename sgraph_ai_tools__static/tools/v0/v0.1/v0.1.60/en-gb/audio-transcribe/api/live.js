/**
 * live — Live (near-realtime) transcription session.
 *
 * Captures the mic continuously and, every `intervalMs`, transcribes ONLY THE
 * NEW audio since the last poll (a delta) — so cost grows linearly with the
 * length you speak, NOT quadratically (the earlier "growing window" re-sent the
 * whole take every poll, which was wasteful). The live transcript is the deltas
 * appended together (a fast, slightly-rough preview). On stop it does ONE
 * full-quality pass over the whole take for the clean saved transcript.
 *
 * Making a delta decodable: MediaRecorder only puts the webm/ogg init segment
 * (header) in the FIRST chunk; later chunks are bare clusters that can't be
 * decoded alone. So each delta is `[headerChunk, ...newChunks]` — a valid little
 * clip of just the new audio. The continuous recording is kept intact for the
 * final pass + the saved file (so there are no gaps in the saved take).
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
 * @param {number} [ctx.intervalMs=2500]
 * @returns {{ start: Function, stop: Function, getStream: () => MediaStream|null, isRunning: () => boolean }}
 */
export function createLiveSession({ transcribe, getModel, onUpdate, onError, onSegment, intervalMs = 2500 }) {
    let stream = null, recorder = null, chunks = [], timer = null, polling = false, startedAt = 0, mime = '';
    let seq = 0, sentIndex = 0, headerChunk = null, liveText = '';

    /** Append a delta's text to the running live preview. */
    function appendLive(delta) {
        const d = (delta || '').trim();
        if (d) liveText = liveText ? `${liveText} ${d}` : d;
        return liveText;
    }

    /** Transcribe ONLY the audio captured since the last poll (a delta). */
    async function runDelta() {
        if (!chunks.length) return;
        if (!headerChunk) headerChunk = chunks[0];
        const fresh = chunks.slice(sentIndex);
        if (!fresh.length) return;
        // First delta already carries the header; later deltas prepend it so the
        // bare clusters are decodable on their own.
        const parts = sentIndex === 0 ? fresh : [headerChunk, ...fresh];
        sentIndex = chunks.length;
        const blob = new Blob(parts, { type: mime });
        const sizeBytes = blob.size;
        const n = ++seq;
        const t0 = Date.now();
        try {
            const r = await transcribe({ blob, name: `live.${extOf(mime)}`, model: getModel && getModel() });
            const text = appendLive(r.text);
            const elapsedMs = Date.now() - startedAt;
            if (onUpdate) onUpdate({ text, elapsedMs, final: false });
            if (onSegment) onSegment({
                seq: n, sizeBytes, elapsedMs, latencyMs: Date.now() - t0, text: (r.text || '').trim(),
                delta: true, final: false, ok: true,
                generationId: r.generationId, costUsd: r.costUsd,
                promptTokens: r.promptTokens, completionTokens: r.completionTokens,
            });
        } catch (err) {
            if (onError) onError(err);
            if (onSegment) onSegment({ seq: n, sizeBytes, elapsedMs: Date.now() - startedAt, latencyMs: Date.now() - t0, delta: true, final: false, ok: false, error: err.message, code: err.code });
        }
    }

    /** One full-quality pass over the WHOLE take — the clean saved transcript. */
    async function runFinal(fullBlob, durationMs) {
        const sizeBytes = fullBlob.size;
        const n = ++seq;
        const t0 = Date.now();
        try {
            const r = await transcribe({ blob: fullBlob, name: `live.${extOf(mime)}`, model: getModel && getModel() });
            const text = (r.text || '').trim() || liveText;
            if (onUpdate) onUpdate({ text, elapsedMs: durationMs, final: true });
            if (onSegment) onSegment({
                seq: n, sizeBytes, elapsedMs: durationMs, latencyMs: Date.now() - t0, text,
                delta: false, final: true, ok: true,
                generationId: r.generationId, costUsd: r.costUsd,
                promptTokens: r.promptTokens, completionTokens: r.completionTokens,
            });
            return text;
        } catch (err) {
            if (onError) onError(err);
            if (onSegment) onSegment({ seq: n, sizeBytes, elapsedMs: durationMs, latencyMs: Date.now() - t0, delta: false, final: true, ok: false, error: err.message, code: err.code });
            return liveText; // fall back to the live preview if the final pass fails
        }
    }

    async function poll() {
        if (polling || !chunks.length) return;
        polling = true;
        try { await runDelta(); }
        finally { polling = false; }
    }

    async function start() {
        // Graceful in an embedded/sandboxed (null-origin) vault frame: there
        // navigator.mediaDevices is undefined, so guard instead of bare-throwing.
        // The host must grant the iframe allow="microphone" + a secure context.
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
        seq = 0; sentIndex = 0; headerChunk = null; liveText = '';
        recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
        recorder.start(1000); // a chunk per second → deltas of ~intervalMs of new audio
        startedAt = Date.now();
        timer = setInterval(poll, intervalMs);
        return { mimeType: mime };
    }

    async function stop() {
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
        const text = blob.size ? await runFinal(blob, durationMs) : liveText;
        const name = `live-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${extOf(mime)}`;
        return { blob, mimeType: mime, durationMs, text, name };
    }

    return { start, stop, getStream: () => stream, isRunning: () => !!timer };
}
