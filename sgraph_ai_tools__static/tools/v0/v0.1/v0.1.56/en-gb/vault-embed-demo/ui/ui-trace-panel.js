/**
 * ui-trace-panel — trace panel controls and exports for SgToolApi.
 *
 * @module ui-trace-panel
 */

/** @type {HTMLElement|null} */
let _traceEl = null

/**
 * @param {{ traceEl: HTMLElement }} opts
 */
export function mountTracePanel({ traceEl }) {
    _traceEl = traceEl
}

/**
 * Get the last N events from the trace panel.
 * @param {number} [limit]
 * @returns {Array}
 */
export function getTraceLog(limit) {
    if (!_traceEl || typeof _traceEl.getLog !== 'function') return []
    return _traceEl.getLog(limit)
}

/**
 * Clear the trace panel.
 */
export function clearTraceLog() {
    if (_traceEl && typeof _traceEl.clearLog === 'function') {
        _traceEl.clearLog()
    }
}
