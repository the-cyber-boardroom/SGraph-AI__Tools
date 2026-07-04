/**
 * @file SG/Send robust upload client — chunked upload with resume, retry, and speed measurement.
 * @module sg-send-upload
 * @version 1.1.1
 *
 * v1.1.1 — multipart robustness fix. The `presigned/initiate` response's part list
 * may be bare URL strings OR per-part objects (`{ url, part_number }`); v1.1.0
 * stored it raw and `fetch(this._urls[i])` stringified an object to
 * `"[object Object]"` (a relative URL → 501 on PUT). Now normalised to an ordered
 * array of URL strings (see normalisePartUrls), with the part list + uploadId also
 * read from several key spellings. Mirrors the send-crypto v1.0.1 fix.
 *
 * Features
 * --------
 *  - Chunked multipart upload with configurable chunk size and parallel threads
 *  - Resume from last successful chunk on any failure
 *  - Automatic retry with exponential back-off (per-chunk)
 *  - Real-time speed measurement (bytes/s rolling average, ETA)
 *  - Cloud drive file detection ("download locally first" hint)
 *  - Internet dropout detection: pause upload + auto-resume on reconnect
 *  - Pre-flight size check (emit 'oversized' before uploading anything)
 *  - Serialisable resume state (persist to localStorage / sessionStorage)
 *
 * Relationship to v1.0.0
 * ----------------------
 * v1.0.0 (core/send-crypto/v1/v1.0/v1.0.0/sg-send-upload.js) is a simple
 * 3-step upload function. This module (v1.1.0) adds the `ChunkedUploader`
 * class which wraps the same API surface with all the robustness primitives
 * described in the dev brief v0.17.3.
 *
 * Named exports only. No default export. No frameworks. No build step.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default chunk size: 5 MB. Matches S3 minimum multipart part size. */
export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

/** Default maximum concurrent chunk uploads. */
export const DEFAULT_MAX_CONCURRENT = 4;

/** Default maximum retry attempts per chunk. */
export const DEFAULT_MAX_RETRIES = 4;

/** Exponential back-off base delay in ms (doubles each retry). */
export const RETRY_BASE_DELAY_MS = 1_000;

/** Speed measurement window: last N bytes-transferred records to average. */
const SPEED_WINDOW = 10;

/** How often (ms) the speed rolling average is sampled. */
const SPEED_TICK_MS = 500;

/** Extensions that indicate undownloaded iCloud Drive stubs. */
const ICLOUD_STUB_EXTENSIONS = ['.icloud'];

/** MIME types that indicate Google Drive editor files (not binary data). */
const GDRIVE_MIME_TYPES = [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
    'application/vnd.google-apps.drawing',
];

// ── Presigned part-URL normalisation ──────────────────────────────────────────

/**
 * Normalise the `presigned/initiate` part list into an ordered array of URL
 * strings indexed by part (index 0 = part 1).
 *
 * The API returns either bare URL strings (`["https://…", …]`) or per-part objects
 * (`[{ url: "https://…", part_number: 1 }, …]`). Passing an object straight to
 * `fetch()` stringifies it to `"[object Object]"` — a relative URL that resolves
 * against the page origin and fails with `501 Unsupported method ('PUT')`. This
 * accepts both shapes plus a range of key spellings, and places each URL at
 * `partNumber - 1` so out-of-order responses still map correctly.
 *
 * @param {Array<string|object>} raw
 * @returns {string[]} URL strings, one per part, in part order.
 * @throws {Error} if the list is empty or any entry has no usable URL.
 */
function normalisePartUrls(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('Multipart initiate response missing part URLs');
    }
    const out = new Array(raw.length);
    raw.forEach((entry, i) => {
        let url = null;
        let partNumber = i + 1;
        if (typeof entry === 'string') {
            url = entry;
        } else if (entry && typeof entry === 'object') {
            url = entry.url ?? entry.signed_url ?? entry.signedUrl
               ?? entry.presigned_url ?? entry.presignedUrl
               ?? entry.Url ?? entry.URL ?? null;
            partNumber = entry.part_number ?? entry.partNumber ?? (i + 1);
        }
        if (typeof url !== 'string') {
            throw new Error(
                `Multipart initiate returned a part without a usable URL — sample entry: ${JSON.stringify(raw[0])}`
            );
        }
        out[partNumber - 1] = url;
    });
    return out;
}

