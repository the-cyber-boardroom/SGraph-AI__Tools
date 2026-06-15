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
export function createLiveSession({ transcribe, getModel, onUpdate, onError, intervalMs = 2500 }) {
    let stream = null, recorder = null, chunks = [], timer = null, polling = false, startedAt = 0, mime = '';

    async function poll() {
        if (polling || !chunks.length) return;
        polling = true;
        try {
            const blob = new Blob(chunks, { type: mime });
            const r = await transcribe({ blob, name: `live.${extOf(mime)}`, model: getModel && getModel() });
            if (onUpdate) onUpdate({ text: r.text, elapsedMs: Date.now() - startedAt, final: false });
        } catch (err) { if (onError) onError(err); }
        finally { polling = false; }
    }

    async function start() {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        mime = bestMime();
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        mime = recorder.mimeType || mime;
        chunks = [];
        recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
        recorder.start(1000);
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
        const blob = new Blob(chunks, { type: mime });
        const durationMs = Date.now() - startedAt;
        let text = '';
        if (blob.size) {
            try {
                const r = await transcribe({ blob, name: `live.${extOf(mime)}`, model: getModel && getModel() });
                text = r.text;
                if (onUpdate) onUpdate({ text, elapsedMs: durationMs, final: true });
            } catch (err) { if (onError) onError(err); }
        }
        const name = `live-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${extOf(mime)}`;
        return { blob, mimeType: mime, durationMs, text, name };
    }

    return { start, stop, getStream: () => stream, isRunning: () => !!timer };
}
