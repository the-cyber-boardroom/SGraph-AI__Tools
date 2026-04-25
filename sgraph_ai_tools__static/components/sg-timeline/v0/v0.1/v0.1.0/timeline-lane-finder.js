// timeline-lane-finder.js — pointer Y → lane element lookup (v0.1.0)

/**
 * Find the .lane element under pointer Y inside the lanes container.
 * Falls back to the first lane if the pointer is above all lanes, the
 * last if below. Returns null when no lanes exist.
 * @param {HTMLElement} lanesEl
 * @param {number} clientY
 * @returns {HTMLElement|null}
 */
export function findLaneAtY(lanesEl, clientY) {
    if (!lanesEl) return null;
    const lanes = Array.from(lanesEl.querySelectorAll('.lane'));
    if (!lanes.length) return null;
    for (const lane of lanes) {
        const r = lane.getBoundingClientRect();
        if (clientY >= r.top && clientY < r.bottom) return lane;
    }
    const firstRect = lanes[0].getBoundingClientRect();
    if (clientY < firstRect.top) return lanes[0];
    return lanes[lanes.length - 1];
}

/**
 * Lookup the lane offset (top px relative to lanesEl) for a given lane.
 * Used to position the drag ghost when crossing between tracks.
 * @param {HTMLElement} lanesEl
 * @param {HTMLElement} laneEl
 * @returns {number}
 */
export function laneOffsetTop(lanesEl, laneEl) {
    if (!lanesEl || !laneEl) return 0;
    const row = laneEl.closest('.lane-row') || laneEl;
    return row.offsetTop;
}
