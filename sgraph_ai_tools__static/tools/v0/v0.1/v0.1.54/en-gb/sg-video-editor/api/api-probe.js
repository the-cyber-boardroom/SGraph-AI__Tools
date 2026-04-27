/** api-probe.js — hidden-element probes for video / image File metadata. */

/**
 * Probe a video File for duration/dimensions via a hidden <video> element.
 *
 * @param {Blob|File} file
 * @param {{ timeout?: number, signal?: AbortSignal }} [opts]
 *   timeout — ms before giving up (default 10 000). Set to 0 to disable.
 *   signal  — AbortSignal from an AbortController; rejects with DOMException on abort.
 * @returns {Promise<{duration:number,width:number,height:number}>}
 */
export async function probeVideoFile(file, { timeout = 10000, signal } = {}) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;

        let timer = null;
        let settled = false;

        function cleanup() {
            if (timer) { clearTimeout(timer); timer = null; }
            try { URL.revokeObjectURL(url); } catch (_) {}
            v.src = '';
        }
        function settle(fn) {
            if (settled) return;
            settled = true;
            cleanup();
            fn();
        }

        v.addEventListener('loadedmetadata', () => {
            let duration = v.duration;
            const width = v.videoWidth, height = v.videoHeight;
            // Guard against a common MP4 muxer bug where the mvhd duration is
            // written as raw audio-sample ticks (e.g. 48 000 ticks/s) but the
            // movie time-scale field is left at 1, so Chrome reads ticks as seconds.
            // Heuristic: if implied bitrate < 50 kbps, the duration is almost
            // certainly in timescale units rather than real seconds.
            if (Number.isFinite(duration) && file && file.size > 0) {
                const maxPlausibleSec = file.size / 6250; // 50 kbps minimum floor
                if (duration > maxPlausibleSec) {
                    const raw = duration;
                    let corrected = null;
                    for (const ts of [48000, 44100, 90000, 1000]) {
                        const c = raw / ts;
                        if (c > 0 && c <= maxPlausibleSec) { corrected = c; break; }
                    }
                    if (corrected !== null) {
                        console.warn(`[sgve] probe: raw duration ${raw.toFixed(0)} looks like timescale ticks — corrected to ${corrected.toFixed(2)}s (÷${Math.round(raw / corrected)})`);
                        duration = corrected;
                    } else {
                        console.warn(`[sgve] probe: duration ${raw.toFixed(0)}s is suspiciously large for ${file.size}B file; using as-is`);
                    }
                }
            }
            settle(() => resolve({ duration, width, height }));
        }, { once: true });

        v.addEventListener('error', () => {
            settle(() => reject(new Error('failed to load video metadata')));
        }, { once: true });

        if (timeout > 0) {
            timer = setTimeout(() => {
                settle(() => reject(new Error(`video metadata probe timed out after ${timeout}ms`)));
            }, timeout);
        }

        if (signal) {
            signal.addEventListener('abort', () => {
                settle(() => reject(new DOMException('Probe aborted', 'AbortError')));
            }, { once: true });
            // Already aborted before we even started.
            if (signal.aborted) {
                settle(() => reject(new DOMException('Probe aborted', 'AbortError')));
                return;
            }
        }

        v.src = url;
    });
}

/** Probe an image File for naturalWidth/naturalHeight via a hidden <img>.
 *  @param {Blob|File} file
 *  @returns {Promise<{width:number,height:number}>} */
export async function probeImageFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        const cleanup = () => { try { URL.revokeObjectURL(url); } catch (_) {} };
        img.onload = () => {
            const out = { width: img.naturalWidth, height: img.naturalHeight };
            cleanup(); resolve(out);
        };
        img.onerror = () => { cleanup(); reject(new Error('failed to load image metadata')); };
        img.src = url;
    });
}
