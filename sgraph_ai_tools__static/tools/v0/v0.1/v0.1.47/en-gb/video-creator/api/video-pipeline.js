/**
 * video-pipeline.js
 * Orchestration: TTS generation, canvas recording, download.
 * Pure logic — no DOM manipulation, no UI state.
 *
 * @module video-pipeline
 */

import { loadTTS, generateAudio } from '/core/sg-tts/v0/v0.1/v0.1.0/sg-tts.js';
import { startRecording, stopRecording, getBestMimeType } from '/core/sg-video-recorder/v0/v0.1/v0.1.0/sg-video-recorder.js';
import { SGA_VIDEO } from './video-events.js';

// ─────────────────────────────────────────────────────────────────────────────
// Model loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load Kokoro TTS worker pool. Emits tool:audio:progress when each worker is ready.
 *
 * @param {PipelineState} state
 * @param {function} emit  (eventName, detail) → void
 * @param {object} [options]
 * @param {number} [options.poolSize=4]
 * @returns {Promise<void>}
 */
export async function loadModel(state, emit, options = {}) {
    const { poolSize = 4 } = options;
    state.setStatus('loading-model');

    await loadTTS({
        voice:    state.config.voice,
        poolSize,
        onProgress: ({ workerIndex, message }) => {
            emit(SGA_VIDEO.AUDIO_PROGRESS, { workerIndex, message });
        },
    });

    state.setStatus('ready');
}

// ─────────────────────────────────────────────────────────────────────────────
// TTS generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate TTS audio for all slides in parallel across the worker pool.
 * Slides without narration text are skipped (duration 0).
 *
 * @param {PipelineState} state
 * @param {function} emit
 * @returns {Promise<number[]>} Per-slide audio durations in seconds
 */
export async function generateAllAudio(state, emit) {
    state.setStatus('generating-audio');

    const { voice, speed } = state.config;
    const total = state.slides.length;

    // Run all slides in parallel — each generateAudio() call already uses the pool internally
    const results = await Promise.all(
        state.slides.map(async (slide, i) => {
            const text = state.narrations[i]?.trim();
            emit(SGA_VIDEO.AUDIO_PROGRESS, { slideIndex: i, total });

            if (!text) return { index: i, data: null, sampleRate: 24_000, durationSecs: 0 };

            const result = await generateAudio(text, { voice, speed });
            return { index: i, ...result };
        })
    );

    for (const r of results) {
        if (r.data) state.setAudio(r.index, r.data, r.sampleRate);
    }

    state.setStatus('ready');
    emit(SGA_VIDEO.AUDIO_COMPLETE, { durations: [...state.audioDurations] });
    return [...state.audioDurations];
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a narrated slideshow to a WebM blob.
 *
 * Creates an offscreen 1280×720 canvas, draws each slide image,
 * plays TTS audio via AudioContext, and captures the combined stream with MediaRecorder.
 * Each slide plays for its audio duration (or 3 s if no narration).
 *
 * @param {PipelineState} state
 * @param {function} emit
 * @returns {Promise<Blob>} WebM (or MP4 on Safari) blob
 */
export async function recordSlideshow(state, emit) {
    const { fps, bitrateKbps, width, height } = state.config;

    // Offscreen canvas — not mounted in DOM
    const canvas = new OffscreenCanvas(width, height);
    const ctx    = canvas.getContext('2d');

    // AudioContext + destination stream for MediaRecorder
    const AudioCtx  = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    const audioCtx  = new AudioCtx();
    const dest      = audioCtx.createMediaStreamDestination();

    // OffscreenCanvas doesn't support captureStream — use a visible canvas workaround
    // Create a regular canvas and sync from OffscreenCanvas via transferToImageBitmap
    const recCanvas    = document.createElement('canvas');
    recCanvas.width    = width;
    recCanvas.height   = height;
    recCanvas.style.display = 'none';
    document.body.appendChild(recCanvas);
    const recCtx = recCanvas.getContext('2d');

    const mimeType = getBestMimeType();
    startRecording(recCanvas, dest.stream, { fps, mimeType, videoBitsPerSecond: bitrateKbps * 1000 });
    state.setStatus('recording');
    emit(SGA_VIDEO.RECORD_START, { fps });

    const t0 = Date.now();

    try {
        for (let i = 0; i < state.slides.length; i++) {
            const slide     = state.slides[i];
            const audioData = state.audioData[i];
            const duration  = state.audioDurations[i] > 0 ? state.audioDurations[i] : 3;

            // Load slide image onto canvas
            await _drawSlide(recCtx, slide, i, state.slides.length, width, height);

            // Play audio on AudioContext, wait for duration
            if (audioData) {
                const buffer = audioCtx.createBuffer(1, audioData.length, state.sampleRate);
                buffer.getChannelData(0).set(audioData);
                const source = audioCtx.createBufferSource();
                source.buffer = buffer;
                source.connect(dest);
                source.start();
            }

            await new Promise(r => setTimeout(r, duration * 1000));
        }
    } finally {
        document.body.removeChild(recCanvas);
        audioCtx.close();
    }

    const webmBlob   = await stopRecording();
    const durationMs = Date.now() - t0;

    state.webmBlob = webmBlob;
    state.setStatus('done');
    emit(SGA_VIDEO.RECORD_STOP, { durationMs });

    return webmBlob;
}

// ─────────────────────────────────────────────────────────────────────────────
// Download
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trigger a browser download of a Blob.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw a slide image to the recording canvas with a caption bar.
 * @param {CanvasRenderingContext2D} ctx
 * @param {SlideInfo} slide
 * @param {number} index
 * @param {number} total
 * @param {number} width
 * @param {number} height
 */
async function _drawSlide(ctx, slide, index, total, width, height) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            // Fill background
            ctx.fillStyle = '#0a0a18';
            ctx.fillRect(0, 0, width, height);

            // Fit image maintaining aspect ratio
            const scale  = Math.min(width / img.width, height / img.height);
            const drawW  = img.width  * scale;
            const drawH  = img.height * scale;
            const drawX  = (width  - drawW) / 2;
            const drawY  = (height - drawH) / 2;
            ctx.drawImage(img, drawX, drawY, drawW, drawH);

            // Caption bar
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.fillRect(0, height - 48, width, 48);
            ctx.fillStyle   = '#e2e8f0';
            ctx.font        = '600 16px system-ui, sans-serif';
            ctx.textAlign   = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${slide.name}  •  ${index + 1} / ${total}`, width / 2, height - 24);

            resolve();
        };
        img.onerror = () => reject(new Error(`Failed to load slide image: ${slide.name}`));
        img.src = slide.dataUrl;
    });
}
