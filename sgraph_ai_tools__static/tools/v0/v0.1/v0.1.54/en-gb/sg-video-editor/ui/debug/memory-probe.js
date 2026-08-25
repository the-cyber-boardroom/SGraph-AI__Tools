/**
 * memory-probe.js — Round-9-M observability probe.
 *
 * Centralised, opt-in counters for diagnosing the high-memory bug that
 * triggered when a high-resolution MP4 was dropped onto the timeline.
 *
 * What it does:
 *   - Wraps `URL.createObjectURL` + `URL.revokeObjectURL` so live blob-URL
 *     count is observable from the debug panel (and from the console).
 *   - Counts video-element creations + disposals (composer registers via
 *     `notifyVideoCreated` / `notifyVideoDisposed`).
 *   - Counts composer rebuilds (debug-only signal — every state mutation
 *     debounces a rebuild that throws away every <video> + blob URL and
 *     re-creates them; high churn here = high decode pressure).
 *   - `getSnapshot()` returns a plain object the debug panel can render.
 *
 * Activation contract:
 *   - The wrappers install ONLY when `initMemoryProbe()` is called.
 *   - The shell decides whether to call it (`?debug=1` query string).
 *   - When NOT initialised, every helper is a cheap no-op so production
 *     code paths stay unchanged.
 *
 * High-signal console logs are gated behind the same flag — see
 * `debugLog()`. Use the `[sgve]` prefix so users can grep in DevTools.
 *
 * @module sg-video-editor/debug/memory-probe
 */

let _enabled = false;
let _origCreate = null;
let _origRevoke = null;
/** 'off' | 'error' | 'info' | 'verbose' — default matches editorConfig default. */
let _logLevel = 'error';

const _state = {
    blobUrlsLive: 0,
    blobUrlsCreatedTotal: 0,
    blobUrlsRevokedTotal: 0,
    /** Map<assetId, count> — video elements currently alive per asset. */
    videosByAsset: new Map(),
    videosCreatedTotal: 0,
    videosDisposedTotal: 0,
    composerRebuilds: 0,
    lastEvent: null,
};

/**
 * Install the URL.createObjectURL / revokeObjectURL counters.
 * Idempotent — calling twice is a no-op.
 *
 * @returns {boolean} true iff the probe is now active.
 */
export function initMemoryProbe() {
    if (_enabled) return true;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    _origCreate = URL.createObjectURL.bind(URL);
    _origRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = function patchedCreateObjectURL(obj) {
        const url = _origCreate(obj);
        _state.blobUrlsLive += 1;
        _state.blobUrlsCreatedTotal += 1;
        _state.lastEvent = `create ${url.slice(-8)}`;
        return url;
    };
    URL.revokeObjectURL = function patchedRevokeObjectURL(url) {
        const r = _origRevoke(url);
        if (_state.blobUrlsLive > 0) _state.blobUrlsLive -= 1;
        _state.blobUrlsRevokedTotal += 1;
        _state.lastEvent = `revoke ${String(url || '').slice(-8)}`;
        return r;
    };
    _enabled = true;
    return true;
}

/** Restore the original URL.* methods. Test-only. */
export function __restoreForTests() {
    if (!_enabled) return;
    if (_origCreate) URL.createObjectURL = _origCreate;
    if (_origRevoke) URL.revokeObjectURL = _origRevoke;
    _enabled = false;
    _origCreate = _origRevoke = null;
    _state.blobUrlsLive = 0;
    _state.blobUrlsCreatedTotal = 0;
    _state.blobUrlsRevokedTotal = 0;
    _state.videosByAsset = new Map();
    _state.videosCreatedTotal = 0;
    _state.videosDisposedTotal = 0;
    _state.composerRebuilds = 0;
    _state.lastEvent = null;
}

/** True when the probe is currently installed. */
export function isMemoryProbeEnabled() { return _enabled; }

/** Notify that a `<video>` element was created. */
export function notifyVideoCreated(assetId) {
    if (!_enabled) return;
    const id = assetId || '?';
    _state.videosByAsset.set(id, (_state.videosByAsset.get(id) || 0) + 1);
    _state.videosCreatedTotal += 1;
}

