/**
 * live — Live (near-realtime) transcription session.
 *
 * Captures the mic continuously and, every `intervalMs`, transcribes ONLY THE
 * NEW audio since the last poll (a delta), so cost grows ~linearly with how long
 * you speak. The live transcript is the deltas reassembled BY SEQUENCE NUMBER
 * (contiguous prefix), so it stays correct even when shorter intervals make
 * requests overlap and OpenRouter answers them OUT OF ORDER. On stop, one
 * full-quality pass over the whole take produces the clean saved transcript.
 *
 * Decodable deltas — the SUBTLE BIT: a later webm chunk is a bare "Cluster" that
 * can't be decoded without the file's init segment (header). MediaRecorder ships
 * the init segment in the FIRST chunk — but with a 1s timeslice that first chunk
 * is init segment + the first ~1s of AUDIO. Prepending the whole first chunk
 * therefore injected the opening words into every delta (the "Let's Let's" bug).
 * So we extract just the init segment (the bytes BEFORE the first Cluster) and
 * prepend only that. The continuous recording is kept intact for the final pass.
 *
 * Silence gate (optional): an AnalyserNode tracks the peak RMS since the last
 * send; a delta whose window stayed below `silenceThreshold` is skipped (not
 * sent, not billed, no hallucinated filler on silence).
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

/** Extract the webm init segment (everything before the first Cluster element)
 *  from the first chunk, so prepending it to a later delta adds NO stale audio.
 *  Falls back to the whole blob (old behaviour) if no Cluster id is found. */
export async function extractInitSegment(firstChunk, mime) {
    try {
        const buf = new Uint8Array(await firstChunk.arrayBuffer());
        // EBML id for Cluster = 0x1F43B675. The init segment (EBML header +
        // Segment + Info + Tracks) precedes the first Cluster.
        for (let i = 0; i + 4 <= buf.length; i++) {
            if (buf[i] === 0x1F && buf[i + 1] === 0x43 && buf[i + 2] === 0xB6 && buf[i + 3] === 0x75) {
                return new Blob([buf.slice(0, i)], { type: mime });
            }
        }
    } catch (_) { /* fall through */ }
    return firstChunk; // non-webm / not found → whole first chunk (old behaviour)
}

/**
 * @param {object} ctx
 * @param {(req: { blob: Blob, name: string, model: string }) => Promise<{ text: string }>} ctx.transcribe
 * @param {() => string} ctx.getModel
 * @param {(u: { text: string, elapsedMs: number, final: boolean }) => void} [ctx.onUpdate]
 * @param {(err: Error) => void} [ctx.onError]
 * @param {(s: object) => void} [ctx.onSegment]  detail includes the delta `blob`
 * @param {number} [ctx.intervalMs=2500]
 * @param {number} [ctx.maxInFlight=4]
 * @param {boolean} [ctx.skipSilence=false]      default gate state (overridable per start)
 * @param {number} [ctx.silenceThreshold=0.01]   RMS below which a window is "silence"
 * @returns {{ start: Function, stop: Function, getStream: () => MediaStream|null, isRunning: () => boolean }}
 */
