/**
 * @file SG/Send robust download client — chunked download with resume, retry, and speed measurement.
 * @module sg-send-download
 * @version 1.0.0
 *
 * Features
 * --------
 *  - Chunked HTTP Range-request download with configurable chunk size and parallel threads
 *  - Resume from last successful chunk on any failure (serialisable state)
 *  - Automatic retry with exponential back-off per chunk
 *  - Real-time speed measurement (bytes/s rolling average, ETA)
 *  - Internet dropout detection: pause download + auto-resume on reconnect
 *  - Separate decryption step with fine-grained progress callback
 *  - Mirrors the ChunkedUploader API surface for symmetry
 *
 * Named exports only. No default export. No frameworks. No build step.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default download chunk size: 2 MB (smaller than upload to reduce memory pressure). */
export const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024;

/** Default maximum concurrent download requests. */
export const DEFAULT_MAX_CONCURRENT = 4;

/** Default maximum retry attempts per chunk. */
export const DEFAULT_MAX_RETRIES = 4;

/** Exponential back-off base delay in ms. */
export const RETRY_BASE_DELAY_MS = 1_000;

const SPEED_WINDOW    = 10;
const SPEED_TICK_MS   = 500;

// ── Speed tracker ─────────────────────────────────────────────────────────────

/** @private */
class SpeedTracker {
    constructor() {
        this._samples    = [];
        this._totalBytes = 0;
    }

    /** @param {number} bytes */
    addSample(bytes) {
        const now = Date.now();
        this._samples.push({ ts: now, bytes });
        this._totalBytes += bytes;
        if (this._samples.length > SPEED_WINDOW) {
            this._totalBytes -= this._samples.shift().bytes;
        }
    }

    /** @returns {number} bytes per second */
    get bytesPerSecond() {
        if (this._samples.length < 2) return 0;
        const elapsed = (this._samples.at(-1).ts - this._samples[0].ts) / 1_000;
        if (elapsed <= 0) return 0;
        return this._totalBytes / elapsed;
    }

