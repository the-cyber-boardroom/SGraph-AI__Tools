/** state-overlap.js — overlap detection + snap-abut helper for clips on a track. */

const EPS = 1e-6;

/** Build an Error tagged with code 'overlap' for a rejected mutation. */
function overlapError() {
    return Object.assign(
        new Error('Clip would overlap with another clip on the same track'),
        { code: 'overlap' },
    );
}

/**
 * Resolve a clip's [start, end) on the timeline.
 * @param {{timelineStart: number, inPoint: number, outPoint: number}} c
 * @returns {{start: number, end: number}}
 */
function clipRange(c) {
    const start = c.timelineStart;
    const end = c.timelineStart + (c.outPoint - c.inPoint);
    return { start, end };
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
    for (const c of track.clips) {
        if (excludeClipId && c.id === excludeClipId) continue;
        const { start: cStart, end: cEnd } = clipRange(c);
        if (start < cEnd - EPS && end > cStart + EPS) return true;
    }
    return false;
}

/**
 * Find the first clip on `track` whose range overlaps [start, end), excluding
 * `excludeClipId`. Returns `null` if none.
 *
 * @param {object} track
 * @param {number} start
 * @param {number} end
 * @param {string|null|undefined} excludeClipId
 * @returns {object|null}
 */
function findOverlappingClip(track, start, end, excludeClipId) {
    if (!track || !Array.isArray(track.clips)) return null;
    for (const c of track.clips) {
        if (excludeClipId && c.id === excludeClipId) continue;
        const { start: cStart, end: cEnd } = clipRange(c);
        if (start < cEnd - EPS && end > cStart + EPS) return c;
    }
    return null;
}

/**
 * If `[start, end)` overlaps any neighbour on `track`, propose a snap-abut
 * placement (flush before or flush after) that clears the collision. Returns
 * the proposed `start` (the duration is preserved), or `null` if the natural
 * side and its fallback both still overlap a different clip.
 *
 * Returns the original `start` unchanged when there is no overlap (caller can
 * always use the return value as the final timeline start, with a `null`
 * meaning "give up — fall back to overlap rejection").
 *
 * Snap rule (matches the user's mental model for drag-drop):
 *  - Pick the nearest edge of the offending neighbour: if the proposed start
 *    sits at-or-after the neighbour's start, OR more of the proposed range
 *    sits to the right of the neighbour's mid-point, snap flush AFTER
 *    (`start = neighbour.end`). Otherwise snap flush BEFORE
 *    (`start = neighbour.start - duration`, clamped to ≥ 0).
 *  - If the natural side still collides with a different clip, try the other
 *    side. If both sides still collide, return `null`.
 *
 * Pure: does not mutate `track`.
 *
 * @param {{ clips: Array<{id: string, timelineStart: number, inPoint: number, outPoint: number}> }} track
 * @param {number} start Proposed start on the timeline (post-snap-to-fps).
 * @param {number} end Proposed end on the timeline.
 * @param {string|null|undefined} excludeClipId Clip being moved/trimmed (skipped).
 * @returns {number|null} Adjusted start, or `null` if no clear slot near either side.
 */
export function snapToClearSlot(track, start, end, excludeClipId) {
    const neighbour = findOverlappingClip(track, start, end, excludeClipId);
    if (!neighbour) return start;
    const duration = end - start;
    if (!(duration > 0)) return null;
    const { start: nStart, end: nEnd } = clipRange(neighbour);
    const nMid = (nStart + nEnd) / 2;
    const proposedMid = (start + end) / 2;
    const naturalAfter = start >= nStart - EPS || proposedMid >= nMid;
    const afterStart = nEnd;
    const beforeStart = Math.max(0, nStart - duration);
    const tryOrder = naturalAfter ? [afterStart, beforeStart] : [beforeStart, afterStart];
    for (const cand of tryOrder) {
        if (cand < 0) continue;
        if (!wouldOverlap(track, cand, cand + duration, excludeClipId)) return cand;
    }
    return null;
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
