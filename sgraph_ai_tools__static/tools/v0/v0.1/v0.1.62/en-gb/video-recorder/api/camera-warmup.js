/**
 * camera-warmup.js
 * Auto-exposure warm-up gate for freshly acquired camera streams.
 *
 * Webcams take ~0.5–1 s after getUserMedia to ramp auto-exposure / AGC; frames
 * delivered before that are black or badly under-exposed. When recording starts
 * WITHOUT a prior Preview the pipeline acquires the camera at record time, so the
 * MediaRecorder's first frame — the poster frame players show, and the first frame
 * of every composited layout — captured the dark ramp. A fixed 300 ms wait proved
 * too short on real hardware (reported: near-black camera tile on frame 0 of an
 * Infographic recording, fine from frame 1 onward).
 *
 * warmUpCameraStream() plays the stream into an off-DOM <video>, samples the mean
 * luma of a downscaled frame every ~120 ms, and resolves once exposure has settled
 * (3 consecutive samples within a small delta), bounded by:
 *   - a floor (minMs)  — a briefly-flat start of the ramp cannot exit instantly;
 *   - a hard cap (maxMs) — a broken/never-settling camera can never hang record
 *     start; scene motion that keeps luma oscillating just rides to the cap.
 *
 * Best-effort by design: it never rejects — any internal failure degrades to the
 * bounded wait, which is at worst the previous behaviour with a longer timer.
 *
 * @module camera-warmup
 */

/** Default tuning. Exported for tests. */
export const WARMUP_DEFAULTS = Object.freeze({
    minMs:         450,   // never resolve before this (AE ramp can start flat-dark)
    maxMs:        1600,   // hard cap on added record-start latency
    intervalMs:    120,   // luma sampling cadence
    settleDelta:     3,   // mean-luma change (0–255) at/below which a sample is "stable"
    settleSamples:   3,   // consecutive stable samples required (= 2 stable deltas)
});

/**
 * Wait until a camera stream's auto-exposure has settled (or a hard cap elapses).
 * Resolves immediately for streams without a live video track. Never rejects.
 *
 * @param {MediaStream} stream  Freshly acquired camera stream.
 * @param {{ minMs?: number, maxMs?: number, intervalMs?: number,
 *           settleDelta?: number, settleSamples?: number }} [options]
 * @returns {Promise<{ settled: boolean, waitedMs: number, samples: number }>}
 *   settled — exposure stabilised before the cap; waitedMs — total time gated;
 *   samples — luma samples actually read (0 if no frame was ever decodable).
 */
export async function warmUpCameraStream(stream, options = {}) {
    const opts = { ...WARMUP_DEFAULTS, ...options };
    const t0   = Date.now();

    const track = stream?.getVideoTracks?.()[0];
    if (!track || track.readyState !== 'live') {
        return { settled: false, waitedMs: 0, samples: 0 };
    }

    try {
        return await _watchLuma(stream, opts, t0);
    } catch (_) {
        // Degraded path: plain bounded wait for whatever remains of maxMs.
        const remaining = Math.max(0, opts.maxMs - (Date.now() - t0));
        await new Promise(r => setTimeout(r, remaining));
        return { settled: false, waitedMs: Date.now() - t0, samples: 0 };
    }
}

// ── Internals ─────────────────────────────────────────────────────────────────

/**
 * Sample mean luma of the stream on an interval until stable (see module header).
 * @param {MediaStream} stream
 * @param {typeof WARMUP_DEFAULTS} opts
 * @param {number} t0
 * @returns {Promise<{ settled: boolean, waitedMs: number, samples: number }>}
 */
function _watchLuma(stream, opts, t0) {
    return new Promise(resolve => {
        const video       = document.createElement('video');
        video.muted       = true;
        video.playsInline = true;
        video.srcObject   = stream;
        video.play().catch(() => {});

        const SW = 32, SH = 18;                          // tiny sampling canvas
        const canvas  = document.createElement('canvas');
        canvas.width  = SW;
        canvas.height = SH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        let prevLuma = null;
        let stable   = 0;
        let samples  = 0;
        let timer    = 0;

        function finish(settled) {
            clearInterval(timer);
            clearTimeout(cap);
            video.srcObject = null;
            resolve({ settled, waitedMs: Date.now() - t0, samples });
        }

        const cap = setTimeout(() => finish(false), opts.maxMs);

        timer = setInterval(() => {
            if (video.readyState < 2) return;            // no frame decoded yet
            let luma;
            try { luma = _meanLuma(ctx, video, SW, SH); }
            catch (_) { return; }                        // transient decode error — skip
            samples += 1;
            if (prevLuma !== null && Math.abs(luma - prevLuma) <= opts.settleDelta) {
                stable += 1;
            } else {
                stable = 0;
            }
            prevLuma = luma;
            if (Date.now() - t0 >= opts.minMs && stable >= opts.settleSamples - 1) {
                finish(true);
            }
        }, opts.intervalMs);
    });
}

/**
 * Mean Rec.601 luma (0–255) of the current video frame, downscaled to w×h.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement} video
 * @param {number} w
 * @param {number} h
 * @returns {number}
 */
function _meanLuma(ctx, video, w, h) {
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let sum = 0;
    const px = w * h;
    for (let i = 0; i < data.length; i += 4) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return sum / px;
}
