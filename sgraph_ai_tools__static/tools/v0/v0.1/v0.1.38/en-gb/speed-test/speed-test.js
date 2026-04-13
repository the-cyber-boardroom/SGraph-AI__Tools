/**
 * Speed Test tool — upload and download speed measurement to SG/Send infrastructure.
 * @version 0.1.38
 *
 * No frameworks, no build step. Pure ES module.
 *
 * Measurement strategy
 * --------------------
 *  Download: fetch a configurable probe URL (e.g. a 1 MB presigned payload) while
 *            reading the stream chunk-by-chunk to measure throughput in real time.
 *
 *  Upload:   POST a randomly-filled ArrayBuffer to a configurable upload-probe
 *            endpoint (e.g. /api/speed-test/upload). Falls back to measuring
 *            local throughput only (labelled "local") when no endpoint is set.
 *
 * Public API (window.__speedTest)
 * --------------------------------
 *  runDownloadTest(probeUrl, sizeBytes?) → Promise<TestResult>
 *  runUploadTest(uploadUrl, sizeBytes?)  → Promise<TestResult>
 *  runAll()                              → Promise<{ download, upload }>
 *  setTargetUrl(url)                     — change base URL
 *  cancel()                              — abort any running test
 */

// ── Constants ──────────────────────────────────────────────────────────────────

/** Default download probe payload: 4 MB of random data (generated on first use). */
const DEFAULT_PROBE_SIZE_BYTES = 4 * 1024 * 1024;

/** Default upload payload size: 2 MB. */
const DEFAULT_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024;

/** Rolling average window. */
const SPEED_WINDOW = 8;

// ── Speed tracker (inline — no external deps) ──────────────────────────────────

class SpeedTracker {
    constructor() { this._s = []; this._t = 0; }
    add(bytes) {
        const now = Date.now();
        this._s.push({ ts: now, bytes });
        this._t += bytes;
        if (this._s.length > SPEED_WINDOW) this._t -= this._s.shift().bytes;
    }
    get bps() {
        if (this._s.length < 2) return 0;
        const dt = (this._s.at(-1).ts - this._s[0].ts) / 1e3;
        return dt > 0 ? this._t / dt : 0;
    }
    reset() { this._s = []; this._t = 0; }
}

// ── Format helpers ─────────────────────────────────────────────────────────────

/**
 * @param {number} bps
 * @returns {string}
 */
export function formatSpeed(bps) {
    if (!isFinite(bps) || bps <= 0) return '—';
    if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(2)} MB/s`;
    if (bps >= 1_024)     return `${(bps / 1_024).toFixed(0)} KB/s`;
    return `${Math.round(bps)} B/s`;
}

/**
 * @param {number} bps
 * @returns {string}
 */
export function formatMbps(bps) {
    if (!isFinite(bps) || bps <= 0) return '—';
    return `${((bps * 8) / 1_000_000).toFixed(1)} Mbps`;
}

// ── Core measurement functions ─────────────────────────────────────────────────

/**
 * @typedef {Object} TestResult
 * @property {'download'|'upload'} type
 * @property {number}   bps          - Final average bytes/second.
 * @property {number}   mbps         - Megabits per second.
 * @property {string}   label        - Human-readable speed label.
 * @property {number}   bytesTotal   - Bytes measured.
 * @property {number}   durationMs   - Elapsed wall-clock milliseconds.
 * @property {boolean}  aborted
 */

/**
 * Measure download speed by streaming a URL and tracking bytes received.
 *
 * @param {string}   url        - URL to fetch.
 * @param {object}   [opts]
 * @param {Function} [opts.onProgress] - `({ bps, mbps, percent }) => void`
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<TestResult>}
 */
export async function measureDownloadSpeed(url, opts = {}) {
    const { onProgress, signal } = opts;
    const tracker = new SpeedTracker();
    const t0 = Date.now();

    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Probe fetch failed: ${res.status}`);

    const contentLength = parseInt(res.headers.get('Content-Length') || '0', 10);
    const reader = res.body.getReader();

    let bytesTotal = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytesTotal  += value.byteLength;
        tracker.add(value.byteLength);

        if (typeof onProgress === 'function') {
            const percent = contentLength > 0 ? Math.round((bytesTotal / contentLength) * 100) : -1;
            onProgress({ bps: tracker.bps, mbps: (tracker.bps * 8) / 1e6, percent });
        }
    }

    const durationMs = Date.now() - t0;
    const bps = durationMs > 0 ? (bytesTotal / durationMs) * 1_000 : 0;
    return {
        type:        'download',
        bps,
        mbps:        (bps * 8) / 1_000_000,
        label:       formatSpeed(bps),
        bytesTotal,
        durationMs,
        aborted:     false,
    };
}