// ── Cloud drive detection ─────────────────────────────────────────────────────

/**
 * Detect whether a File object appears to be an undownloaded cloud-drive stub.
 *
 * Returns a string hint when detected, or `null` when the file looks local.
 *
 * @param {File} file
 * @returns {{ provider: string, hint: string } | null}
 */
export function detectCloudDriveFile(file) {
    if (!file || !(file instanceof File)) return null;

    // iCloud Drive stubs: the file has a .icloud extension and zero bytes on disk.
    if (ICLOUD_STUB_EXTENSIONS.some(ext => file.name.endsWith(ext))) {
        return {
            provider: 'iCloud Drive',
            hint: 'This file is an iCloud Drive placeholder and has not been downloaded locally. Open the Files app, tap and hold the file, and choose "Download Now" before uploading.',
        };
    }

    // iCloud stub: file appears to live inside a cloud-synced path but size is 0.
    if (file.size === 0 && file.name && !file.name.startsWith('.')) {
        // We cannot distinguish a genuinely empty file from an undownloaded stub
        // without reading it; return a soft warning only if webkitRelativePath
        // suggests it came from a directory picker.
        if (file.webkitRelativePath && file.webkitRelativePath.includes('/')) {
            return {
                provider: 'Cloud Drive (suspected)',
                hint: 'This file appears to be empty. If it lives in a cloud-synced folder (iCloud, Dropbox, OneDrive) make sure it has been downloaded fully before uploading.',
            };
        }
    }

    // Google Drive editor types are never binary — they redirect to a Docs URL.
    if (GDRIVE_MIME_TYPES.includes(file.type)) {
        return {
            provider: 'Google Drive',
            hint: 'This is a Google Drive document, not a local file. Open it in Google Docs/Sheets/Slides and use File → Download to export a local copy before uploading.',
        };
    }

    return null;
}

// ── Speed tracker ─────────────────────────────────────────────────────────────

/**
 * Rolling-window speed tracker.
 *
 * Add a byte count sample at each tick; `bytesPerSecond` gives the rolling
 * average across the last SPEED_WINDOW ticks.
 *
 * @private
 */
class SpeedTracker {
    constructor() {
        /** @type {Array<{ts: number, bytes: number}>} */
        this._samples = [];
        this._totalBytes = 0;
    }

    /**
     * Record that `bytes` were transferred at this instant.
     * @param {number} bytes
     */
    addSample(bytes) {
        const now = Date.now();
        this._samples.push({ ts: now, bytes });
        this._totalBytes += bytes;
        if (this._samples.length > SPEED_WINDOW) {
            this._totalBytes -= this._samples.shift().bytes;
        }
    }

    /**
     * Current rolling-average speed in bytes per second.
     * Returns 0 if fewer than 2 samples have been recorded.
     * @returns {number}
     */
    get bytesPerSecond() {
        if (this._samples.length < 2) return 0;
        const elapsed = (this._samples.at(-1).ts - this._samples[0].ts) / 1_000;
        if (elapsed <= 0) return 0;
        return this._totalBytes / elapsed;
    }

    reset() {
        this._samples = [];
        this._totalBytes = 0;
    }
}

// ── Online/offline gate ───────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves when the browser is online.
 * Resolves immediately if already online.
 *
 * @returns {Promise<void>}
 */
function waitForOnline() {
    if (navigator.onLine !== false) return Promise.resolve();
    return new Promise(resolve => {
        const handler = () => { window.removeEventListener('online', handler); resolve(); };
        window.addEventListener('online', handler);
    });
}

// ── Retry helper ──────────────────────────────────────────────────────────────

/**
 * Execute `fn` with up to `maxRetries` attempts. Waits for the network to
 * return between attempts if the error looks like a connectivity failure.
 *
 * @param {() => Promise<T>} fn          - The async operation to retry.
 * @param {number}           maxRetries  - Number of retry attempts (not including first try).
 * @param {() => boolean}    [isCancelled] - Returns true when the upload is aborted.
 * @returns {Promise<T>}
 * @template T
 */
