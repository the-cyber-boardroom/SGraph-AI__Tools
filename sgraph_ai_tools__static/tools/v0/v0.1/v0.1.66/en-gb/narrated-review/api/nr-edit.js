/**
 * nr-edit.js
 * Structural edits to the ordered pair list: notes, reorder, insert, remove.
 *
 * A capture is only ever three things — a screenshot, some words, and (usually)
 * a slice of audio. So a pair can be authored directly, with no audio at all:
 * that is what `insertPair` is for. Document order is array order; `seq` is
 * re-derived after every structural change, while `id` stays stable so API
 * callers, chat threads and events keep referring to the same capture.
 *
 * @module nr-edit
 */

import { state, makePair, resequence, getPairById, pairToJson } from './nr-state.js';

/**
 * @param {object} deps
 * @param {(name: string, detail?: object) => void} deps.emit
 */
export function buildEditMethods({ emit }) {

    /** Human/agent commentary on a capture — kept apart from the transcript. */
    function setNotes(p = {}) {
        const pair = getPairById(p.id);
        if (!pair) throw Object.assign(new Error(`Unknown pair: ${p.id}`), { code: 'unknown-pair' });
        if (typeof p.notes !== 'string') throw Object.assign(new Error('setNotes needs { notes }'), { code: 'bad-params' });
        pair.notes = p.notes;
        emit('nr:pair:updated', { id: pair.id, field: 'notes' });
        return pairToJson(pair);
    }

    /**
     * Move a capture to a new position in the document order.
     * @param {{ id: string, toIndex?: number, by?: number }} p
     *        `toIndex` is absolute (0-based); `by` moves relative (-1 = earlier).
     */
    function movePair(p = {}) {
        const from = state.pairs.findIndex(x => x.id === p.id);
        if (from < 0) throw Object.assign(new Error(`Unknown pair: ${p.id}`), { code: 'unknown-pair' });
        let to = typeof p.toIndex === 'number' ? p.toIndex
               : typeof p.by === 'number' ? from + p.by
               : null;
        if (to == null) throw Object.assign(new Error('movePair needs { toIndex } or { by }'), { code: 'bad-params' });
        to = Math.max(0, Math.min(state.pairs.length - 1, to));
        if (to === from) return { id: p.id, index: from, moved: false };
        const [pair] = state.pairs.splice(from, 1);
        state.pairs.splice(to, 0, pair);
        resequence();
        emit('nr:pairs:reordered', { id: p.id, from, to });
        return { id: p.id, index: to, moved: true };
    }

    /** Explicit whole-list order, by id. Ids omitted keep their relative order at the end. */
    function reorderPairs(p = {}) {
        const order = Array.isArray(p.order) ? p.order : null;
        if (!order) throw Object.assign(new Error('reorderPairs needs { order: [id,…] }'), { code: 'bad-params' });
        const byId = new Map(state.pairs.map(x => [x.id, x]));
        const next = [];
        for (const id of order) {
            const pair = byId.get(id);
            if (!pair) throw Object.assign(new Error(`Unknown pair: ${id}`), { code: 'unknown-pair' });
            if (!next.includes(pair)) next.push(pair);
        }
        for (const pair of state.pairs) if (!next.includes(pair)) next.push(pair);
        state.pairs = next;
        resequence();
        emit('nr:pairs:reordered', { order: state.pairs.map(x => x.id) });
        return { order: state.pairs.map(x => x.id) };
    }

    /**
     * Author a capture directly and drop it anywhere in the order — a
     * screenshot, some text, an analysis, or any subset. No audio involved, so
     * it never goes through transcription.
     *
     * @param {{ atIndex?: number, afterId?: string, image?: Blob, text?: string,
     *           raw?: string, notes?: string }} p
     *        `text` sets the clean/analysis text; `raw` optionally records a
     *        source line beside it.
     */
    function insertPair(p = {}) {
        const pair = makePair({ seq: 0, source: 'inserted', screenshot: p.image || null });
        if (typeof p.raw === 'string' && p.raw) {
            pair.raw = { text: p.raw, model: 'authored', generationId: null, costUsd: null };
        }
        if (typeof p.text === 'string' && p.text) {
            pair.clean = { text: p.text, marks: [], model: 'authored', generationId: null, costUsd: null, edited: true };
        }
        if (typeof p.notes === 'string') pair.notes = p.notes;
        pair.status = pair.clean ? 'clean' : (pair.raw ? 'raw' : 'marked');

        let at = state.pairs.length;
        if (typeof p.afterId === 'string') {
            const i = state.pairs.findIndex(x => x.id === p.afterId);
            if (i < 0) throw Object.assign(new Error(`Unknown pair: ${p.afterId}`), { code: 'unknown-pair' });
            at = i + 1;
        } else if (typeof p.atIndex === 'number') {
            at = Math.max(0, Math.min(state.pairs.length, p.atIndex));
        }
        state.pairs.splice(at, 0, pair);
        resequence();
        emit('nr:pair:added', { id: pair.id, seq: pair.seq, inserted: true });
        return pairToJson(pair);
    }

    return { setNotes, movePair, reorderPairs, insertPair };
}
