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
import { billingToJson } from './nr-billing.js';
import { buildDocument, imageName } from './nr-document.js';
import { uncertainToJson } from './nr-handover.js';
import { actionsToJson } from './nr-actions.js';
import { pairWav } from './nr-pipeline.js';

/**
 * The bundle's own map. Written for whoever opens it first — increasingly an
 * agent rather than a person, so it names the machine-readable surface up front
 * instead of leaving `review.md` as the apparent entry point.
 * @param {{ audio?: boolean, take?: boolean }} include
 * @returns {string}
 */
export function buildReadme(include = {}) {
    const n = state.pairs.length;
    const wantAudio = include.audio !== false;
    return [
        `# Narrated review — ${state.sessionId || 'session'}`,
        '',
        `${n} capture${n === 1 ? '' : 's'}. A capture is a screenshot, the words spoken about it, and the alignment between them.`,
        '',
        '## If you are a program or an agent, read `session.json`',
        '',
        'Its **`moments[]`** array is the machine-readable view: one entry per capture, in document order,',
        'each carrying the words inline plus the paths to its image, audio and raw transcript. Do NOT parse',
        '`review.md` to reconstruct that — the join is already there.',
        '',
        '```',
        'moments[i] = {',
        '  index,        // 1-based; matches the "## N." headings in review.md and "Moment N" in the PDF',
        '  id,           // stable across reordering (review.md order can change; this will not)',
        '  tMs, at,      // when on the recording clock (null for a capture authored by hand)',
        '  tStart, tEnd, // the audio segment these words came from',
        '  image,        // "images/pair-NN.png"',
        '  audio,        // "audio/pXX.wav"  (present only if this export included audio)',
        '  rawFile,      // "raw/pXX.txt"',
        '  text,         // the best available words',
        "  textSource,   // 'clean' (model-corrected) | 'raw' (as heard) | 'none'",
        '  rawText,      // the recogniser output, always unedited',
        '  notes,        // commentary added AFTER the fact — not part of what was said',
        '  marks,        // [{span, note}] spans the cleanup model flagged as UNCERTAIN',
        '  source,       // "capture" (narrated live) | "video" (imported) | "inserted" (authored)',
        '}',
        '```',
        '',
        '**Three kinds of text, deliberately separate.** `rawText` is the recogniser\'s words and is never',
        'edited. `text` with `textSource:"clean"` is those words corrected against the screenshot — trust it',
        'more, but treat any span listed in `marks` as unresolved rather than settled. `notes` is commentary',
        'added afterwards by a human or an agent and must never be read as something that was said.',
        '',
        '## Contents',
        '',
        '| Path | What |',
        '|---|---|',
        '| `session.json` | Everything, including `moments[]`. The authoritative file. |',
        '| `review.md` | The same content as a readable document. |',
        '| `images/` | One screenshot per capture, named by document position. |',
        '| `raw/` | Unedited transcript per capture, named by stable id. |',
        `| \`audio/\` | ${wantAudio ? 'Per-capture WAV plus the continuous take.' : 'Omitted from this export.'} |`,
        '| `uncertain.json` | Every span the cleanup model flagged as UNCERTAIN, gathered into one list with the sentence around it and the raw transcript to compare against. **If you are looking for where you can help, start here.** |',
        '| `actions.json` | Append-only log of what was DONE to this document — reorders, re-transcribes, notes, undos. The words say what was said; this says what was decided. |',
        '| `billing.json` | Every OpenRouter generation id with the provider\'s receipt: what was charged, by which model, for which capture. |',
        '',
        '*Built by narrated-review (tools.sgraph.ai). Nothing left the browser except audio segments and,',
        'in grounded cleanup mode, the screenshots — both direct to OpenRouter under the user\'s own key.*',
        '',
    ].join('\n');
}

/**
 * Build the flat entry list for the bundle (pure over current state).
 * @param {{ audio?: boolean, take?: boolean }} include  segment WAVs / continuous take
 * @returns {{ entries: Array<{path, blob?, text?}>, markdown: string, count: number }}
 */
export function buildSessionEntries(include = {}) {
    const wantAudio = include.audio !== false;   // default: include segment WAVs
    const wantTake = include.take !== false;     // default: include the take
    const { markdown, images } = buildDocument(state, state.pairs);
    // First thing anyone opens — human or agent. It exists because the first
    // agent given one of these bundles parsed review.md headings to work out
    // which image went with which words, having no way to know session.json
    // held the join.
    const entries = [{ path: 'README.md', text: buildReadme(include) }, { path: 'review.md', text: markdown }];

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
    // Both of these are in the handover bundle too. They are here as well
    // because the full export is the one people actually hand over, and the
    // uncertain list turned out to be the most-used thing in the whole bundle —
    // making it exclusive to a second export would hide it from most readers.
    const uncertain = uncertainToJson();
    if (uncertain.count) entries.push({ path: 'uncertain.json', text: JSON.stringify(uncertain, null, 2) });
    entries.push({ path: 'actions.json', text: JSON.stringify(actionsToJson(), null, 2) });
    // Always shipped, even with no receipts fetched: the generation ids alone
    // make the spend auditable later, from the export alone.
    if (state.billing.length) entries.push({ path: 'billing.json', text: JSON.stringify(billingToJson(), null, 2) });
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
