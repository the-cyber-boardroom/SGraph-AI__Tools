/**
 * nr-zip.js
 * The session bundle: the same folder shape the vault will hold later
 * (Decision 8) — review.md + images/ + audio/ + raw/ + session.json.
 * buildSessionEntries is pure; zipping goes through core/sg-zip.
 *
 * @module nr-zip
 */

import { zipEntries } from '/core/sg-zip/v0/v0.1/v0.1.0/sg-zip.js';
import { state, sessionToJson } from './nr-state.js';
import { buildDocument, imageName } from './nr-document.js';
import { pairWav } from './nr-pipeline.js';

/**
 * Build the flat entry list for the bundle (pure over current state).
 * @param {{ audio?: boolean, take?: boolean }} include  segment WAVs / continuous take
 * @returns {{ entries: Array<{path, blob?, text?}>, markdown: string, count: number }}
 */
export function buildSessionEntries(include = {}) {
    const wantAudio = include.audio !== false;   // default: include segment WAVs
    const wantTake = include.take !== false;     // default: include the take
    const { markdown, images } = buildDocument(state, state.pairs);
    const entries = [{ path: 'review.md', text: markdown }];

    for (const { name, pairId } of images) {
        const pair = state.pairs.find(p => p.id === pairId);
        if (pair && pair.screenshot) entries.push({ path: `images/${name}`, blob: pair.screenshot });
    }
    for (const pair of state.pairs) {
        if (wantAudio && pair.tEnd != null) {
            try { entries.push({ path: `audio/${pair.id}.wav`, blob: pairWav(pair) }); }
            catch (_) { /* unbounded pair — skip */ }
        }
        if (pair.raw) entries.push({ path: `raw/${pair.id}.txt`, text: pair.raw.text });
    }
    if (wantTake && state.take && state.take.blob) {
        const ext = /ogg/.test(state.take.mimeType || '') ? 'ogg' : 'webm';
        entries.push({ path: `audio/take.${ext}`, blob: state.take.blob });
    }
    entries.push({ path: 'session.json', text: JSON.stringify(sessionToJson(), null, 2) });
    return { entries, markdown, count: state.pairs.length };
}

/**
 * Build the zip Blob. JSZip injectable for tests.
 * @param {{ include?: object, JSZip?: Function }} [opts]
 * @returns {Promise<{ blob: Blob, name: string, count: number }>}
 */
export async function buildSessionZip(opts = {}) {
    const { entries, count } = buildSessionEntries(opts.include || {});
    const blob = await zipEntries(entries, { JSZip: opts.JSZip });
    const name = `narrated-review-${state.sessionId || 'session'}.zip`;
    return { blob, name, count };
}

/** Trigger a browser download of a Blob. @param {Blob} blob @param {string} name */
export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
