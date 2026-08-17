/**
 * live-capture — browser mic capture for live mode.
 *
 * Two consumers of one mic stream:
 *   1. A MediaRecorder → a compact, continuous webm for the SAVED take + the
 *      final-quality pass (one valid file, no fragment surgery).
 *   2. A Web Audio graph (AudioWorklet, ScriptProcessor fallback) → raw mono PCM
 *      frames + per-frame RMS, fed to the VAD so we can cut clean WAV clips at
 *      the silences (sample-accurate; no webm-cluster hacks → playback works).
 *
 * Browser-only (uses getUserMedia / MediaRecorder / AudioContext). Injected into
 * createLiveSession as `makeCapture` so the orchestration stays unit-testable.
 *
 * Promoted verbatim from tools v0.1.60 audio-transcribe api/live-capture.js
 * (Phase R2 of the narrated-review pack) — behaviour identical, contract frozen.
 *
 * @module sg-live-capture/live-capture
 * @version 0.1.0
 */

const REC_PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
function bestRecMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    for (const m of REC_PREFERRED) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) { /* */ } }
    return '';
}

// Tiny worklet: post each mono render-quantum (128 samples) to the main thread.
const WORKLET_SRC = "class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c&&c.length)this.port.postMessage(c.slice());return true;}}registerProcessor('sg-pcm',P);";

/**
 * @param {{ onFrame: (rms: number, frame: Float32Array) => void, frameMs?: number, targetRate?: number }} opts
 * @returns {Promise<{ stream: MediaStream, sampleRate: number, mimeType: string, getStream: () => MediaStream, stop: () => Promise<{ blob: Blob, mimeType: string }> }>}
 */
export async function createCapture({ onFrame, frameMs = 20, targetRate = 16000 } = {}) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw Object.assign(new Error('Microphone unavailable in this context — an embedded/sandboxed frame blocks it unless the host grants allow="microphone" on a secure (https) context. Try the standalone tool, or drop an audio file instead.'), { code: 'mic-unavailable' });
    }
    if (typeof MediaRecorder === 'undefined') {
        throw Object.assign(new Error('Audio recording is unavailable in this browser/context (MediaRecorder missing). Drop an audio file instead.'), { code: 'mic-unavailable' });
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    // (1) Saved take — compact continuous webm.
    const recMime = bestRecMime();
    const recorder = new MediaRecorder(stream, recMime ? { mimeType: recMime } : undefined);
    const recChunks = [];
    recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) recChunks.push(e.data); });
    recorder.start(1000);
    const takeMime = recorder.mimeType || recMime || 'audio/webm';

    // (2) PCM for VAD/clips.
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx;
    try { ctx = new AC({ sampleRate: targetRate }); } catch (_) { ctx = new AC(); } // some browsers ignore a forced rate
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (_) { /* */ } }
    const sampleRate = ctx.sampleRate;
    const frameSamples = Math.max(1, Math.round(frameMs * sampleRate / 1000));
    const srcNode = ctx.createMediaStreamSource(stream);

    let acc = new Float32Array(0);
    function handleBlock(block) {
        const merged = new Float32Array(acc.length + block.length);
        merged.set(acc); merged.set(block, acc.length);
        let off = 0;
        while (merged.length - off >= frameSamples) {
            const frame = merged.slice(off, off + frameSamples);
            off += frameSamples;
            let s = 0; for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
            onFrame(Math.sqrt(s / frame.length), frame);
        }
        acc = merged.slice(off);
    }

    let node = null, sp = null;
    let usingWorklet = false;
    if (ctx.audioWorklet) {
        try {
            const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
            await ctx.audioWorklet.addModule(url);
            URL.revokeObjectURL(url);
            node = new AudioWorkletNode(ctx, 'sg-pcm');
            node.port.onmessage = (e) => handleBlock(e.data);
            srcNode.connect(node); node.connect(ctx.destination); // outputs silence → no echo
            usingWorklet = true;
        } catch (_) { usingWorklet = false; }
    }
    if (!usingWorklet) {
        sp = ctx.createScriptProcessor(4096, 1, 1);
        sp.onaudioprocess = (e) => handleBlock(e.inputBuffer.getChannelData(0).slice());
        srcNode.connect(sp); sp.connect(ctx.destination);
    }

    async function stop() {
        try {
            if (recorder.state !== 'inactive') {
                await new Promise((res) => { recorder.addEventListener('stop', res, { once: true }); try { recorder.requestData(); } catch (_) { /* */ } recorder.stop(); });
            }
        } catch (_) { /* */ }
        try { if (node) node.disconnect(); if (sp) sp.disconnect(); srcNode.disconnect(); } catch (_) { /* */ }
        try { await ctx.close(); } catch (_) { /* */ }
        try { stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* */ }
        return { blob: new Blob(recChunks, { type: takeMime }), mimeType: takeMime };
    }

    return { stream, sampleRate, mimeType: takeMime, getStream: () => stream, stop };
}