async function withRetry(fn, maxRetries, isCancelled = () => false) {
    let attempt = 0;
    while (true) {
        if (isCancelled()) throw new Error('Upload cancelled');
        try {
            return await fn();
        } catch (err) {
            if (isCancelled()) throw new Error('Upload cancelled');
            if (attempt >= maxRetries) throw err;

            // If we lost connectivity, wait for it to return before retrying.
            const isNetworkError = (
                err instanceof TypeError ||                    // fetch network error
                (err.name === 'AbortError') ||
                (typeof err.message === 'string' &&
                    /network|fetch|failed to fetch|load failed/i.test(err.message))
            );
            if (isNetworkError) {
                await waitForOnline();
            }

            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, delay));
            attempt++;
        }
    }
}

// ── ChunkedUploader ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} ChunkState
 * @property {number}          index       - Zero-based chunk index.
 * @property {number}          start       - Byte offset in the ciphertext.
 * @property {number}          end         - Exclusive byte offset.
 * @property {'pending'|'uploading'|'done'|'error'} status
 * @property {string|null}     etag        - ETag returned by S3 (multipart only).
 * @property {number}          attempts    - Upload attempts so far.
 */

/**
 * @typedef {Object} UploadProgress
 * @property {number}   percent          - Overall completion 0–100.
 * @property {string}   stage            - Current stage label.
 * @property {number}   chunksTotal      - Total chunk count.
 * @property {number}   chunksDone       - Successfully uploaded chunks.
 * @property {number}   bytesTotal       - Total ciphertext bytes.
 * @property {number}   bytesUploaded    - Bytes successfully uploaded.
 * @property {number}   bytesPerSecond   - Rolling-average speed.
 * @property {number}   etaSecs          - Estimated seconds to completion (Infinity if unknown).
 * @property {number}   threadCount      - Active parallel upload threads.
 */

/**
 * @typedef {Object} ResumeState
 * @property {string}   transferId       - SG/Send transfer ID.
 * @property {string}   uploadId         - S3 multipart upload ID.
 * @property {number}   totalSize        - Ciphertext byte length.
 * @property {number}   chunkSize        - Bytes per chunk.
 * @property {string[]} uploadedUrls     - Presigned URLs (parallel to chunks array).
 * @property {ChunkState[]} chunks       - Per-chunk state snapshot.
 */

/**
 * Robust chunked upload client for SG/Send.
 *
 * Designed to be composed by an upload UI — the caller is responsible for
 * encryption before calling `start()`.
 *
 * Lifecycle:
 *   1. `new ChunkedUploader(ciphertext, options)`
 *   2. `uploader.start()` — initiates multipart upload, uploads all chunks
 *   3. On failure: `uploader.getResumeState()` → serialize → persist
 *   4. On return:  `ChunkedUploader.fromResumeState(state, ciphertext, options)` → `start()`
 *
 * Events (emitted via `onProgress`):
 *   The `stage` field goes through: initiating → uploading → completing → complete
 */