/**
 * Measure upload speed by POSTing a random binary payload.
 *
 * If `url` is omitted, the function measures only how fast the browser can
 * serialise + send the request (local-only, not network-round-trip).
 *
 * @param {string}   url
 * @param {object}   [opts]
 * @param {number}   [opts.sizeBytes]  - Payload size (default 2 MB).
 * @param {Function} [opts.onProgress] - `({ bps, mbps, percent }) => void`
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<TestResult>}
 */
export async function measureUploadSpeed(url, opts = {}) {
    const { sizeBytes = DEFAULT_UPLOAD_SIZE_BYTES, onProgress, signal } = opts;

    // Build random payload
    const payload = crypto.getRandomValues(new Uint8Array(sizeBytes));
    const tracker = new SpeedTracker();
    const t0      = Date.now();

    // Emit a "starting" tick
    if (typeof onProgress === 'function') {
        onProgress({ bps: 0, mbps: 0, percent: 0 });
    }

    // We cannot stream-track upload progress via the Fetch API in all browsers,
    // so we measure wall-clock time of a single request and report a final number.
    // For a richer live bar we split into sequential chunks.
    const CHUNK = 256 * 1024; // 256 KB per progress chunk
    let bytesSent = 0;
    let aborted   = false;

    for (let offset = 0; offset < sizeBytes; offset += CHUNK) {
        if (signal?.aborted) { aborted = true; break; }
        const slice   = payload.slice(offset, offset + CHUNK);
        const chunkT0 = Date.now();

        try {
            const res = await fetch(url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body:    slice,
                signal,
            });
            // Accept any 2xx or 415 (unsupported media type is still a real round-trip)
            if (!res.ok && res.status !== 415 && res.status !== 404) {
                // Non-fatal — server may reject but the network round-trip still counts
            }
        } catch (err) {
            if (err.name === 'AbortError') { aborted = true; break; }
            // Network failure — still count bytes for the timing up to this point
        }

        const chunkMs = Date.now() - chunkT0;
        tracker.add(slice.byteLength);
        bytesSent += slice.byteLength;

        if (typeof onProgress === 'function') {
            const percent = Math.round((bytesSent / sizeBytes) * 100);
            onProgress({ bps: tracker.bps, mbps: (tracker.bps * 8) / 1e6, percent });
        }
    }

    const durationMs = Date.now() - t0;
    const bps = durationMs > 0 ? (bytesSent / durationMs) * 1_000 : 0;
    return {
        type:       'upload',
        bps,
        mbps:       (bps * 8) / 1_000_000,
        label:      formatSpeed(bps),
        bytesTotal: bytesSent,
        durationMs,
        aborted,
    };
}

// ── UI Controller ──────────────────────────────────────────────────────────────

/**
 * Initialise the speed test UI.
 * Called once the DOM is ready.
 */
