/** editor-config.js — in-memory + localStorage config singleton.
 *
 * All flags default to preserving current behaviour. Consumers import the
 * `editorConfig` singleton and call `.get(key)` / `.set(key, value)`.
 * Changes are persisted to localStorage and broadcast to `onChange` listeners.
 */

const LS_KEY = 'sgve:config';

/** Default values — all "on" to preserve today's behaviour. */
const DEFAULTS = {
    // Performance / feature toggles
    /** Rebuild the composer (preview) on every state change. */
    previewEnabled: true,
    /** Call timelineEl.setProject() on every state change. */
    timelineEnabled: true,
    /** Call assetPanel.refresh() on every state change. */
    assetPanelEnabled: true,
    /** Call overlayWire.pushActive() on every state change. */
    overlayEnabled: true,
    /** Run the debounced autosave after mutations. */
    autosaveEnabled: true,

    // Debug / observability
    /** Mount the Perf tab panel. Disabled by default to avoid rAF + sampling overhead. */
    perfEnabled: false,
    /** Enable URL.* + <video> memory counters (same as ?debug=1 but live-togglable). */
    memoryProbeEnabled: false,
    /** Console verbosity: 'off' | 'error' | 'info' | 'verbose' */
    logLevel: 'error',
    /** Log a line per composer rebuild (asset count + timing). */
    logComposerRebuilds: false,
};

function _load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (_) { return {}; }
}
function _save(cfg) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (_) {}
}

const _listeners = new Set();
let _cfg = { ...DEFAULTS, ..._load() };

export const editorConfig = {
    /** @param {string} key @returns {any} */
    get(key) {
        return Object.prototype.hasOwnProperty.call(_cfg, key) ? _cfg[key] : DEFAULTS[key];
    },
    /** @param {string} key @param {any} value */
    set(key, value) {
        _cfg[key] = value;
        _save(_cfg);
        for (const fn of _listeners) { try { fn(key, value, _cfg); } catch (_) {} }
    },
    /**
     * Register a listener called whenever any key changes.
     * @param {(key: string, value: any, cfg: object) => void} fn
     * @returns {() => void} unsubscribe
     */
    onChange(fn) {
        _listeners.add(fn);
        return () => _listeners.delete(fn);
    },
    /** Reset all keys to defaults and notify listeners. */
    reset() {
        _cfg = { ...DEFAULTS };
        _save(_cfg);
        for (const fn of _listeners) { try { fn('*', null, _cfg); } catch (_) {} }
    },
};