/** Notify that a `<video>` element was disposed. */
export function notifyVideoDisposed(assetId) {
    if (!_enabled) return;
    const id = assetId || '?';
    const prev = _state.videosByAsset.get(id) || 0;
    if (prev <= 1) _state.videosByAsset.delete(id);
    else _state.videosByAsset.set(id, prev - 1);
    _state.videosDisposedTotal += 1;
}

/** Notify that the shell rebuilt the composer (destroy + create cycle). */
export function notifyComposerRebuilt() {
    if (!_enabled) return;
    _state.composerRebuilds += 1;
}

/**
 * Read `performance.memory.usedJSHeapSize` if available (Chrome only).
 * Returns null on Safari / Firefox.
 *
 * @returns {{ usedJSHeapBytes: number, totalJSHeapBytes: number, jsHeapLimitBytes: number }|null}
 */
export function readPerfMemory() {
    try {
        const m = (typeof performance !== 'undefined') && performance.memory;
        if (!m) return null;
        return {
            usedJSHeapBytes:  Number(m.usedJSHeapSize)  || 0,
            totalJSHeapBytes: Number(m.totalJSHeapSize) || 0,
            jsHeapLimitBytes: Number(m.jsHeapSizeLimit) || 0,
        };
    } catch (_) { return null; }
}

/**
 * Snapshot of all counters. The debug panel calls this on a 1 Hz timer.
 *
 * @returns {{
 *   enabled: boolean,
 *   blobUrlsLive: number, blobUrlsCreatedTotal: number, blobUrlsRevokedTotal: number,
 *   videoElementsLive: number, videosCreatedTotal: number, videosDisposedTotal: number,
 *   videosByAsset: Array<{assetId: string, count: number}>,
 *   composerRebuilds: number,
 *   lastEvent: string|null,
 *   perfMemory: ReturnType<typeof readPerfMemory>,
 *   videoElementsInDom: number,
 * }}
 */
export function getSnapshot() {
    let videoElementsLive = 0;
    const byAsset = [];
    for (const [assetId, count] of _state.videosByAsset.entries()) {
        videoElementsLive += count;
        byAsset.push({ assetId, count });
    }
    let inDom = 0;
    try { if (typeof document !== 'undefined') inDom = document.querySelectorAll('video').length; }
    catch (_) {}
    return {
        enabled: _enabled,
        blobUrlsLive: _state.blobUrlsLive,
        blobUrlsCreatedTotal: _state.blobUrlsCreatedTotal,
        blobUrlsRevokedTotal: _state.blobUrlsRevokedTotal,
        videoElementsLive,
        videosCreatedTotal: _state.videosCreatedTotal,
        videosDisposedTotal: _state.videosDisposedTotal,
        videosByAsset: byAsset,
        composerRebuilds: _state.composerRebuilds,
        lastEvent: _state.lastEvent,
        perfMemory: readPerfMemory(),
        videoElementsInDom: inDom,
    };
}

/* ── log-level helpers ────────────────────────────────────────── */

/**
 * Set console verbosity. Called by the Config panel when the user changes
 * the log-level selector. Independent of the memory probe — logs can be
 * enabled without installing the URL.* counters.
 * @param {'off'|'error'|'info'|'verbose'} level
 */
export function setLogLevel(level) {
    _logLevel = level || 'error';
}

function _shouldLog() {
    return _logLevel === 'info' || _logLevel === 'verbose';
}

/** Log a high-signal event. Prefixed with [sgve] for easy filtering.
 *  Outputs when the memory probe is active OR log level is info/verbose. */
export function debugLog(...args) {
    if (!_enabled && !_shouldLog()) return;
    try { console.log('[sgve]', ...args); } catch (_) {}
}

/** Throttle a heavy log (e.g. paint-frame heap reads) to once per `ms`. */
const _throttleLast = new Map();
export function debugLogThrottled(key, ms, ...args) {
    if (!_enabled && !_shouldLog()) return;
    const now = Date.now();
    const last = _throttleLast.get(key) || 0;
    if (now - last < ms) return;
    _throttleLast.set(key, now);
    try { console.log('[sgve]', ...args); } catch (_) {}
}
