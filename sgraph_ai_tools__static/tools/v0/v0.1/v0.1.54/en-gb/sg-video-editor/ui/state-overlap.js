/** state-overlap.js — overlap detection for clips on a single track. */

/** Build an Error tagged with code 'overlap' for a rejected mutation. */
function overlapError() {
    return Object.assign(
        new Error('Clip would overlap with another clip on the same track'),
        { code: 'overlap' },
    );
}

/**
 * Returns true if [start, end) would overlap any clip on the track,
 * excluding the clip with id excludeClipId (used during move/trim).
 * Touching at a boundary (other.end === start or other.start === end) is OK.
 *
 * @param {{ clips: Array<{id: string, timelineStart: number, inPoint: number, outPoint: number}> }} track
 * @param {number} start
 * @param {number} end
 * @param {string|null|undefined} excludeClipId
 * @returns {boolean}
 */
export function wouldOverlap(track, start, end, excludeClipId) {
    if (!track || !Array.isArray(track.clips)) return false;
    const eps = 1e-6;
    for (const c of track.clips) {
        if (excludeClipId && c.id === excludeClipId) continue;
        const cStart = c.timelineStart;
        const cEnd = c.timelineStart + (c.outPoint - c.inPoint);
        if (start < cEnd - eps && end > cStart + eps) return true;
    }
    return false;
}

/**
 * Throw an overlap error if [start, end) collides with another clip on track.
 * @param {object} track
 * @param {number} start
 * @param {number} end
 * @param {string|null|undefined} excludeClipId
 * @returns {void}
 */
export function assertNoOverlap(track, start, end, excludeClipId) {
    if (wouldOverlap(track, start, end, excludeClipId)) throw overlapError();
}
