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

/** A capture always owns at least this much of the timeline. */
const MIN_CAPTURE_MS = 500;

/**
 * @param {object} deps
 * @param {(name:string, detail?:object)=>void} deps.emit
 * @param {(pair:object)=>void} deps.onPairBounded  called when a pair's tEnd closes
 * @returns {{ markMoment: Function, markAt: Function, closeLastPair: Function }}
 */
export function buildMarker({ emit, onPairBounded }) {

    /**
     * Open the FIRST capture at session start, with the screen as it is right
     * now — "the first screenshot should be whatever is there".
     *
     * This is what makes the whole chain line up. Without it, the first press
     * created capture 1 holding a frame from the moment you had ALREADY moved
     * on, so every capture carried the next screen's picture — the "you are one
     * behind of the image" in the review. With it, a capture's screenshot is
     * the screen it is ABOUT: taken when the capture opens, and the words that
     * follow until the next press belong to it.
     *
     * @returns {Promise<{ id, seq }>}
     */
    async function startFirstCapture() {
        const screenshot = await grabFrame();
        const pair = addPair({ tPress: 0, tStart: 0, screenshot });
        emit('nr:pair:added', { id: pair.id, seq: pair.seq, tPress: 0, first: true });
        return { id: pair.id, seq: pair.seq };
    }

    /**
     * Keep a snapped boundary inside the capture it is closing.
     *
     * When the narrator never pauses long enough to qualify, snapBoundary falls
     * back to a fixed lead — which can land BEFORE the open capture even began,
     * collapsing it to nothing. The boundary can never be earlier than a moment
     * after the open capture started, nor later than the press itself.
     *
     * @param {number} bound @param {number} tPress @returns {number}
     */
    function _clampToOpenPair(bound, tPress) {
        const open = state.pairs.find(p => p.tEnd === null);
        const floor = open ? open.tStart + MIN_CAPTURE_MS : 0;
        return Math.min(Math.max(bound, floor), Math.max(tPress, floor));
    }

    function _closeOpenPair(bound) {
        const open = state.pairs.find(p => p.tEnd === null);
        if (!open) return null;
        // Never let a segment collapse below its own start.
        open.tEnd = Math.max(bound, open.tStart + 100);
        return open;
    }

    /**
     * Live mark — the keypress, which means "NEXT": close the capture I have
     * been talking about, and open one for what I am moving to. The frame is
     * grabbed at THIS instant because that is the screen the words that follow
     * are about; the boundary snap moves the audio cut back to the pause
     * between the two topics.
     * @returns {Promise<{ id, seq, tPress }>}
     */
    async function markMoment() {
        if (state.status !== 'capturing') {
            throw Object.assign(new Error('No live session — call startSession() first'), { code: 'no-session' });
        }
        const tPress = nowMs();
        const shotPromise = grabFrame();          // synchronous with the press, async encode
        const bound = _clampToOpenPair(snapBoundary(tPress), tPress);

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
        const bound = _clampToOpenPair(snapBoundary(t), t);
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

    /**
     * Create a capture with BOTH bounds already known — the video-import path.
     *
     * No snapping happens here, and that is the point: the bounds came from
     * cutting the audio at its actual silences, so they are already the honest
     * edges of an utterance. Snapping a boundary that was derived from silence
     * back to "the nearest silence" would only move it.
     *
     * @param {{ tStart: number, tEnd: number, tPress?: number, image?: Blob, source?: string }} p
     * @returns {object} the new pair (the caller may attach ingest-specific fields)
     */
    function markSpan({ tStart, tEnd, tPress = null, image = null, source = 'capture' } = {}) {
        if (typeof tStart !== 'number' || typeof tEnd !== 'number' || !(tEnd > tStart)) {
            throw Object.assign(new Error('markSpan needs { tStart, tEnd } with tEnd > tStart'), { code: 'bad-params' });
        }
        const pair = addPair({ tPress: tPress == null ? tStart : tPress, tStart, screenshot: image });
        pair.tEnd = tEnd;
        pair.source = source;
        emit('nr:pair:added', { id: pair.id, seq: pair.seq, tPress: pair.tPress });
        onPairBounded(pair);
        return pair;
    }

    return { startFirstCapture, markMoment, markAt, markSpan, closeLastPair };
}