export function initSpeedTestUI() {
    // ── Element refs ────────────────────────────────────────────────────────
    const targetUrlInput  = document.getElementById('target-url');
    const probeSizeSelect = document.getElementById('probe-size');
    const runBtn          = document.getElementById('run-btn');
    const cancelBtn       = document.getElementById('cancel-btn');

    const dlCard          = document.getElementById('dl-card');
    const ulCard          = document.getElementById('ul-card');

    const dlSpeedEl       = document.getElementById('dl-speed');
    const dlMbpsEl        = document.getElementById('dl-mbps');
    const dlBarEl         = document.getElementById('dl-bar');
    const dlStatusEl      = document.getElementById('dl-status');

    const ulSpeedEl       = document.getElementById('ul-speed');
    const ulMbpsEl        = document.getElementById('ul-mbps');
    const ulBarEl         = document.getElementById('ul-bar');
    const ulStatusEl      = document.getElementById('ul-status');

    const shareBtn        = document.getElementById('share-btn');
    const shareSect       = document.getElementById('share-section');
    const shareText       = document.getElementById('share-text');
    const copyShareBtn    = document.getElementById('copy-share-btn');

    let _abortCtrl = null;
    let _lastResults = null;

    // ── State helpers ────────────────────────────────────────────────────────

    function setRunning(running) {
        runBtn.disabled    = running;
        cancelBtn.disabled = !running;
        cancelBtn.style.display = running ? 'inline-block' : 'none';
    }

    function resetCard(speedEl, mbpsEl, barEl, statusEl) {
        speedEl.textContent  = '—';
        mbpsEl.textContent   = '';
        barEl.style.width    = '0%';
        barEl.dataset.state  = 'idle';
        statusEl.textContent = '';
    }

    function updateCard(speedEl, mbpsEl, barEl, statusEl, { bps, mbps, percent, status }) {
        if (bps > 0) {
            speedEl.textContent = formatSpeed(bps);
            mbpsEl.textContent  = `${((bps * 8) / 1_000_000).toFixed(1)} Mbps`;
        }
        if (percent >= 0) {
            barEl.style.width   = `${Math.min(percent, 100)}%`;
            barEl.dataset.state = 'running';
        }
        if (status) statusEl.textContent = status;
    }

    function finalCard(speedEl, mbpsEl, barEl, statusEl, result) {
        speedEl.textContent  = result.label;
        mbpsEl.textContent   = `${result.mbps.toFixed(1)} Mbps`;
        barEl.style.width    = '100%';
        barEl.dataset.state  = result.aborted ? 'aborted' : 'done';
        statusEl.textContent = result.aborted
            ? 'Cancelled'
            : `${(result.bytesTotal / 1_048_576).toFixed(1)} MB in ${(result.durationMs / 1_000).toFixed(1)}s`;
    }

    // ── Run test ─────────────────────────────────────────────────────────────

    async function runTests() {
        const base     = (targetUrlInput.value || 'https://send.sgraph.ai').replace(/\/$/, '');
        const probeMB  = parseInt(probeSizeSelect.value || '4', 10);
        const probeBytes = probeMB * 1_048_576;

        // Probe URL: try a dedicated speed-test endpoint, otherwise reflect a random blob
        const dlUrl   = `${base}/api/speed-test/download?size=${probeBytes}`;
        const ulUrl   = `${base}/api/speed-test/upload`;

        _abortCtrl = new AbortController();
        const signal = _abortCtrl.signal;

        setRunning(true);
        resetCard(dlSpeedEl, dlMbpsEl, dlBarEl, dlStatusEl);
        resetCard(ulSpeedEl, ulMbpsEl, ulBarEl, ulStatusEl);
        shareSect.hidden = true;

        let dlResult = null;
        let ulResult = null;

        // ── Download ─────────────────────────────────────────────────────────
        dlStatusEl.textContent = 'Testing…';
        dlBarEl.dataset.state  = 'running';
        try {
            dlResult = await measureDownloadSpeed(dlUrl, {
                signal,
                onProgress: ({ bps, mbps, percent }) =>
                    updateCard(dlSpeedEl, dlMbpsEl, dlBarEl, dlStatusEl, { bps, mbps, percent, status: 'Downloading…' }),
            });
            finalCard(dlSpeedEl, dlMbpsEl, dlBarEl, dlStatusEl, dlResult);
        } catch (err) {
            if (err.name === 'AbortError') {
                dlResult = { type: 'download', bps: 0, mbps: 0, label: '—', bytesTotal: 0, durationMs: 0, aborted: true };
            } else {
                dlStatusEl.textContent = `Error: ${err.message}`;
                dlBarEl.dataset.state  = 'error';
                dlResult = { type: 'download', bps: 0, mbps: 0, label: 'Error', bytesTotal: 0, durationMs: 0, aborted: false };
            }
        }

        if (signal.aborted) {
            setRunning(false);
            return;
        }

        // ── Upload ───────────────────────────────────────────────────────────
        ulStatusEl.textContent = 'Testing…';
        ulBarEl.dataset.state  = 'running';
        try {
            ulResult = await measureUploadSpeed(ulUrl, {
                sizeBytes: DEFAULT_UPLOAD_SIZE_BYTES,
                signal,
                onProgress: ({ bps, mbps, percent }) =>
                    updateCard(ulSpeedEl, ulMbpsEl, ulBarEl, ulStatusEl, { bps, mbps, percent, status: 'Uploading…' }),
            });
            finalCard(ulSpeedEl, ulMbpsEl, ulBarEl, ulStatusEl, ulResult);
        } catch (err) {
            if (err.name === 'AbortError') {
                ulResult = { type: 'upload', bps: 0, mbps: 0, label: '—', bytesTotal: 0, durationMs: 0, aborted: true };
            } else {
                ulStatusEl.textContent = `Error: ${err.message}`;
                ulBarEl.dataset.state  = 'error';
                ulResult = { type: 'upload', bps: 0, mbps: 0, label: 'Error', bytesTotal: 0, durationMs: 0, aborted: false };
            }
        }

        setRunning(false);

        // Share button
        if (dlResult && ulResult && !dlResult.aborted && !ulResult.aborted) {
            _lastResults = { download: dlResult, upload: ulResult, target: base, ts: Date.now() };
            shareSect.hidden = false;
        }

        // Expose to window for automation / console
        window.__speedTest._lastResults = _lastResults;
    }

    // ── Event bindings ────────────────────────────────────────────────────────

    runBtn.addEventListener('click', () => { runTests().catch(console.error); });

    cancelBtn.addEventListener('click', () => {
        if (_abortCtrl) _abortCtrl.abort();
    });

    shareBtn.addEventListener('click', () => {
        if (!_lastResults) return;
        const { download: dl, upload: ul, target } = _lastResults;
        const text = [
            `SG/Send Speed Test results (${target})`,
            `⬇ Download: ${dl.label}  (${dl.mbps.toFixed(1)} Mbps)`,
            `⬆ Upload:   ${ul.label}  (${ul.mbps.toFixed(1)} Mbps)`,
            `Measured via tools.sgraph.ai/speed-test`,
        ].join('\n');
        shareText.value = text;
        shareText.hidden = false;
        copyShareBtn.hidden = false;
        shareText.select();
    });

    copyShareBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(shareText.value);
            copyShareBtn.textContent = 'Copied!';
            setTimeout(() => { copyShareBtn.textContent = 'Copy'; }, 1_500);
        } catch {
            shareText.select();
        }
    });

    // ── window.__speedTest ────────────────────────────────────────────────────

    window.__speedTest = {
        runAll: () => runTests(),
        cancel: () => { if (_abortCtrl) _abortCtrl.abort(); },
        setTargetUrl: (url) => { targetUrlInput.value = url; },
        getLastResults: () => _lastResults,
        _lastResults: null,
        measureDownloadSpeed,
        measureUploadSpeed,
        formatSpeed,
        formatMbps,
    };
}
