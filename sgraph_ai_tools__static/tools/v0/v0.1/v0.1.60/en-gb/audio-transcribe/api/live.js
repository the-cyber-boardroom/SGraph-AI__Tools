/**
 * live — Live (near-realtime) transcription session (Phase 1).
 *
 * Captures the mic continuously and, every `intervalMs`, transcribes the audio
 * SO FAR (a growing take) via the injected `transcribe(blob)` — so the displayed
 * transcript refines as you speak. On stop it does one final pass and returns the
 * full take + transcript (which the tool turns into a normal queue item).
 *
 * This is the simplest pseudo-streaming approach (no backend, reuses the existing
 * transport): growing-window, refine-in-place, no overlap/merge yet. True chunk
 * + merge + parallel runners is Phase 2/3 (see the architect plan).
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
 * @param {number} [ctx.intervalMs=2500]
 * @returns {{ start: Function, stop: Function, getStream: () => MediaStream|null, isRunning: () => boolean }}
 */
export function createLiveSession({ transcribe, getModel, onUpdate, onError, onSegment, intervalMs = 2500 }) {
    let stream = null, recorder = null, chunks = [], timer = null, polling = false, startedAt = 0, mime = '', seq = 0;

    /** Transcribe the current growing take, reporting it as one numbered segment. */
    async function runSegment(final) {
        const blob = new Blob(chunks, { type: mime });
        const sizeBytes = blob.size;
        const n = ++seq;
        const t0 = Date.now();
        try {
            const r = await transcribe({ blob, name: `live.${extOf(mime)}`, model: getModel && getModel() });
            const elapsedMs = Date.now() - startedAt;
            if (onUpdate) onUpdate({ text: r.text, elapsedMs, final });
            if (onSegment) onSegment({
                seq: n, sizeBytes, elapsedMs, latencyMs: Date.now() - t0, text: r.text, final, ok: true,
                generationId: r.generationId, costUsd: r.costUsd,
                promptTokens: r.promptTokens, completionTokens: r.completionTokens,
            });
            return r.text;
        } catch (err) {
            if (onError) onError(err);
            if (onSegment) onSegment({ seq: n, sizeBytes, elapsedMs: Date.now() - startedAt, latencyMs: Date.now() - t0, final, ok: false, error: err.message, code: err.code });
            return '';
        }
    }

    async function poll() {
        if (polling || !chunks.length) return;
        polling = true;
        try { await runSegment(false); }
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
        recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
        recorder.start(1000);
        startedAt = Date.now();
        seq = 0;
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
        const blob = new Blob(chunks, { type: mime });
        const durationMs = Date.now() - startedAt;
        let text = '';
        if (blob.size) text = await runSegment(true); // final pass = the last segment
        const name = `live-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${extOf(mime)}`;
        return { blob, mimeType: mime, durationMs, text, name };
    }

    return { start, stop, getStream: () => stream, isRunning: () => !!timer };
}
