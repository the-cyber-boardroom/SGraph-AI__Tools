/**
 * nr-marker.js
 * The keypress's three jobs (source brief claim 3): mark a screenshot, bound an
 * audio segment, create the alignment. A mark closes the PREVIOUS pair's open
 * bound (both bounds VAD-snapped, Decision 2) — which is the moment that pair
 * becomes transcribable, so transcription streams while capture continues.
 *
 * @module nr-marker
 */

import { state, addPair } from './nr-state.js';
import { nowMs, grabFrame, snapBoundary } from './nr-capture.js';

/**
 * @param {object} deps
 * @param {(name:string, detail?:object)=>void} deps.emit
 * @param {(pair:object)=>void} deps.onPairBounded  called when a pair's tEnd closes
 * @returns {{ markMoment: Function, markAt: Function, closeLastPair: Function }}
 */
export function buildMarker({ emit, onPairBounded }) {

    function _closeOpenPair(bound) {
        const open = state.pairs.find(p => p.tEnd === null);
        if (!open) return null;
        // Never let a segment collapse below its own start.
        open.tEnd = Math.max(bound, open.tStart + 100);
        return open;
    }

    /**
     * Live mark — the keypress. Grabs the frame at THIS instant (the state
     * being pointed at); the boundary snap looks back for the sentence start.
     * @returns {Promise<{ id, seq, tPress }>}
     */
    async function markMoment() {
        if (state.status !== 'capturing') {
            throw Object.assign(new Error('No live session — call startSession() first'), { code: 'no-session' });
        }
        const tPress = nowMs();
        const shotPromise = grabFrame();          // synchronous with the press, async encode
        const bound = snapBoundary(tPress);

        const closed = _closeOpenPair(bound);
        const pair = addPair({ tPress, tStart: bound, screenshot: null });
        pair.screenshot = await shotPromise;

        emit('nr:mark', { id: pair.id, seq: pair.seq, tPress });
        emit('nr:pair:added', { id: pair.id, seq: pair.seq, tPress });
        if (closed) onPairBounded(closed);
        return { id: pair.id, seq: pair.seq, tPress };
    }

    /**
     * Headless mark at a given time on an imported take. Optional image stands
     * in for the screenshot. Markers must be planted in ascending order.
     * @param {{ t: number, image?: Blob }} p
     * @returns {Promise<{ id, seq }>}
     */
    async function markAt({ t, image } = {}) {
        if (typeof t !== 'number' || !(t >= 0)) {
            throw Object.assign(new Error('markAt needs { t } in ms'), { code: 'bad-params' });
        }
        if (!state.take && state.takeSource !== 'import') {
            throw Object.assign(new Error('markAt needs an imported recording — call addRecording() first'), { code: 'no-session' });
        }
        const bound = snapBoundary(t);
        const closed = _closeOpenPair(bound);
        const pair = addPair({ tPress: t, tStart: bound, screenshot: image || null });
        emit('nr:mark', { id: pair.id, seq: pair.seq, tPress: t });
        emit('nr:pair:added', { id: pair.id, seq: pair.seq, tPress: t });
        if (closed) onPairBounded(closed);
        return { id: pair.id, seq: pair.seq };
    }

    /**
     * Close the final open pair at session end (tEnd = end of audio).
     * @param {number} endMs
     * @returns {object|null} the closed pair
     */
    function closeLastPair(endMs) {
        const closed = _closeOpenPair(endMs);
        if (closed) onPairBounded(closed);
        return closed;
    }

    return { markMoment, markAt, closeLastPair };
}