    reset() { this._samples = []; this._totalBytes = 0; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @returns {Promise<void>} Resolves when navigator.onLine is true. */
function waitForOnline() {
    if (navigator.onLine !== false) return Promise.resolve();
    return new Promise(resolve => {
        const h = () => { window.removeEventListener('online', h); resolve(); };
        window.addEventListener('online', h);
    });
}

/**
 * @param {() => Promise<T>} fn
 * @param {number}           maxRetries
 * @param {() => boolean}    [isCancelled]
 * @returns {Promise<T>}
 * @template T
 */
async function withRetry(fn, maxRetries, isCancelled = () => false) {
    let attempt = 0;
    while (true) {
        if (isCancelled()) throw new Error('Download cancelled');
        try {
            return await fn();
        } catch (err) {
            if (isCancelled()) throw new Error('Download cancelled');
            if (attempt >= maxRetries) throw err;
            const isNet = err instanceof TypeError ||
                (typeof err.message === 'string' &&
                 /network|fetch|failed to fetch|load failed/i.test(err.message));
            if (isNet) await waitForOnline();
            await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
            attempt++;
        }
    }
}

// ── ChunkedDownloader ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} DownloadChunkState
 * @property {number}                                 index
 * @property {number}                                 start     - Byte offset in the full content.
 * @property {number}                                 end       - Exclusive byte offset.
 * @property {'pending'|'downloading'|'done'|'error'} status
 * @property {number}                                 attempts
 */

/**
 * @typedef {Object} DownloadProgress
 * @property {number}  percent
 * @property {string}  stage          - 'initiating' | 'downloading' | 'assembling' | 'decrypting' | 'complete'
 * @property {number}  chunksTotal
 * @property {number}  chunksDone
 * @property {number}  bytesTotal
 * @property {number}  bytesDownloaded
 * @property {number}  bytesPerSecond
 * @property {number}  etaSecs
 * @property {number}  threadCount
 */

/**
 * @typedef {Object} DownloadResumeState
 * @property {string}               url          - Download URL.
 * @property {number}               totalBytes   - Content-Length of the resource.
 * @property {number}               chunkSize
 * @property {DownloadChunkState[]} chunks
 */

/**
 * Robust chunked download client.
 *
 * Lifecycle:
 *   1. `new ChunkedDownloader(url, options)` — probe Content-Length with HEAD
 *   2. `downloader.start()` — download all chunks in parallel
 *   3. `downloader.getBuffer()` — assemble chunks into a single Uint8Array
 *   4. On failure: `downloader.getResumeState()` → persist → restore later
 *
 * Decryption is NOT performed by this class. Call your decryption function
 * with the assembled buffer and the provided `onDecryptProgress` helper.
 */
export class ChunkedDownloader {
    /**
     * @param {string} url       - Full URL of the encrypted resource to download.
     * @param {object} options
     * @param {number}   [options.chunkSize]      - Bytes per chunk (default 2 MB).
     * @param {number}   [options.maxConcurrent]  - Parallel threads (default 4).
     * @param {number}   [options.maxRetries]     - Retries per chunk (default 4).
     * @param {Function} [options.onProgress]     - `(DownloadProgress) => void`
     */
    constructor(url, options = {}) {
        this._url        = url;
        this._chunkSize  = options.chunkSize    ?? DEFAULT_CHUNK_SIZE;
        this._maxConc    = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
        this._maxRetries = options.maxRetries    ?? DEFAULT_MAX_RETRIES;
        this._onProgress = options.onProgress    ?? null;

        this._cancelled  = false;
        this._speed      = new SpeedTracker();
        this._activeThreads = 0;
        this._totalBytes = 0;
        this._chunks     = [];
        this._buffers    = [];   // Uint8Array per chunk, indexed by chunk.index
        this._speedTickId = null;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Probe the resource for its total size (HTTP HEAD).
     * Must be called before `start()` if not restoring from a resume state.
     *
     * @returns {Promise<number>} Content-Length in bytes.
     */
    async probe() {
        const res = await withRetry(
            () => fetch(this._url, { method: 'HEAD' }),
            this._maxRetries,
            () => this._cancelled,
        );
        if (!res.ok) throw new Error(`HEAD failed: ${res.status}`);
        const len = parseInt(res.headers.get('Content-Length') || '0', 10);
        if (!len) throw new Error('Server did not return Content-Length. Chunked download not possible.');
        this._totalBytes = len;
        this._initChunks(len);
        return len;
    }

    /**
     * Start (or resume) the download. Resolves when all chunks are downloaded.
     * Call `getBuffer()` afterwards to assemble the full content.
     *
     * @returns {Promise<void>}
     */
    async start() {
        if (this._totalBytes === 0) {
            await this.probe();
        }
        this._cancelled = false;
        this._notify('downloading', 0);
        this._startSpeedTick();
        await this._downloadChunks();
        this._stopSpeedTick();
        if (this._cancelled) throw new Error('Download cancelled');
        this._notify('assembling', 97);
    }

    /**
     * Assemble all downloaded chunk buffers into a single Uint8Array.
     * Call after `start()` completes.
     *
     * @returns {Uint8Array}
     */
    getBuffer() {
        const out = new Uint8Array(this._totalBytes);
        for (const chunk of this._chunks) {
            if (!this._buffers[chunk.index]) {
                throw new Error(`Chunk ${chunk.index} buffer missing — download incomplete?`);
            }
            out.set(this._buffers[chunk.index], chunk.start);
        }
        return out;
    }

    /** Cancel the in-progress download. */
    cancel() {
        this._cancelled = true;
        this._stopSpeedTick();
    }

    /**
     * Returns a serialisable snapshot for resume-on-return.
     * Buffers are NOT included (they are in memory only).
     *
     * @returns {DownloadResumeState}
     */
    getResumeState() {
        return {
            url:        this._url,
            totalBytes: this._totalBytes,
            chunkSize:  this._chunkSize,
            chunks:     this._chunks.map(c => ({
                ...c,
                // Reset mid-flight chunks to pending on persist
                status: c.status === 'downloading' ? 'pending' : c.status,
            })),
        };
    }

    /**
     * Restore from a saved `DownloadResumeState`.
     * Note: already-downloaded chunk data is lost across page reloads, so
     * all chunks are reset to 'pending'. This is still a resume because the
     * multipart session on the server remains open.
     *
     * @param {DownloadResumeState} state
     */
    restoreResumeState(state) {
        this._url        = state.url;
        this._totalBytes = state.totalBytes;
        this._chunkSize  = state.chunkSize;
        this._chunks     = state.chunks.map(c => ({
            ...c,
            // After a page reload all buffers are gone — re-download everything
            status: 'pending',
        }));
        this._buffers    = [];
    }

    /**
     * Create a `ChunkedDownloader` pre-loaded with a saved resume state.
     *
     * @param {DownloadResumeState} state
     * @param {object}              options
     * @returns {ChunkedDownloader}
     */
    static fromResumeState(state, options = {}) {
        const dl = new ChunkedDownloader(state.url, options);
        dl.restoreResumeState(state);
        return dl;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _initChunks(totalBytes) {
        const count = Math.ceil(totalBytes / this._chunkSize);
        this._chunks = Array.from({ length: count }, (_, i) => ({
            index:    i,
            start:    i * this._chunkSize,
            end:      Math.min((i + 1) * this._chunkSize, totalBytes),
            status:   'pending',
            attempts: 0,
        }));
        this._buffers = new Array(count).fill(null);
    }

    async _downloadChunks() {
        const pending = this._chunks.filter(c => c.status !== 'done');
        let   idx     = 0;

        const worker = async () => {
            while (idx < pending.length && !this._cancelled) {
                await waitForOnline();
                if (this._cancelled) return;

                const chunk = pending[idx++];
                chunk.status = 'downloading';
                this._activeThreads++;

                try {
                    const buf = await withRetry(
                        () => this._downloadChunk(chunk),
                        this._maxRetries,
                        () => this._cancelled,
                    );
                    this._buffers[chunk.index] = buf;
                    chunk.status = 'done';
                } catch (err) {
                    chunk.status = 'error';
                    this._activeThreads--;
                    throw err;
                }
                this._activeThreads--;
            }
        };

        const workers = Array.from(
            { length: Math.min(this._maxConc, pending.length || 1) },
            () => worker(),
        );
        await Promise.all(workers);
    }

    /**
     * Fetch a single byte-range chunk.
     * @param {DownloadChunkState} chunk
     * @returns {Promise<Uint8Array>}
     */
    async _downloadChunk(chunk) {
        chunk.attempts++;
        // HTTP Range header is inclusive on both ends: bytes=start-end-1
        const rangeHeader = `bytes=${chunk.start}-${chunk.end - 1}`;

        const res = await fetch(this._url, {
            headers: { 'Range': rangeHeader },
        });

        // 206 Partial Content or 200 (server may not support Range — accept both)
        if (res.status !== 206 && res.status !== 200) {
            throw new Error(`Chunk ${chunk.index} fetch failed: ${res.status}`);
        }

        const buf = new Uint8Array(await res.arrayBuffer());
        this._speed.addSample(buf.byteLength);
        this._emitProgress();
        return buf;
    }

    _startSpeedTick() {
        this._stopSpeedTick();
        this._speedTickId = setInterval(() => this._emitProgress(), SPEED_TICK_MS);
    }

    _stopSpeedTick() {
        if (this._speedTickId != null) {
            clearInterval(this._speedTickId);
            this._speedTickId = null;
        }
    }

    _emitProgress() {
        if (typeof this._onProgress !== 'function') return;
        const done   = this._chunks.filter(c => c.status === 'done').length;
        const total  = this._chunks.length;
        const bytesDownloaded = this._chunks
            .filter(c => c.status === 'done')
            .reduce((acc, c) => acc + (c.end - c.start), 0);
        const bps     = this._speed.bytesPerSecond;
        const remaining = this._totalBytes - bytesDownloaded;
        const eta     = bps > 0 ? remaining / bps : Infinity;
        const pct     = total > 0 ? Math.round((done / total) * 85) + 5 : 5;

        this._onProgress({
            percent:        pct,
            stage:          'downloading',
            chunksTotal:    total,
            chunksDone:     done,
            bytesTotal:     this._totalBytes,
            bytesDownloaded,
            bytesPerSecond: bps,
            etaSecs:        eta,
            threadCount:    this._activeThreads,
        });
    }

    _notify(stage, percent) {
        if (typeof this._onProgress !== 'function') return;
        const done  = this._chunks.filter(c => c.status === 'done').length;
        const bytesDownloaded = this._chunks
            .filter(c => c.status === 'done')
            .reduce((acc, c) => acc + (c.end - c.start), 0);
        this._onProgress({
            percent,
            stage,
            chunksTotal:    this._chunks.length,
            chunksDone:     done,
            bytesTotal:     this._totalBytes,
            bytesDownloaded,
            bytesPerSecond: this._speed.bytesPerSecond,
            etaSecs:        Infinity,
            threadCount:    this._activeThreads,
        });
    }
}

// ── Decryption progress helper ────────────────────────────────────────────────

/**
 * Run a decryption function with progress reporting.
 *
 * For large files the Web Crypto `subtle.decrypt()` call can take several
 * seconds. This wrapper emits:
 *   - `{ stage: 'decrypting', percent: 97 }` before starting
 *   - `{ stage: 'complete',   percent: 100 }` after finishing
 *
 * @param {() => Promise<ArrayBuffer|Uint8Array>} decryptFn
 * @param {Function} onProgress - `(DownloadProgress) => void`
 * @returns {Promise<Uint8Array>}
 */
export async function decryptWithProgress(decryptFn, onProgress) {
    if (typeof onProgress === 'function') {
        onProgress({ percent: 97, stage: 'decrypting', chunksTotal: 0, chunksDone: 0,
            bytesTotal: 0, bytesDownloaded: 0, bytesPerSecond: 0, etaSecs: Infinity, threadCount: 0 });
    }
    const result = await decryptFn();
    if (typeof onProgress === 'function') {
        onProgress({ percent: 100, stage: 'complete', chunksTotal: 0, chunksDone: 0,
            bytesTotal: 0, bytesDownloaded: 0, bytesPerSecond: 0, etaSecs: 0, threadCount: 0 });
    }
    return result instanceof Uint8Array ? result : new Uint8Array(result);
}

// ── Speed / ETA formatting (mirrors sg-send-upload v1.1.0) ───────────────────

/**
 * Format bytes/second as a human-readable speed string.
 * @param {number} bps
 * @returns {string}
 */
export function formatSpeed(bps) {
    if (!isFinite(bps) || bps <= 0) return '—';
    if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`;
    if (bps >= 1_024)     return `${(bps / 1_024).toFixed(0)} KB/s`;
    return `${Math.round(bps)} B/s`;
}

/**
 * Format ETA seconds as a human-readable string.
 * @param {number} etaSecs
 * @returns {string}
 */
export function formatEta(etaSecs) {
    if (!isFinite(etaSecs) || etaSecs <= 0) return '—';
    const s = Math.round(etaSecs);
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${s}s`;
}