export function createLiveSession({ transcribe, getModel, onUpdate, onError, onSegment, intervalMs = 2500, maxInFlight = 4, skipSilence = false, silenceThreshold = 0.01 }) {
    let stream = null, recorder = null, chunks = [], timer = null, startedAt = 0, mime = '';
    let seq = 0, sentIndex = 0, headerBlob = null, headerPending = false, inFlight = 0, curInterval = intervalMs;
    let gateOn = skipSilence, gateThreshold = silenceThreshold;
    let audioCtx = null, analyser = null, sampleTimer = null, peakRms = 0;
    const deltaText = new Map();
    const pending = new Set();

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
                seq: n, sizeBytes, blob, elapsedMs: Date.now() - startedAt, latencyMs: Date.now() - t0,
                text: (r.text || '').trim(), delta: true, final: false, ok: true,
                generationId: r.generationId, costUsd: r.costUsd, promptTokens: r.promptTokens, completionTokens: r.completionTokens,
            });
        } catch (err) {
            deltaText.set(n, ''); // keep the ordering chain intact past a failed delta
            if (onError) onError(err);
            if (onSegment) onSegment({ seq: n, sizeBytes, blob, elapsedMs: Date.now() - startedAt, latencyMs: Date.now() - t0, delta: true, final: false, ok: false, error: err.message, code: err.code });
        } finally { inFlight -= 1; }
    }

    /** One full-quality pass over the WHOLE take — the clean saved transcript. */
    async function runFinal(fullBlob, durationMs) {
        const n = ++seq; const t0 = Date.now();
        try {
            const r = await transcribe({ blob: fullBlob, name: `live.${extOf(mime)}`, model: getModel && getModel() });
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

    /** Build the decodable delta blob for the window chunks[from..]. */
    function deltaBlob(from, fresh) {
        // First delta carries the real header+opening already; later deltas get
        // ONLY the init segment prepended (no stale opening audio).
        if (from === 0) return new Blob(fresh, { type: mime });
        return new Blob([headerBlob || chunks[0], ...fresh], { type: mime });
    }

    /** Fire a delta for the new audio since the last tick (non-blocking, bounded). */
    function tick() {
        if (!chunks.length) return;
        const fresh = chunks.slice(sentIndex);
        if (!fresh.length) return;
        const from = sentIndex;
        // Later deltas need the extracted init segment; wait one tick if it's not
        // ready yet (it's computed from the first chunk, async).
        if (from > 0 && !headerBlob) return;
        if (inFlight >= maxInFlight) return; // backpressure → coalesces into the next delta

        // Silence gate: if this window stayed quiet, drop it (don't send/charge).
        const peak = peakRms; peakRms = 0;
        if (gateOn && analyser && peak < gateThreshold) { sentIndex = chunks.length; return; }

        sentIndex = chunks.length;
        const blob = deltaBlob(from, fresh);
        const n = ++seq;
        inFlight += 1;
        const pr = transcribeDelta(n, blob, blob.size);
        pending.add(pr); pr.finally(() => pending.delete(pr));
    }

    /** Start an AnalyserNode on the stream to measure loudness (for the gate). */
    function startMeter() {
        if (typeof window === 'undefined') return; // headless (Node) → no gate
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            audioCtx = new AC();
            if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
            const src = audioCtx.createMediaStreamSource(stream);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 1024;
            src.connect(analyser); // not connected to destination → no playback
            const buf = new Float32Array(analyser.fftSize);
            sampleTimer = setInterval(() => {
                analyser.getFloatTimeDomainData(buf);
                let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
                const rms = Math.sqrt(sum / buf.length);
                if (rms > peakRms) peakRms = rms;
            }, 80);
        } catch (_) { analyser = null; }
    }
    function stopMeter() {
        if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
        try { if (audioCtx) audioCtx.close(); } catch (_) { /* */ }
        audioCtx = null; analyser = null; peakRms = 0;
    }

    async function start(opts = {}) {
        // Graceful in an embedded/sandboxed (null-origin) vault frame.
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
        seq = 0; sentIndex = 0; headerBlob = null; headerPending = false; inFlight = 0; peakRms = 0;
        deltaText.clear(); pending.clear();
        curInterval = opts.intervalMs || curInterval;
        if (opts.skipSilence != null) gateOn = !!opts.skipSilence;
        if (typeof opts.silenceThreshold === 'number') gateThreshold = opts.silenceThreshold;
        recorder.addEventListener('dataavailable', (e) => {
            if (!(e.data && e.data.size)) return;
            chunks.push(e.data);
            // Compute the pure init segment once, from the first chunk.
            if (chunks.length === 1 && !headerBlob && !headerPending) {
                headerPending = true;
                extractInitSegment(e.data, mime).then((h) => { headerBlob = h; }).finally(() => { headerPending = false; });
            }
        });
        recorder.start(Math.min(1000, curInterval)); // chunk cadence ≤ the interval
        startedAt = Date.now();
        startMeter();
        timer = setInterval(tick, curInterval);
        return { mimeType: mime, intervalMs: curInterval, skipSilence: gateOn };
    }

    async function stop(finalPass = true) {
        if (timer) { clearInterval(timer); timer = null; }
        stopMeter();
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
            await Promise.allSettled([...pending]);
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