export class ChunkedUploader {
    /**
     * @param {Uint8Array} ciphertext - Encrypted file bytes.
     * @param {object}     options
     * @param {string}     options.transferId    - Derived transfer ID.
     * @param {string}     options.sendUrl       - Base URL (no trailing slash).
     * @param {string}     options.accessToken   - x-sgraph-access-token value.
     * @param {number}     [options.chunkSize]   - Bytes per chunk (default 5 MB).
     * @param {number}     [options.maxConcurrent] - Parallel threads (default 4).
     * @param {number}     [options.maxRetries]  - Retries per chunk (default 4).
     * @param {Function}   [options.onProgress]  - `(UploadProgress) => void`
     * @param {Function}   [options.onWarning]   - `({ code, message }) => void`
     */
    constructor(ciphertext, options = {}) {
        this._cipher     = ciphertext;
        this._transferId = options.transferId;
        this._sendUrl    = options.sendUrl;
        this._accessToken = options.accessToken;
        this._chunkSize  = options.chunkSize   ?? DEFAULT_CHUNK_SIZE;
        this._maxConc    = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
        this._maxRetries = options.maxRetries   ?? DEFAULT_MAX_RETRIES;
        this._onProgress = options.onProgress   ?? null;
        this._onWarning  = options.onWarning    ?? null;

        this._cancelled  = false;
        this._paused     = false;
        this._speed      = new SpeedTracker();
        this._activeThreads = 0;

        // Initialised in _initChunks() or restoreResumeState()
        this._uploadId   = null;
        this._chunks     = [];
        this._urls       = [];
        this._speedTickId = null;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Begin (or resume) the upload. Resolves when all chunks are uploaded and
     * the multipart transfer is completed.
     *
     * @returns {Promise<void>}
     */
    async start() {
        this._cancelled = false;
        this._paused    = false;

        const totalSize = this._cipher.byteLength;
        const headers   = this._headers();

        // Phase 1: Initiate (unless restoring a prior upload session)
        if (!this._uploadId) {
            this._notify('initiating', 0);
            const partCount = Math.ceil(totalSize / this._chunkSize);

            const initRes = await withRetry(() =>
                fetch(`${this._sendUrl}/api/presigned/initiate`, {
                    method:  'POST',
                    headers,
                    body:    JSON.stringify({
                        transferId: this._transferId,
                        size:       totalSize,
                        parts:      partCount,
                    }),
                }).then(r => { if (!r.ok) throw new Error(`Initiate failed: ${r.status}`); return r.json(); }),
                this._maxRetries,
                () => this._cancelled,
            );

            this._uploadId = initRes.uploadId ?? initRes.upload_id;
            // Accept several response spellings, and normalise part entries (string or
            // object) to plain URL strings so fetch() never receives an object.
            this._urls     = normalisePartUrls(
                initRes.urls ?? initRes.part_urls ?? initRes.presigned_urls
                ?? initRes.signed_urls ?? initRes.upload_urls
            );
            this._initChunks(totalSize);
        }

        // Phase 2: Upload chunks
        this._startSpeedTick();
        await this._uploadChunks();
        this._stopSpeedTick();

        if (this._cancelled) throw new Error('Upload cancelled');

        // Phase 3: Complete multipart
        this._notify('completing', 99);
        const parts = this._chunks.map(c => ({ partNumber: c.index + 1, etag: c.etag }));

        await withRetry(() =>
            fetch(`${this._sendUrl}/api/presigned/complete`, {
                method:  'POST',
                headers,
                body:    JSON.stringify({
                    transferId: this._transferId,
                    uploadId:   this._uploadId,
                    parts,
                }),
            }).then(r => { if (!r.ok) throw new Error(`Complete failed: ${r.status}`); }),
            this._maxRetries,
            () => this._cancelled,
        );

        this._notify('complete', 100);
    }

    /** Cancel the in-progress upload. */
    cancel() {
        this._cancelled = true;
        this._stopSpeedTick();
    }

    /**
     * Returns a serialisable snapshot of the upload progress.
     * Persist to localStorage/sessionStorage and pass to `fromResumeState()`
     * to resume after a page reload or network failure.
     *
     * @returns {ResumeState}
     */
    getResumeState() {
        return {
            transferId: this._transferId,
            uploadId:   this._uploadId,
            totalSize:  this._cipher.byteLength,
            chunkSize:  this._chunkSize,
            uploadedUrls: this._urls,
            chunks: this._chunks.map(c => ({ ...c })),
        };
    }

    /**
     * Restore upload progress from a persisted `ResumeState`.
     * Call `start()` afterwards to continue uploading.
     *
     * @param {ResumeState} state
     */
    restoreResumeState(state) {
        this._uploadId = state.uploadId;
        // Normalise defensively — a resume state persisted by v1.1.0 may hold raw
        // object-shaped part entries; normalisePartUrls passes strings through.
        this._urls     = normalisePartUrls(state.uploadedUrls);
        this._chunks   = state.chunks.map(c => ({
            ...c,
            // Reset mid-flight chunks back to pending
            status:   c.status === 'uploading' ? 'pending' : c.status,
        }));
    }

    /**
     * Create a `ChunkedUploader` instance pre-loaded with a saved resume state.
     *
     * @param {ResumeState} state
     * @param {Uint8Array}  ciphertext  - The same encrypted bytes as the original upload.
     * @param {object}      options     - Same options as the constructor (minus transferId).
     * @returns {ChunkedUploader}
     */
    static fromResumeState(state, ciphertext, options) {
        const uploader = new ChunkedUploader(ciphertext, {
            ...options,
            transferId: state.transferId,
        });
        uploader.restoreResumeState(state);
        return uploader;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _headers() {
        return {
            'x-sgraph-access-token': this._accessToken,
            'Content-Type':          'application/json',
        };
    }

    /**
     * Build the initial chunks array from total size.
     * @param {number} totalSize
     */
    _initChunks(totalSize) {
        const count = Math.ceil(totalSize / this._chunkSize);
        this._chunks = Array.from({ length: count }, (_, i) => ({
            index:    i,
            start:    i * this._chunkSize,
            end:      Math.min((i + 1) * this._chunkSize, totalSize),
            status:   'pending',
            etag:     null,
            attempts: 0,
        }));
    }

    /**
     * Upload all pending chunks using a bounded pool of concurrent workers.
     */
    async _uploadChunks() {
        const pending = this._chunks.filter(c => c.status !== 'done');
        let   idx     = 0;

        const worker = async () => {
            while (idx < pending.length && !this._cancelled) {
                // If the connection is down, wait before grabbing next chunk.
                await waitForOnline();
                if (this._cancelled) return;

                const chunk = pending[idx++];
                chunk.status = 'uploading';
                this._activeThreads++;

                try {
                    const etag = await withRetry(
                        () => this._uploadChunk(chunk),
                        this._maxRetries,
                        () => this._cancelled,
                    );
                    chunk.etag   = etag;
                    chunk.status = 'done';
                } catch (err) {
                    chunk.status = 'error';
                    this._activeThreads--;
                    throw err;
                }
                this._activeThreads--;
            }
        };

        // Run N workers in parallel; any thrown error propagates out.
        const workers = Array.from(
            { length: Math.min(this._maxConc, pending.length || 1) },
            () => worker(),
        );
        await Promise.all(workers);
    }

    /**
     * Upload a single chunk to its presigned URL.
     * @param {ChunkState} chunk
     * @returns {Promise<string>} ETag
     */
    async _uploadChunk(chunk) {
        chunk.attempts++;
        const slice = this._cipher.slice(chunk.start, chunk.end);
        const url   = this._urls[chunk.index];

        const res = await fetch(url, {
            method:  'PUT',
            body:    slice,
            headers: { 'Content-Type': 'application/octet-stream' },
        });

        if (!res.ok) throw new Error(`Chunk ${chunk.index} upload failed: ${res.status}`);
        const etag = res.headers.get('ETag');
        if (!etag) throw new Error(`Chunk ${chunk.index} missing ETag`);

        this._speed.addSample(slice.byteLength);
        this._emitProgress();
        return etag;
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
        const done  = this._chunks.filter(c => c.status === 'done').length;
        const total = this._chunks.length;
        const bytesUploaded = this._chunks
            .filter(c => c.status === 'done')
            .reduce((acc, c) => acc + (c.end - c.start), 0);
        const bps     = this._speed.bytesPerSecond;
        const remaining = this._cipher.byteLength - bytesUploaded;
        const eta     = bps > 0 ? remaining / bps : Infinity;
        const pct     = total > 0 ? Math.round((done / total) * 85) + 10 : 10;

        this._onProgress({
            percent:       pct,
            stage:         'uploading',
            chunksTotal:   total,
            chunksDone:    done,
            bytesTotal:    this._cipher.byteLength,
            bytesUploaded,
            bytesPerSecond: bps,
            etaSecs:        eta,
            threadCount:    this._activeThreads,
        });
    }

    _notify(stage, percent) {
        if (typeof this._onProgress !== 'function') return;
        this._onProgress({
            percent,
            stage,
            chunksTotal:    this._chunks.length,
            chunksDone:     this._chunks.filter(c => c.status === 'done').length,
            bytesTotal:     this._cipher.byteLength,
            bytesUploaded:  this._chunks.filter(c => c.status === 'done')
                                        .reduce((a, c) => a + (c.end - c.start), 0),
            bytesPerSecond: this._speed.bytesPerSecond,
            etaSecs:        Infinity,
            threadCount:    this._activeThreads,
        });
    }
}

// ── Convenience: uploadFile ───────────────────────────────────────────────────

/**
 * High-level helper: validate, detect cloud-drive issues, then run a
 * `ChunkedUploader` for the given pre-encrypted ciphertext.
 *
 * Pre-encryption is the caller's responsibility (use `sg-send-crypto.js`).
 *
 * @param {Uint8Array}  ciphertext       - Encrypted file bytes.
 * @param {File}        originalFile     - Original (un-encrypted) File object, used for diagnostics.
 * @param {string}      transferId       - Derived transfer ID.
 * @param {string}      sendUrl          - Base URL of SG/Send API (no trailing slash).
 * @param {string}      accessToken      - API access token.
 * @param {object}      [opts]
 * @param {number}      [opts.maxSizeBytes]   - If set, throw 'oversized' before uploading.
 * @param {number}      [opts.chunkSize]
 * @param {number}      [opts.maxConcurrent]
 * @param {number}      [opts.maxRetries]
 * @param {Function}    [opts.onProgress]     - `(UploadProgress) => void`
 * @param {Function}    [opts.onWarning]      - `({ code, message }) => void`
 * @param {ResumeState} [opts.resumeState]    - If supplied, resume a prior upload.
 * @returns {Promise<{ uploader: ChunkedUploader }>}
 *   Resolves when the upload is complete. The `uploader` is exposed so the
 *   caller can call `getResumeState()` if needed after the fact.
 */
export async function uploadFile(ciphertext, originalFile, transferId, sendUrl, accessToken, opts = {}) {
    const {
        maxSizeBytes,
        chunkSize,
        maxConcurrent,
        maxRetries,
        onProgress,
        onWarning,
        resumeState,
    } = opts;

    // Pre-flight: size check
    if (maxSizeBytes != null && ciphertext.byteLength > maxSizeBytes) {
        const err = new Error(
            `File too large: ${(ciphertext.byteLength / 1_048_576).toFixed(1)} MB ` +
            `(limit: ${(maxSizeBytes / 1_048_576).toFixed(0)} MB)`,
        );
        err.code = 'oversized';
        throw err;
    }

    // Cloud drive detection (soft warning — does not block upload)
    if (originalFile) {
        const cloudInfo = detectCloudDriveFile(originalFile);
        if (cloudInfo && typeof onWarning === 'function') {
            onWarning({ code: 'cloud-drive', provider: cloudInfo.provider, message: cloudInfo.hint });
        }
    }

    let uploader;
    if (resumeState) {
        uploader = ChunkedUploader.fromResumeState(resumeState, ciphertext, {
            transferId, sendUrl, accessToken,
            chunkSize, maxConcurrent, maxRetries,
            onProgress, onWarning,
        });
    } else {
        uploader = new ChunkedUploader(ciphertext, {
            transferId, sendUrl, accessToken,
            chunkSize, maxConcurrent, maxRetries,
            onProgress, onWarning,
        });
    }

    await uploader.start();
    return { uploader };
}

// ── Speed formatting helpers ──────────────────────────────────────────────────

/**
 * Format bytes/second as a human-readable speed string.
 *
 * @param {number} bps - Bytes per second.
 * @returns {string} e.g. "2.4 MB/s" or "840 KB/s"
 */
export function formatSpeed(bps) {
    if (!isFinite(bps) || bps <= 0) return '—';
    if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`;
    if (bps >= 1_024)     return `${(bps / 1_024).toFixed(0)} KB/s`;
    return `${Math.round(bps)} B/s`;
}

/**
 * Format an ETA in seconds as a human-readable string.
 *
 * @param {number} etaSecs
 * @returns {string} e.g. "1m 23s" or "45s" or "—"
 */
export function formatEta(etaSecs) {
    if (!isFinite(etaSecs) || etaSecs <= 0) return '—';
    const s = Math.round(etaSecs);
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${s}s`;
}
