/**
 * sg-wav-encoder — pure-JS 16-bit PCM WAV writer.
 *
 * Takes decoded PCM (`{ channelData: Float32Array[], sampleRate }`, the shape
 * emitted by both `AudioContext.decodeAudioData` and the Opus decoder) and
 * produces a standard RIFF/WAVE 16-bit little-endian PCM Blob. WAV is
 * universally accepted by OpenRouter audio models, so this is the canonical
 * "always-works" output of the decode pipeline.
 *
 * No dependencies, no build step. Works in any browser; also runs in Node for
 * unit tests (returns a Blob when Blob is available, else a typed-array-backed
 * stand-in is NOT provided — callers that need bytes can use `encodeWavBytes`).
 *
 * @module sg-wav-encoder
 * @version 0.1.0
 */

/**
 * Encode PCM channel data into a 16-bit PCM WAV byte buffer.
 *
 * Channels are interleaved; sample values are clamped to [-1, 1] and scaled to
 * signed 16-bit. If channels have differing lengths the longest is used and
 * shorter channels are zero-padded.
 *
 * @param {{ channelData: Float32Array[], sampleRate: number }} pcm
 * @returns {Uint8Array} the complete WAV file bytes (header + data).
 */
export function encodeWavBytes({ channelData, sampleRate }) {
    if (!Array.isArray(channelData) || channelData.length === 0) {
        throw new Error('sg-wav-encoder: channelData must be a non-empty array of Float32Array');
    }
    const numChannels = channelData.length;
    const rate = Math.max(1, Math.round(sampleRate || 48000));
    let numFrames = 0;
    for (const ch of channelData) numFrames = Math.max(numFrames, ch.length);

    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = numFrames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    /** Write an ASCII string at offset. */
    function writeString(offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);              // PCM fmt chunk size
    view.setUint16(20, 1, true);               // audio format = PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 8 * bytesPerSample, true); // bits per sample
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let frame = 0; frame < numFrames; frame++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const samples = channelData[ch];
            let s = frame < samples.length ? samples[frame] : 0;
            s = Math.max(-1, Math.min(1, s));
            // Asymmetric scaling for full 16-bit range.
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            offset += 2;
        }
    }
    return new Uint8Array(buffer);
}

/**
 * Encode PCM channel data into a `audio/wav` Blob.
 * @param {{ channelData: Float32Array[], sampleRate: number }} pcm
 * @returns {Blob} a WAV blob (`audio/wav`).
 */
export function encodeWav(pcm) {
    const bytes = encodeWavBytes(pcm);
    return new Blob([bytes], { type: 'audio/wav' });
}
