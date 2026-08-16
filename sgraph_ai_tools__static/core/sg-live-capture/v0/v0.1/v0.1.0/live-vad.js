/**
 * live-vad — energy-based Voice Activity Detection state machine (pure).
 *
 * Feed it per-frame RMS + PCM samples; it buffers speech and emits COMPLETE
 * utterances cut at sustained silence — with a pre-roll (so onsets aren't
 * clipped), a hangover/endpoint pause (so brief mid-phrase breaths don't cut),
 * hysteresis (two thresholds), and min/max length guards. No Web Audio here, so
 * it is fully unit-testable with synthetic energy sequences.
 *
 * This replaces fixed-time chunking: cutting at the silences means each clip is
 * a whole phrase the model can transcribe cleanly, and gluing the clips ≈ the
 * original speech (see team/explorer/architect/v0.2.73 plan).
 *
 * Promoted verbatim from tools v0.1.60 audio-transcribe api/live-vad.js
 * (Phase R2 of the narrated-review pack) — behaviour identical, contract frozen.
 *
 * @module sg-live-capture/live-vad
 * @version 0.1.0
 */

/** Concatenate an array of Float32Array frames into one. */
export function concatFrames(frames) {
    let total = 0;
    for (const f of frames) total += f.length;
    const out = new Float32Array(total);
    let off = 0;
    for (const f of frames) { out.set(f, off); off += f.length; }
    return out;
}

/**
 * @param {object} opts
 * @param {number} [opts.frameMs=20]          ms of audio per pushed frame
 * @param {number} [opts.speechThreshold=0.02] RMS to ENTER speech
 * @param {number} [opts.silenceThreshold=0.01] RMS at/below which a frame is silence (hysteresis: < speech)
 * @param {number} [opts.endpointMs=600]       sustained silence that ends an utterance
 * @param {number} [opts.preRollMs=300]        audio kept BEFORE the onset
 * @param {number} [opts.minSpeechMs=250]      drop utterances with less speech than this
 * @param {number} [opts.maxUtteranceMs=15000] force-cut a non-stop talker
 * @param {(pcm: Float32Array, meta: { startMs: number, durationMs: number, capped: boolean }) => void} opts.onUtterance
 * @returns {{ pushFrame: Function, flush: Function, reset: Function, getState: () => string }}
 */
export function createVad({
    frameMs = 20, speechThreshold = 0.02, silenceThreshold = 0.01,
    endpointMs = 600, preRollMs = 300, minSpeechMs = 250, maxUtteranceMs = 15000, onUtterance,
} = {}) {
    const preRollFrames = Math.max(1, Math.round(preRollMs / frameMs));
    const endpointFrames = Math.max(1, Math.round(endpointMs / frameMs));
    const minSpeechFrames = Math.max(1, Math.round(minSpeechMs / frameMs));
    const maxFrames = Math.max(1, Math.round(maxUtteranceMs / frameMs));

    let state = 'silence';
    let pre = [];           // recent silent frames kept as pre-roll
    let utter = [];         // frames of the current utterance
    let silentRun = 0;      // consecutive silence frames while in speech
    let speechCount = 0;    // non-silent frames in the current utterance
    let elapsedFrames = 0;  // total frames seen (for startMs)
    let uttStartFrame = 0;

    function emit(capped) {
        if (speechCount >= minSpeechFrames && utter.length) {
            const pcm = concatFrames(utter);
            if (onUtterance) onUtterance(pcm, { startMs: uttStartFrame * frameMs, durationMs: utter.length * frameMs, capped: !!capped });
        }
        utter = []; speechCount = 0; silentRun = 0; state = 'silence';
    }

    /** @param {number} rms @param {Float32Array} samples one frame of PCM */
    function pushFrame(rms, samples) {
        elapsedFrames += 1;
        if (state === 'silence') {
            pre.push(samples);
            if (pre.length > preRollFrames + 1) pre.shift(); // keep pre-roll + current
            if (rms >= speechThreshold) {
                state = 'speech';
                uttStartFrame = elapsedFrames - (pre.length - 1);
                utter = pre.slice();   // seed with pre-roll (includes this frame)
                pre = [];
                speechCount = 1; silentRun = 0;
            }
        } else { // speech
            utter.push(samples);
            if (rms <= silenceThreshold) {
                silentRun += 1;
                if (silentRun >= endpointFrames) { emit(false); return; }
            } else {
                silentRun = 0; speechCount += 1;
            }
            if (utter.length >= maxFrames) emit(true);
        }
    }

    /** Fire any open utterance (call on stop). */
    function flush() { if (state === 'speech') emit(false); }
    function reset() { state = 'silence'; pre = []; utter = []; silentRun = 0; speechCount = 0; elapsedFrames = 0; uttStartFrame = 0; }

    return { pushFrame, flush, reset, getState: () => state };
}
